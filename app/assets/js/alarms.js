/* Lockin — schedule alarms.
   A small foreground engine: every fifteen seconds it asks the pure core
   whether a reminder or a block start is due, then rings the in-app alarm,
   a system notification and a chime. It is honest about its limits — the
   web can only ring while a Lockin page is alive; the Android shell will
   own exact alarms when it lands. */

import { Store } from './store.js';
import { Router } from './router.js';
import {
  el, eventsBetween, spanLabel, daysLabel, todayKey, dateKey,
  reminderBody, nudgeDue, nudgeBody,
} from './util.js';
import { svg } from './icons.js';
import { closeSheet, hint } from './ui.js';
import { isNative, requestNotifications } from './native.js';
import { startSessionForBlock, skipBlockOccurrence } from './views/focus.js';

const FIRED_KEY = 'lockin.alarms.fired.v1';
const NUDGE_KEY = 'lockin.nudge.v1';
const LOOKBACK_MS = 4 * 60000;
const TICK_MS = 15000;

const fired = new Set();
try {
  const saved = JSON.parse(sessionStorage.getItem(FIRED_KEY) || '[]');
  if (Array.isArray(saved)) saved.forEach((k) => fired.add(k));
} catch (_) { /* private mode */ }

let timer = 0;
let audio = null;
let overlay = null;
let lastFocus = null;
let escHandler = null;

/* ---------- sound ---------- */

function audioCtx() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  if (!audio) audio = new Ctx();
  if (audio.state === 'suspended') audio.resume().catch(() => {});
  return audio;
}

/* Browsers only allow sound after a gesture, so unlock on the first one. */
function primeAudio() {
  const unlock = () => {
    const ctx = audioCtx();
    if (ctx?.state === 'suspended') ctx.resume().catch(() => {});
  };
  addEventListener('pointerdown', unlock, { once: true, capture: true });
  addEventListener('keydown', unlock, { once: true, capture: true });
}

function chime(intense = true) {
  if (!Store.state?.settings?.alarmSound) return;
  const ctx = audioCtx();
  if (!ctx || ctx.state !== 'running') return;
  const notes = intense ? [523.25, 659.25, 783.99] : [659.25];
  const now = ctx.currentTime + 0.02;
  notes.forEach((freq, i) => {
    const at = now + i * 0.19;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(0.16, at + 0.025);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.55);
    osc.connect(gain).connect(ctx.destination);
    osc.start(at);
    osc.stop(at + 0.6);
  });
}

function buzz(intense = true) {
  if (!Store.state?.settings?.alarmVibrate) return;
  /* Chrome logs a console error for vibrate before the first tap. Wait for
     a real gesture; the overlay and chime still carry the alarm. */
  if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return;
  try {
    if (navigator.vibrate) navigator.vibrate(intense ? [180, 80, 180, 80, 260] : [120]);
  } catch (_) { /* vibration is a bonus, never a failure */ }
}

/* ---------- system notification ---------- */

async function notify(title, body, tag) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const options = {
    body,
    tag,
    icon: 'assets/icons/icon-192.png',
    badge: 'assets/icons/favicon-32.png',
    silent: true, // the page plays its own chime; no double buzz
  };
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg?.showNotification) await reg.showNotification(title, options);
    else new Notification(title, options);
  } catch (_) { /* notification is a bonus, never a failure */ }
}

/* ---------- in-app alarm ---------- */

function closeAlarm() {
  if (escHandler) { removeEventListener('keydown', escHandler); escHandler = null; }
  if (!overlay) return;
  const node = overlay;
  overlay = null;
  node.classList.remove('show');
  setTimeout(() => node.remove(), 240);
  if (lastFocus && document.contains(lastFocus)) lastFocus.focus?.();
  lastFocus = null;
}

function ringStart(ev) {
  const { schedule, start } = ev.occ;
  const live = ['running', 'break', 'paused'].includes(Store.state.session?.phase);
  const day = dateKey(start);

  chime(true);
  buzz(true);
  notify(`${schedule.name} starts now`, spanLabel(schedule), `lockin-start-${start.getTime()}`);

  closeAlarm();
  lastFocus = document.activeElement;

  const primary = el('button', {
    class: 'btn btn-primary',
    onclick: () => {
      closeAlarm();
      closeSheet(true); // never leave an editor sheet over the session screen
      if (live) Router.go('/focus');
      else startSessionForBlock(schedule, day);
    },
  }, svg('play', 17), live ? 'Back to session' : 'Start session');

  const skip = el('button', {
    class: 'btn btn-subtle',
    onclick: () => {
      closeAlarm();
      skipBlockOccurrence(schedule, day);
      hint(`Skipped ${schedule.name} for today`);
    },
  }, 'Skip today');

  const card = el('div', {
    class: 'alarm', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'alarm-title',
  },
    el('div', { class: 'alarm-glyph', 'aria-hidden': 'true' },
      svg('bell', 30),
      el('i', { class: 'alarm-wave w1' }),
      el('i', { class: 'alarm-wave w2' })),
    el('p', { class: 'alarm-kicker' }, 'Schedule · now'),
    el('h2', { id: 'alarm-title' }, schedule.name),
    el('p', { class: 'alarm-time' }, spanLabel(schedule)),
    el('p', { class: 'alarm-days' }, daysLabel(schedule.days)),
    el('div', { class: 'alarm-actions' }, primary, skip,
      el('button', { class: 'btn btn-ghost', onclick: closeAlarm }, 'Dismiss')),
    el('p', { class: 'alarm-foot' }, isNative
      ? 'Android exact alarms ring even when Lockin is closed.'
      : 'Rings while Lockin is open. The Android build rings when it is not.'),
  );

  overlay = el('div', {
    class: 'alarm-scrim',
    onclick: (e) => { if (e.target === overlay) closeAlarm(); },
  }, card);
  document.body.append(overlay);
  escHandler = (e) => { if (e.key === 'Escape') closeAlarm(); };
  addEventListener('keydown', escHandler);
  requestAnimationFrame(() => {
    if (!overlay) return;
    overlay.classList.add('show');
    primary.focus();
  });
}

function reminderToast(ev) {
  const { schedule, start } = ev.occ;
  const mins = Math.max(1, Math.ceil((start - Date.now()) / 60000));
  const body = reminderBody({
    focusMin: Store.focusMinutesOn(todayKey()),
    goalMin: Store.goalToday(),
    mins,
  });

  chime(false);
  buzz(false);
  notify(`${schedule.name} in ${mins} min`, body, `lockin-remind-${start.getTime()}`);

  const toast = el('div', { class: 'alarm-toast', role: 'status' },
    el('span', { class: 'alarm-toast-icon', innerHTML: svg('bell', 16) }),
    el('div', { class: 'alarm-toast-txt' },
      el('b', {}, schedule.name),
      el('span', {}, `in ${mins} min · ${schedule.start}`)),
    el('button', {
      class: 'alarm-toast-x', 'aria-label': 'Dismiss reminder',
      innerHTML: svg('x', 14), onclick: () => toast.remove(),
    }));
  document.body.append(toast);
  requestAnimationFrame(() => toast.classList.add('show'));
  setTimeout(() => { toast.classList.remove('show'); setTimeout(() => toast.remove(), 260); }, 9000);
}

/* ---------- daily target check-in ---------- */

function lastNudgeDay() {
  try { return localStorage.getItem(NUDGE_KEY) || ''; } catch (_) { return ''; }
}

function rememberNudge(day) {
  try { localStorage.setItem(NUDGE_KEY, day); } catch (_) { /* private mode */ }
}

function nudgeToast(body) {
  const today = todayKey();
  const toast = el('div', { class: 'alarm-toast nudge-toast', role: 'status' },
    el('span', { class: 'alarm-toast-icon', innerHTML: svg('target', 16) }),
    el('div', { class: 'alarm-toast-txt' },
      el('b', {}, 'Daily target'),
      el('span', {}, body)),
    el('button', {
      class: 'btn btn-subtle btn-sm',
      onclick: () => { toast.remove(); Router.go('/focus'); },
    }, 'Focus'),
    el('button', {
      class: 'alarm-toast-x', 'aria-label': 'Dismiss check-in',
      innerHTML: svg('x', 14), onclick: () => toast.remove(),
    }));
  document.body.append(toast);
  requestAnimationFrame(() => toast.classList.add('show'));
  setTimeout(() => { toast.classList.remove('show'); setTimeout(() => toast.remove(), 260); }, 12000);
  rememberNudge(today);
}

function dailyNudge() {
  const s = Store.state?.settings;
  if (!s?.nudge) return;
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const today = todayKey();
  const focusMin = Store.focusMinutesOn(today);
  const goalMin = Store.goalToday();
  if (!nudgeDue({ nowMin, atMin: s.nudgeAt, focusMin, goalMin, lastNudgedDay: lastNudgeDay(), today })) return;
  const body = nudgeBody(focusMin, goalMin);
  notify('Daily target', body, `lockin-nudge-${today}`);
  nudgeToast(body);
}

/* ---------- the loop ---------- */

function eventKey(ev) {
  return `${ev.occ.schedule.id}|${ev.occ.start.getTime()}|${ev.kind}`;
}

function remember(key) {
  fired.add(key);
  try {
    sessionStorage.setItem(FIRED_KEY, JSON.stringify([...fired].slice(-80)));
  } catch (_) { /* private mode */ }
}

function check() {
  dailyNudge();
  if (!Store.state?.settings?.scheduleAlarms) return;
  const now = new Date();
  const events = eventsBetween(Store.schedules(), new Date(now.getTime() - LOOKBACK_MS), new Date(now.getTime() + 1000))
    /* "Alarm at start" is per block; a reminder still fires when it is off. */
    .filter((ev) => ev.kind === 'remind' || ev.occ.schedule.alarm !== false);

  let start = null;
  let remind = null;
  for (const ev of events) {
    if (fired.has(eventKey(ev))) continue;
    if (ev.kind === 'start') {
      if (!start || ev.at > start.at) start = ev;
    } else if (!remind || ev.at > remind.at) {
      remind = ev;
    }
  }

  if (start) {
    remember(eventKey(start));
    ringStart(start);
    return;
  }
  if (remind) {
    remember(eventKey(remind));
    reminderToast(remind);
  }
}

/** Ask for notification permission from a real click, never on load. */
export function ensureAlarmPermission() {
  primeAudio();
  if (isNative) {
    requestNotifications();
    return;
  }
  if (!('Notification' in window)) return;
  if (Notification.permission === 'default') Notification.requestPermission().catch(() => {});
}

export function startAlarms() {
  if (timer) return;
  primeAudio();
  check();
  timer = setInterval(check, TICK_MS);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) check();
  });
}
