/* Lockin core — daily allowance arithmetic for the browser extension.
   Pure: no chrome, no storage, no clock of its own. The worker, the popup and
   the blocked page all call the same functions, so "spent" means one thing.

   The day boundary is local midnight (`dateKey`), which is also the reset:
   yesterday's seconds live under yesterday's key and simply never count. */

import { dateKey } from './time.js';

/** Allowances are whole minutes; 0 or absent means no limit. */
export const MAX_LIMIT_MIN = 1440;

export function limitMinutes(limits, domain) {
  const n = Math.round(Number(limits?.[domain]) || 0);
  return Math.max(0, Math.min(MAX_LIMIT_MIN, n));
}

/** Seconds the domain has been on screen today (local day). */
export function usedSeconds(usage, domain, now = Date.now()) {
  return Math.round(usage?.[dateKey(new Date(now))]?.[domain] || 0);
}

export function isSpent(limits, usage, domain, now = Date.now()) {
  const limit = limitMinutes(limits, domain);
  return limit > 0 && usedSeconds(usage, domain, now) >= limit * 60;
}

/** The set of blocked sites whose allowance is gone. Unchecked sites never count. */
export function spentSites(sites, off, limits, usage, now = Date.now()) {
  const out = new Set();
  for (const site of sites || []) {
    if (off?.[site]) continue;
    if (isSpent(limits, usage, site, now)) out.add(site);
  }
  return out;
}

/** Milliseconds until the next local midnight. */
export function msUntilReset(now = Date.now()) {
  const d = new Date(now);
  const next = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
  return Math.max(0, next - d);
}
