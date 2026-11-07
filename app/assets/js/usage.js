/* Lockin — phone screen-time snapshots.
 *
 * Android owns the raw usage counters. This module folds a small daily
 * aggregate (and today's top apps) into the store, where it is local-first
 * like everything else and mirrors to the user's cloud when signed in.
 * The web app has no OS usage access, so this is a no-op there.
 */

import { Store } from './store.js';
import {
  isNative, nativeStatus, queryUsageToday, queryUsageDaily,
} from './native.js';
import { isTrial } from './trial.js';

const MIN_GAP_MS = 5 * 60 * 1000;
let lastRun = 0;

/** Refresh the stored screen-time slice. Returns true when data changed. */
export async function snapshotUsage() {
  if (isTrial || !isNative) return false;
  if (Date.now() - lastRun < MIN_GAP_MS) return false;
  lastRun = Date.now();
  try {
    const status = await nativeStatus();
    if (!status?.usage) return false; // permission off — never invent data
    const [today, month] = await Promise.all([
      queryUsageToday(),
      queryUsageDaily(30),
    ]);
    return Store.recordScreenTime(month, today);
  } catch (_) {
    return false;
  }
}

/** Boot hook: a snapshot now, then occasionally while the app is open. */
export function startUsageSnapshots() {
  if (isTrial || !isNative) return;
  snapshotUsage();
  setInterval(() => { if (!document.hidden) snapshotUsage(); }, 10 * 60 * 1000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) snapshotUsage();
  });
}
