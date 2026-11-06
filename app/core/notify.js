/* Lockin core — when a reminder is worth sending and what it should say.
   Pure, so the web alarm loop and the Android bridge agree. */

import { fmtMin } from './time.js';
import { minutesLeft } from './goal.js';

export const DEFAULT_NUDGE_AT = 20 * 60; // 20:00, minutes after midnight

/** "HH:MM" → minutes after midnight; clamps bad input to the default. */
export function parseNudgeAt(value) {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(value || '').trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : DEFAULT_NUDGE_AT;
}

export function nudgeAtHM(value) {
  const mins = Number.isFinite(Number(value)) ? Number(value) : DEFAULT_NUDGE_AT;
  const clamped = Math.max(0, Math.min(1439, Math.round(mins)));
  return `${String(Math.floor(clamped / 60)).padStart(2, '0')}:${String(clamped % 60).padStart(2, '0')}`;
}

/**
 * Should the daily target nudge fire?
 * Fires once a day, at or after the chosen minute, and only while there is
 * still a gap worth closing. Empty days get the nudge too — a target is a
 * plan, not a punishment.
 */
export function nudgeDue({ nowMin, atMin = DEFAULT_NUDGE_AT, focusMin = 0, goalMin = 0, lastNudgedDay = '', today }) {
  if (!goalMin || goalMin <= 0) return false;
  if (today && lastNudgedDay === today) return false;
  if (Number(nowMin) < Number(atMin)) return false;
  return minutesLeft(focusMin, goalMin) > 0;
}

/** The notification body for the daily check-in. */
export function nudgeBody(focusMin, goalMin) {
  const left = minutesLeft(focusMin, goalMin);
  const goal = fmtMin(goalMin);
  if (left <= 0) return `Target met — ${goal} banked today.`;
  if (!focusMin) return `${fmtMin(left)} left of your ${goal} target. One session is enough to start.`;
  return `${fmtMin(focusMin)} banked · ${fmtMin(left)} left of your ${goal} target.`;
}

/** The one-line body for a reminder that arrives before a scheduled block. */
export function reminderBody({ focusMin = 0, goalMin = 0, mins = 0 } = {}) {
  const when = mins > 0 ? `in ${mins} min` : 'now';
  const left = minutesLeft(focusMin, goalMin);
  if (!goalMin) return `Starts ${when}.`;
  if (left <= 0) return `Starts ${when} · today’s target is already met.`;
  return `Starts ${when} · ${fmtMin(left)} left to hit today’s target.`;
}
