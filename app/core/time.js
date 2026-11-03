/* Lockin core — pure time and date helpers.
   No DOM, no storage: this file is shared by the web app, the browser
   extension and (later) the Android shell. Keep it dependency-free. */

export function pad2(n) {
  return String(n).padStart(2, '0');
}

/** slot index (0..47, 30-min grid) → "HH:MM" */
export function slotsToT(slot) {
  const m = Math.max(0, Math.min(48 * 30, slot * 30));
  return `${pad2(Math.floor(m / 60) % 24)}:${pad2(m % 60)}`;
}

/** "HH:MM" → slot index; clamps to [0, 48] */
export function tToSlots(t) {
  const [h, m] = (t || '00:00').split(':').map(Number);
  return Math.max(0, Math.min(48, Math.round((h * 60 + (m || 0)) / 30)));
}

/** seconds → "mm:ss" / "h:mm:ss" (ceiling, for countdowns) */
export function fmtClock(totalSec) {
  const s = Math.max(0, Math.ceil(totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h ? `${h}:${pad2(m)}:${pad2(sec)}` : `${pad2(m)}:${pad2(sec)}`;
}

/** seconds elapsed → "00:00" / "1:02:05" (floor — for the up-counting stopwatch) */
export function fmtWatch(totalSec) {
  const s = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h ? `${h}:${pad2(m)}:${pad2(sec)}` : `${pad2(m)}:${pad2(sec)}`;
}

/** minutes → "1h 25m" / "42m" */
export function fmtMin(mins) {
  mins = Math.max(0, Math.round(mins));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (!h) return `${m}m`;
  return m ? `${h}h ${pad2(m)}m` : `${h}h`;
}

/* ---------- dates ---------- */

/** local date → "YYYY-MM-DD" (no UTC drift) */
export function dateKey(d = new Date()) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function todayKey() {
  return dateKey();
}

export function parseKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(key, n) {
  const d = parseKey(key);
  d.setDate(d.getDate() + n);
  return dateKey(d);
}

export function weekdayShort(key) {
  return parseKey(key).toLocaleDateString(undefined, { weekday: 'short' });
}

export function prettyDate(key) {
  const d = parseKey(key);
  const today = todayKey();
  if (key === today) return 'Today';
  if (key === addDays(today, 1)) return 'Tomorrow';
  if (key === addDays(today, -1)) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

/** whole calendar days from today to key — 0 means today, negative means past */
export function daysUntil(key, from = new Date()) {
  if (!key) return null;
  const target = parseKey(key);
  const today = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  return Math.round((target - today) / 86400000);
}
