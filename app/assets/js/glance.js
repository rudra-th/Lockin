/* Lockin — the Android home-screen glance.
   The widget and the Quick Settings tile live outside the WebView, so they
   cannot read the store. This module mirrors today's numbers into native
   storage whenever the app writes; those surfaces only ever render that copy.
   Outside the shell it does nothing. */

import { Store } from './store.js';
import { todayKey, dateKey, nextOccurrence } from './util.js';
import { isNative, pushWidget } from './native.js';

/* The next block and a running session move without a store write. */
const REFRESH_MS = 60000;

let listening = false;
let lastSignature = '';

function clockOf(date) {
  const h = String(date.getHours()).padStart(2, '0');
  const m = String(date.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

/** What the widget shows: minutes, the bar, the streak, what comes next. */
function snapshot() {
  const now = new Date();
  const next = nextOccurrence(Store.schedules(), now,
    (occ) => Store.isBlockSkipped(occ.schedule.id, dateKey(occ.start)));

  const session = Store.state?.session;
  const live = Boolean(session && ['running', 'break', 'paused'].includes(session.phase));

  return {
    minutes: Math.max(0, Math.round(Store.focusMinutesOn(todayKey()))),
    goal: Math.max(1, Math.round(Store.goalToday())),
    streak: Math.max(0, Store.goalStreak()),
    next: next ? `${next.schedule.name} · ${clockOf(next.start)}` : '',
    session: live,
    until: live ? Number(session.plannedEnd) || 0 : 0,
  };
}

async function sync() {
  if (!isNative) return;
  const data = snapshot();
  const signature = JSON.stringify(data);
  if (signature === lastSignature) return;
  lastSignature = signature;
  await pushWidget(data);
}

/** Start the mirror. Safe on the web: nothing happens outside the shell. */
export function startGlance() {
  if (!isNative || listening) return false;
  listening = true;

  sync();
  document.addEventListener('lockin:changed', sync);
  addEventListener('pagehide', sync);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) sync();
  });
  setInterval(sync, REFRESH_MS);
  return true;
}
