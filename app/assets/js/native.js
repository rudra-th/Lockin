/* Lockin — Android bridge.
   The web app is the same code inside the Capacitor shell. This module is the
   only place that talks to LockinNative: it seeds exact alarms while Lockin is
   in the background, reads the notification tap route, and exposes the
   permission and screen-time calls Settings uses. Outside the shell every
   export is inert. */

import { Store } from './store.js';
import { Router } from './router.js';
import { eventsBetween, spanLabel, daysLabel } from './util.js';

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

function bindAppState() {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) pushAlarms(true);
    else cancelNativeAlarms();
  });

  if (appPlugin?.addListener) {
    appPlugin.addListener('appStateChange', ({ isActive }) => {
      if (isActive) cancelNativeAlarms();
      else pushAlarms(true);
    });
  }

  addEventListener('pagehide', () => { pushAlarms(true); });

  /* A route event can arrive before the page finishes booting. */
  addEventListener('lockin:native-route', (ev) => {
    if (ev.detail) Router.go(ev.detail);
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

  /* A background transition re-reads the store, so schedule edits made while
     the app was open are already in the window. */
  await cancelNativeAlarms();
  return true;
}

/* ---------- permissions ---------- */

export async function nativeStatus() {
  if (!isNative) return null;
  try {
    const [exact, notifications, usage] = await Promise.all([
      plugin.canScheduleExactAlarms(),
      plugin.notificationPermission(),
      plugin.hasUsageAccess(),
    ]);
    return {
      exact: Boolean(exact?.exact),
      notifications: Boolean(notifications?.granted),
      usage: Boolean(usage?.granted),
    };
  } catch (_) {
    return { exact: false, notifications: false, usage: false };
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

export function openUsageAccessSettings() {
  return plugin?.openUsageAccessSettings?.().catch(() => {});
}

/* ---------- screen time ---------- */

/** Per-app foreground time for the last `days`, largest first. */
export async function queryUsage(days = 7) {
  if (!isNative) return [];
  try {
    const result = await plugin.queryUsage({ days });
    const rows = Array.isArray(result?.usage) ? result.usage : [];
    return rows
      .map((row) => ({
        package: String(row.package || ''),
        label: String(row.label || row.package || ''),
        ms: Number(row.ms) || 0,
      }))
      .filter((row) => row.ms > 0)
      .sort((a, b) => b.ms - a.ms);
  } catch (_) {
    return [];
  }
}
