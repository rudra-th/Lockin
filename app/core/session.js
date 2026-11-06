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
