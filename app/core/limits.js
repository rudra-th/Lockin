/* Lockin core — daily allowance arithmetic for the browser extension.
   Pure: no chrome, no storage, no clock of its own. The worker, the popup and
   the blocked page all call the same functions, so "spent" means one thing.

   The day boundary is local midnight (`dateKey`), which is also the reset:
   yesterday's seconds live under yesterday's key and simply never count. */

import { dateKey } from './time.js';

/** Allowances are whole minutes; 0 or absent means no limit. */
export const MAX_LIMIT_MIN = 1440;

/** A gap longer than this was sleep, a closed lid or a killed worker — not
    time on screen. The worker's alarm commits about once a minute, so a
    normal slice never comes close; only a missed stretch is clipped. */
export const MAX_COMMIT_SEC = 90;

/** Seconds to credit for a stretch of wall-clock time. */
export function creditedSeconds(ms) {
  return Math.min(MAX_COMMIT_SEC, Math.max(0, Math.round((Number(ms) || 0) / 1000)));
}

/**
 * The configured site a host belongs to, most specific first.
 * `m.youtube.com` → `youtube.com` when that is on the list; keeps usage and
 * limits on apex domains instead of splitting them across subdomains.
 */
export function matchSite(host, sites) {
  const h = String(host || '').toLowerCase().replace(/^www\./, '');
  let best = null;
  for (const site of sites || []) {
    if (h === site || h.endsWith(`.${site}`)) {
      if (!best || site.length > best.length) best = site;
    }
  }
  return best;
}

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
