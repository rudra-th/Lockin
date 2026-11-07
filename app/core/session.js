/* Lockin core — session rules that do not need a browser. */

/** A session ended inside this many seconds is an accident, not avoidance. */
export const FREE_EXIT_SEC = 20;

/** Hold this long on the end control to leave a running session. */
export const END_HOLD_MS = 1400;

export function freeExit(elapsedSec, freeSec = FREE_EXIT_SEC) {
  return Number(elapsedSec) < Number(freeSec);
}

/**
 * How long a session launched from a schedule block should run: the rest of
 * the occurrence, rounded up, clamped to something a person can finish.
 */
export function blockSessionMin(nowMs, startMs, endMs) {
  const end = Number(endMs);
  if (!Number.isFinite(end)) return 25;
  const from = Math.max(Number(nowMs) || 0, Number(startMs) || 0);
  const mins = Math.ceil((end - from) / 60000);
  return Math.max(5, Math.min(180, mins || 0));
}

/**
 * Minutes from rounds that finished before the current one. Each completed
 * round is already banked on its own; this is only the total to show when a
 * session ends mid-round (a break, or a strict session forfeiting the segment).
 */
export function completedRoundMinutes(minPerRound, roundIdx) {
  const min = Math.max(0, Number(minPerRound) || 0);
  const done = Math.max(0, (Number(roundIdx) || 1) - 1);
  return Math.round(min * done);
}
