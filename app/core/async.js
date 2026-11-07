/* Lockin core — small async helpers that do not need a browser. */

/**
 * A one-way gate for "the newest request wins" races.
 *
 * The caller takes a token before starting async work and checks `isCurrent`
 * before applying the result. A slower, older build can never paint over a
 * newer one, and nothing needs to be cancelled.
 */
export function latestOnly() {
  let current = 0;
  return {
    next() {
      current += 1;
      return current;
    },
    isCurrent(token) {
      return token === current;
    },
  };
}
