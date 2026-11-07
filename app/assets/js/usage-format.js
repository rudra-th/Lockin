/* Lockin — display helpers shared by the Phone tab and the screen-time detail. */

import { fmtMin, dateKey } from './util.js';

/** '4h 12m' / '38m' / '<1m' — usage lengths, never a bare zero. */
export function fmtDur(ms) {
  const mins = Math.max(0, Math.round((Number(ms) || 0) / 60000));
  if (ms > 0 && mins < 1) return '<1m';
  return fmtMin(mins);
}

/** Stable hue for an app badge, derived from its label. */
export function appHue(label) {
  let h = 0;
  for (let i = 0; i < label.length; i += 1) h = (h * 31 + label.charCodeAt(i)) % 360;
  return h;
}

/** The last `length` local days as [{ day, ms }], zero-filled. */
export function recentDays(rows, length = 7) {
  const byDay = new Map((rows || []).map((row) => [row.day, row.ms]));
  const now = new Date();
  const out = [];
  for (let i = length - 1; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    const key = dateKey(d);
    out.push({ day: key, ms: byDay.get(key) || 0 });
  }
  return out;
}
