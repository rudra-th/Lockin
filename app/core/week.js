/* Lockin core — the seven-day summary behind the shareable weekly card.
   Pure: callers pass in the numbers, so this stays testable without a store. */

import { addDays } from './time.js';
import { DEFAULT_GOAL_MIN } from './goal.js';

export const WEEK_DAYS = 7;

/**
 * @param {string} endDay   last day of the window (inclusive)
 * @param {object} opts
 * @param {(day: string) => number} opts.minutesOn   focus minutes for a day
 * @param {(day: string) => number} opts.goalOn      target that was in force
 * @param {number} [opts.streak]                     current target-day streak
 * @param {string|null} [opts.topTask]               most-completed task title
 */
export function weekSummary(endDay, opts = {}) {
  const minutesOn = typeof opts.minutesOn === 'function' ? opts.minutesOn : () => 0;
  const goalOn = typeof opts.goalOn === 'function'
    ? opts.goalOn
    : () => Number(opts.goalMin) || DEFAULT_GOAL_MIN;

  const days = [];
  for (let i = WEEK_DAYS - 1; i >= 0; i -= 1) {
    const day = addDays(endDay, -i);
    const mins = Math.max(0, Math.round(Number(minutesOn(day)) || 0));
    const goal = Math.max(1, Math.round(Number(goalOn(day)) || DEFAULT_GOAL_MIN));
    days.push({ day, mins, goal, met: mins > 0 && mins >= goal });
  }

  const total = days.reduce((sum, row) => sum + row.mins, 0);
  const targetDays = days.filter((row) => row.met).length;
  const best = days.reduce((top, row) => (row.mins > top.mins ? row : top), days[0]);

  return {
    endDay,
    days,
    total,
    targetDays,
    best,
    average: Math.round(total / WEEK_DAYS),
    streak: Math.max(0, Number(opts.streak) || 0),
    topTask: typeof opts.topTask === 'string' && opts.topTask.trim()
      ? opts.topTask.trim()
      : null,
  };
}
