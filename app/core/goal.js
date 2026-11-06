/* Lockin core — the daily-target math. Pure functions, shared by Progress,
   the session room, the weekly card and the tests. No DOM, no storage.

   A day counts when the minutes focused on it reach the target that was set
   for that day. The target is versioned by `goalHistory`, so changing today's
   goal never rewrites what yesterday was measured against. */

import { addDays } from './time.js';

export const DEFAULT_GOAL_MIN = 120;

/** Most minutes a target may sensibly hold (24h). */
const MAX_GOAL = 1440;

function validDay(day) {
  return typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day);
}

function clampGoal(min) {
  const n = Math.round(Number(min));
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.max(1, Math.min(MAX_GOAL, n));
}

/**
 * Clean a goal history. Entries are `{ day: 'YYYY-MM-DD', min: number }`.
 * Sorted oldest first, one entry per day. An empty history is seeded with
 * `fallbackDay`/`fallbackMin` so `goalFor` always has an answer.
 */
export function normalizeGoalHistory(raw, fallbackDay, fallbackMin = DEFAULT_GOAL_MIN) {
  const map = new Map();
  for (const entry of Array.isArray(raw) ? raw : []) {
    if (!entry || !validDay(entry.day)) continue;
    const min = clampGoal(entry.min);
    if (min) map.set(entry.day, min);
  }
  if (!map.size) {
    const min = clampGoal(fallbackMin) || DEFAULT_GOAL_MIN;
    map.set(validDay(fallbackDay) ? fallbackDay : '1970-01-01', min);
  }
  return [...map.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([day, min]) => ({ day, min }));
}

/** The target in force on `day` — the latest entry on or before it. */
export function goalFor(history, day, fallback = DEFAULT_GOAL_MIN) {
  let min = null;
  for (const entry of history || []) {
    if (entry.day > day) break;
    min = entry.min;
  }
  return min == null ? fallback : min;
}

/** Append (or replace) today's target without touching past days. */
export function setGoalOn(history, day, min) {
  const value = clampGoal(min);
  if (!validDay(day) || !value) return normalizeGoalHistory(history);
  const map = new Map((history || []).map((e) => [e.day, e.min]));
  map.set(day, value);
  return normalizeGoalHistory([...map.entries()].map(([d, m]) => ({ day: d, min: m })));
}

/** Did a day reach its target? Zero focus never counts, even with a 0 goal. */
export function dayGoalMet(focusMin, goalMin) {
  const mins = Number(focusMin) || 0;
  const goal = Number(goalMin) || 0;
  return mins > 0 && goal > 0 && mins >= goal;
}

/** Minutes still needed today; 0 once the target is met. */
export function minutesLeft(focusMin, goalMin) {
  return Math.max(0, Math.ceil((Number(goalMin) || 0) - (Number(focusMin) || 0)));
}

/**
 * Consecutive target days ending at `day`. Today still in progress is not a
 * broken streak: if today is short, the count starts at yesterday.
 */
export function goalStreak(day, minutesOn, history, fallback = DEFAULT_GOAL_MIN) {
  let cursor = day;
  if (!dayGoalMet(minutesOn(cursor), goalFor(history, cursor, fallback))) {
    cursor = addDays(cursor, -1);
  }
  let streak = 0;
  while (streak < 3660 && dayGoalMet(minutesOn(cursor), goalFor(history, cursor, fallback))) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

/** How many of `days` reached the target that was in force on each. */
export function targetDays(days, minutesOn, history, fallback = DEFAULT_GOAL_MIN) {
  return (days || []).filter((day) => dayGoalMet(
    minutesOn(day),
    goalFor(history, day, fallback),
  )).length;
}
