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

/**
 * What ending a session banks.
 *
 * A stopwatch has no round in progress — the run itself is the work — so its
 * seconds are never forfeited, not even in strict mode. A timed session keeps
 * every round it finished; strict forfeits only the round in progress. The
 * 20-second accident window (`discard`) writes nothing at all.
 */
export function sessionEnd({
  mode = 'timer',
  finished = false,
  discard = false,
  forfeit = false,
  breakEnd = false,
  seconds = 0,
  elapsedMs = 0,
  minPerRound = 0,
  roundIdx = 1,
} = {}) {
  const stop = mode === 'stop';
  const secs = stop ? Math.max(0, Math.round(Number(seconds) || 0)) : null;
  const banked = completedRoundMinutes(minPerRound, roundIdx);
  /* Strict only has a round to take back when the session is a timed round. */
  const strictForfeit = Boolean(forfeit) && !stop;
  let minutes;
  if (discard) minutes = 0;
  else if (stop) minutes = Math.round(secs / 60);
  else if (breakEnd || strictForfeit) minutes = banked;
  else if (finished) minutes = Math.round((Number(minPerRound) || 0) * Math.max(1, roundIdx));
  else minutes = Math.max(0, Math.round((Number(elapsedMs) || 0) / 60000));
  return {
    writeRecord: stop && !discard && !breakEnd,
    secs,
    minutes,
    discarded: Boolean(discard) || (strictForfeit && banked === 0),
    forfeited: strictForfeit && banked > 0,
    breakEnd: Boolean(breakEnd) && !discard,
  };
}
