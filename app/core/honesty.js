/* Lockin core — the honesty math. Pure functions, shared by every surface
   and covered by tests.html. No DOM, no storage. */

/**
 * Decide what an away-episode means during a strict session.
 * awaySec     : how long the page was hidden
 * usedRescues : rescues already spent today
 * graceSec    : accident window (default 10)
 * cap         : free rescues per day (default 3)
 */
export function decideAway({ awaySec = 0, usedRescues = 0, graceSec = 10, cap = 3 }) {
  if (awaySec <= graceSec && usedRescues < cap) return 'rescue';
  return 'slip';
}

/**
 * Earned exit: real work buys the right to stop without it counting as a slip.
 * `graceMin` of 0 (or less) turns the rule off — every early end counts again.
 */
export function earnedExit(elapsedSec, graceMin) {
  const bar = Number(graceMin) || 0;
  return bar > 0 && Number(elapsedSec) >= bar * 60;
}

/** A session ended inside this many seconds is an accident, not avoidance. */
export const FREE_EXIT_SEC = 20;

export function freeExit(elapsedSec, freeSec = FREE_EXIT_SEC) {
  return Number(elapsedSec) < Number(freeSec);
}

/** Stopping is neutral inside the accident window or after real work. */
export function neutralExit(elapsedSec, graceMin, freeSec = FREE_EXIT_SEC) {
  return freeExit(elapsedSec, freeSec) || earnedExit(elapsedSec, graceMin);
}
