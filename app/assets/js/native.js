/* Lockin — Android bridge.
   The web app is the same code inside the Capacitor shell. This module is the
   only place that talks to LockinNative: it seeds exact alarms while Lockin is
   in the background, reads the notification tap route, and exposes the
   permission, blocking, limit, screen-time and strict-mode calls Control uses.
   Outside the shell every export is inert. */

import { Store } from './store.js';
import { Router } from './router.js';
import { eventsBetween, occurrencesBetween, spanLabel, daysLabel, dateKey } from './util.js';

const cap = globalThis.Capacitor;
const plugin = cap?.Plugins?.LockinNative || null;
const appPlugin = cap?.Plugins?.App || null;

export const isNative = Boolean(cap?.isNativePlatform?.() && plugin);

/* The next two weeks are enough to survive a holiday without opening the app;
   every background transition refreshes the window anyway. */
const HORIZON_DAYS = 14;

let listening = false;
let lastSignature = null;

/* ---------- alarms ---------- */

function alarmWindow() {
  if (!Store.state?.settings?.scheduleAlarms) return [];
  const from = new Date();
  const to = new Date(from.getTime() + HORIZON_DAYS * 86400000);
  return eventsBetween(Store.schedules(), from, to)
    /* "Alarm at start" is per block; the reminder stays useful either way. */
    .filter((ev) => ev.kind === 'remind' || ev.occ.schedule.alarm !== false)
    .map((ev) => {
      const schedule = ev.occ.schedule;
      return {
        id: `${schedule.id}|${ev.occ.start.getTime()}|${ev.kind}`,
        at: ev.at.getTime(),
        kind: ev.kind,
        title: ev.kind === 'remind' ? `${schedule.name} soon` : `${schedule.name} starts now`,
        body: `${spanLabel(schedule)} · ${daysLabel(schedule.days)}`,
        /* Enough for the notification's Start/Skip actions to act without
           re-deriving the block on the native side. */
        scheduleId: schedule.id,
        day: dateKey(ev.occ.start),
        name: schedule.name,
        start: ev.occ.start.getTime(),
        end: ev.occ.end.getTime(),
      };
    });
}

async function pushAlarms(force = false) {
  if (!isNative) return null;
  const alarms = alarmWindow();
  const signature = JSON.stringify(alarms);
  if (!force && signature === lastSignature) return null;
  lastSignature = signature;
  try {
    return await plugin.syncAlarms({ alarms });
  } catch (_) {
    return null; // the foreground engine still rings; never break boot
  }
}

/** Drop every native alarm. The foreground engine owns the app while open. */
export async function cancelNativeAlarms() {
  if (!isNative) return;
  lastSignature = null;
  try {
    await plugin.cancelAllAlarms();
  } catch (_) { /* nothing to cancel */ }
}

/* ---------- boot ---------- */

async function consumeRoute() {
  try {
    const { route } = (await plugin.consumeRoute()) || {};
    if (route) Router.go(route);
  } catch (_) { /* a stale intent is not fatal */ }
}

/**
 * Actions taken from an alarm notification or the full-screen alarm. They are
 * queued natively, so a skip tapped while the app was closed still applies
 * once the app next wakes.
 */
async function consumeAlarmActions() {
  if (!isNative) return;
  let actions;
  try {
    const res = await plugin.consumeAlarmActions();
    actions = Array.isArray(res?.actions) ? res.actions : [];
  } catch (_) {
    return;
  }
  if (!actions.length) return;
  /* Loaded lazily: focus.js already imports this bridge, so a static import
     would close the cycle. */
  const { startSessionForBlock, skipBlockOccurrence } = await import('./views/focus.js');
  for (const action of actions) {
    const schedule = Store.schedule(action.scheduleId);
    if (!schedule) continue;
    if (action.action === 'start') startSessionForBlock(schedule, action.day);
    else if (action.action === 'skip') skipBlockOccurrence(schedule, action.day);
  }
}

function bindAppState() {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      pushAlarms(true);
      pushBlockingWindows(true);
    } else {
      cancelNativeAlarms();
      consumeAlarmActions();
    }
  });

  if (appPlugin?.addListener) {
    appPlugin.addListener('appStateChange', ({ isActive }) => {
      if (isActive) {
        cancelNativeAlarms();
        consumeAlarmActions();
      } else {
        pushAlarms(true);
        pushBlockingWindows(true);
      }
    });
  }

  addEventListener('pagehide', () => {
    pushAlarms(true);
    pushBlockingWindows(true);
  });

  /* A route event can arrive before the page finishes booting. */
  addEventListener('lockin:native-route', (ev) => {
    if (ev.detail) Router.go(ev.detail);
  });

  /* A warm alarm action arrives straight from MainActivity; the queue holds
     the details, so the event is only a nudge to drain it. */
  addEventListener('lockin:alarm-action', () => {
    consumeAlarmActions();
  });
}

/**
 * Start the native bridge. Safe to call on the web: it returns false and does
 * nothing. Inside the shell it clears stale alarms (the app is open now) and
 * re-seeds them every time the app leaves the foreground.
 */
export async function startNative() {
  if (!isNative || listening) return false;
  listening = true;

  await consumeRoute();
  bindAppState();
  consumeAlarmActions();

  /* A background transition re-reads the store, so schedule edits made while
     the app was open are already in the window. */
  await cancelNativeAlarms();
  await pushBlockingWindows(true);
  await clearStaleStrict();
  return true;
}

/** A killed app can leave strict armed with no session behind it. Fail open. */
async function clearStaleStrict() {
  const st = await strictStatus();
  if (!st?.armed) return;
  const phase = Store.state?.session?.phase;
  const live = ['running', 'break', 'paused'].includes(phase);
  if (!live || !Store.state?.settings?.kiosk) {
    try { await plugin.stopStrictMode(); } catch (_) { /* fail open silently */ }
  }
}

/* ---------- permissions ---------- */

export async function nativeStatus() {
  if (!isNative) return null;
  try {
    const [exact, notifications, usage, fullScreen, blocking] = await Promise.all([
      plugin.canScheduleExactAlarms(),
      plugin.notificationPermission(),
      plugin.hasUsageAccess(),
      plugin.fullScreenIntentAllowed(),
      plugin.blockingStatus(),
    ]);
    return {
      exact: Boolean(exact?.exact),
      notifications: Boolean(notifications?.granted),
      usage: Boolean(usage?.granted),
      fullScreen: Boolean(fullScreen?.allowed),
      accessibility: Boolean(blocking?.service),
      deviceOwner: Boolean(blocking?.deviceOwner),
    };
  } catch (_) {
    return {
      exact: false, notifications: false, usage: false, fullScreen: false,
      accessibility: false, deviceOwner: false,
    };
  }
}

export async function requestNotifications() {
  if (!isNative) return false;
  try {
    await plugin.requestNotificationPermission();
  } catch (_) { /* denied is a valid answer */ }
  return (await nativeStatus())?.notifications || false;
}

export function openNotificationSettings() {
  return plugin?.openNotificationSettings?.().catch(() => {});
}

export function openExactAlarmSettings() {
  return plugin?.openExactAlarmSettings?.().catch(() => {});
}

export function openFullScreenIntentSettings() {
  return plugin?.openFullScreenIntentSettings?.().catch(() => {});
}

export function openUsageAccessSettings() {
  return plugin?.openUsageAccessSettings?.().catch(() => {});
}

/* ---------- app blocking ---------- */

let lastBlockSignature = null;

/**
 * The live session, if one is running. A stopwatch has no planned end, so it
 * covers four hours from now, rounded up to a quarter hour to keep the pushed
 * window stable between background transitions.
 */
function liveSessionWindow() {
  const snap = Store.state?.session;
  if (!snap || !['running', 'paused'].includes(snap.phase)) return null;

  const now = Date.now();
  const start = Math.min(Number(snap.startedAt) || now, now);
  const planned = Number(snap.plannedEnd);

  if (Number.isFinite(planned) && planned > now) {
    return { start, end: planned, label: 'Study Mode' };
  }
  if (snap.cfg?.mode === 'stop') {
    const end = Math.ceil((now + 4 * 3600000) / (15 * 60000)) * 15 * 60000;
    return { start, end, label: 'Study Mode' };
  }
  return null;
}

/** Schedule occurrences overlapping the next two weeks, plus the live session. */
function blockingWindows() {
  const from = new Date();
  const to = new Date(from.getTime() + HORIZON_DAYS * 86400000);
  const windows = occurrencesBetween(Store.schedules(), from, to).map((occ) => ({
    start: occ.start.getTime(),
    end: occ.end.getTime(),
    label: occ.schedule.name,
  }));

  const live = liveSessionWindow();
  if (live) windows.push(live);
  return windows.sort((a, b) => a.start - b.start);
}

/** Seed the native service with the current windows. Cheap when unchanged. */
export async function pushBlockingWindows(force = false) {
  if (!isNative) return null;
  const windows = blockingWindows();
  const signature = JSON.stringify(windows);
  if (!force && signature === lastBlockSignature) return null;
  lastBlockSignature = signature;
  try {
    return await plugin.syncBlockingWindows({ windows });
  } catch (_) {
    return null; // blocking must never break boot
  }
}

function windowOf(raw) {
  if (!raw) return null;
  return {
    label: String(raw.label || 'Focus'),
    start: Number(raw.start) || 0,
    end: Number(raw.end) || 0,
  };
}

function numberMap(raw) {
  if (!raw || typeof raw !== 'object') return {};
  const out = {};
  for (const [key, value] of Object.entries(raw)) {
    const n = Number(value);
    if (key && Number.isFinite(n) && n > 0) out[key] = n;
  }
  return out;
}

/** What the native service actually holds: switch, packages, windows, limits. */
export async function blockingStatus() {
  if (!isNative) return null;
  try {
    const st = await plugin.blockingStatus();
    return {
      service: Boolean(st?.service),
      enabled: Boolean(st?.enabled),
      packages: Array.isArray(st?.packages) ? st.packages.map(String) : [],
      windowCount: Number(st?.windowCount) || 0,
      active: windowOf(st?.active),
      next: windowOf(st?.next),
      /* package -> daily minutes, and package -> ms used today */
      limits: numberMap(st?.limits),
      usage: numberMap(st?.usage),
      strictActive: Boolean(st?.strictActive),
      strictArmed: Boolean(st?.strictArmed),
      strictUntil: Number(st?.strictUntil) || 0,
      strictPackages: Array.isArray(st?.strictPackages) ? st.strictPackages.map(String) : [],
      deviceOwner: Boolean(st?.deviceOwner),
      lockTask: String(st?.lockTask || 'none'),
    };
  } catch (_) {
    return null;
  }
}

/** Apps with a launcher icon, own package excluded, sorted by label. */
export async function listLaunchableApps() {
  if (!isNative) return [];
  try {
    const result = await plugin.listLaunchableApps();
    const rows = Array.isArray(result?.apps) ? result.apps : [];
    return rows
      .map((row) => ({
        package: String(row.package || ''),
        label: String(row.label || row.package || ''),
      }))
      .filter((row) => row.package);
  } catch (_) {
    return [];
  }
}

/** Save the switch and the chosen apps, then refresh the window list. */
export async function saveBlocking({ enabled, packages }) {
  if (!isNative) return null;
  try {
    await plugin.setBlockingApps({
      enabled: Boolean(enabled),
      packages: [...packages],
    });
    lastBlockSignature = null;
    await pushBlockingWindows(true);
    return await blockingStatus();
  } catch (_) {
    return null;
  }
}

export function openAccessibilitySettings() {
  return plugin?.openAccessibilitySettings?.().catch(() => {});
}

/* ---------- per-app limits ---------- */

/** Replace the allowance map (package -> daily minutes; 0/absent = no limit). */
export async function saveAppLimits(limits) {
  if (!isNative) return null;
  try {
    await plugin.setAppLimits({ limits: { ...limits } });
    return await blockingStatus();
  } catch (_) {
    return null;
  }
}

/* ---------- strict study mode ---------- */

function strictOf(st) {
  return {
    deviceOwner: Boolean(st?.deviceOwner),
    active: Boolean(st?.active),
    armed: Boolean(st?.armed),
    until: Number(st?.until) || 0,
    lockTask: String(st?.lockTask || 'none'),
    packages: Array.isArray(st?.packages) ? st.packages.map(String) : [],
    apps: Array.isArray(st?.apps)
      ? st.apps.map((row) => ({
        package: String(row.package || ''),
        label: String(row.label || row.package || ''),
      })).filter((row) => row.package)
      : [],
  };
}

export async function strictStatus() {
  if (!isNative) return null;
  try {
    return strictOf(await plugin.strictStatus());
  } catch (_) {
    return null;
  }
}

/** Change the kiosk allowlist without arming or disarming it. */
export async function saveStrictPackages(packages) {
  if (!isNative) return null;
  try {
    return strictOf(await plugin.setStrictPackages({ packages: [...packages] }));
  } catch (_) {
    return null;
  }
}

/**
 * Arm the kiosk for a live session. `until` is the fail-open deadline:
 * if the web app dies, the device releases itself when it passes.
 */
export async function startStrictMode({ packages = [], until = 0 } = {}) {
  if (!isNative) return null;
  try {
    return strictOf(await plugin.startStrictMode({
      packages: [...packages],
      until: Number(until) || 0,
    }));
  } catch (_) {
    return null;
  }
}

export async function stopStrictMode() {
  if (!isNative) return null;
  try {
    return strictOf(await plugin.stopStrictMode());
  } catch (_) {
    return null;
  }
}

/** Push the deadline forward while the session is still running. */
export async function refreshStrict(until) {
  if (!isNative) return null;
  try {
    return strictOf(await plugin.refreshStrictMode({ until: Number(until) || 0 }));
  } catch (_) {
    return null;
  }
}

/** Open an allowlisted app from the session room. */
export async function launchApp(pkg) {
  if (!isNative) return false;
  try {
    await plugin.launchApp({ package: String(pkg || '') });
    return true;
  } catch (_) {
    return false;
  }
}

/* ---------- sharing ---------- */

/**
 * Hand a canvas PNG to the system share sheet. The WebView cannot pass a File
 * to navigator.share, so the base64 image goes through the bridge instead.
 * Returns false on the web (the caller falls back to the Web Share API).
 */
export async function shareImage({ dataURL, name = 'lockin.png', text = '' } = {}) {
  if (!isNative) return false;
  const raw = String(dataURL || '');
  const comma = raw.indexOf(',');
  const data = comma >= 0 ? raw.slice(comma + 1) : raw;
  if (!data) return false;
  try {
    await plugin.shareImage({ data, name, text });
    return true;
  } catch (_) {
    return false;
  }
}

/* ---------- home screen ---------- */

/** Mirror today's numbers to the widget and the Quick Settings tile. */
export async function pushWidget(snapshot) {
  if (!isNative) return false;
  try {
    await plugin.syncWidget({ snapshot: { ...snapshot } });
    return true;
  } catch (_) {
    return false;
  }
}

/** Ask the launcher to place the widget. Not every launcher allows pinning. */
export async function requestWidgetPin() {
  if (!isNative) return { supported: false, requested: false };
  try {
    const res = await plugin.requestWidgetPin();
    return {
      supported: Boolean(res?.supported),
      requested: Boolean(res?.requested),
    };
  } catch (_) {
    return { supported: false, requested: false };
  }
}

/* ---------- screen time ---------- */

function usageList(rows) {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => ({
      package: String(row.package || ''),
      label: String(row.label || row.package || ''),
      ms: Number(row.ms) || 0,
    }))
    .filter((row) => row.ms > 0)
    .sort((a, b) => b.ms - a.ms);
}

function usageRows(result) {
  return usageList(result?.usage);
}

/** Per-app foreground time for the last `days`, largest first. */
export async function queryUsage(days = 7) {
  if (!isNative) return [];
  try {
    return usageRows(await plugin.queryUsage({ days }));
  } catch (_) {
    return [];
  }
}

/** Per-app foreground time since local midnight, largest first. */
export async function queryUsageToday() {
  if (!isNative) return [];
  try {
    return usageRows(await plugin.queryUsageToday());
  } catch (_) {
    return [];
  }
}

/** Daily totals + each day's top apps, oldest first: [{ day, ms, apps }]. */
export async function queryUsageDaily(days = 7) {
  if (!isNative) return [];
  try {
    const result = await plugin.queryUsageDaily({ days });
    const rows = Array.isArray(result?.days) ? result.days : [];
    return rows
      .map((row) => ({
        day: String(row.day || ''),
        ms: Number(row.ms) || 0,
        apps: usageList(row.apps),
      }))
      .filter((row) => row.day);
  } catch (_) {
    return [];
  }
}
