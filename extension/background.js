/* Lockin extension — the blocking and screen-time half.
   The study clock stays in the app; this worker only watches the active tab
   and holds the block list. State lives in one chrome.storage key. */

import { dateKey } from './core/time.js';
import {
  isSpent as allowanceSpent, spentSites as spentSet, msUntilReset,
  matchSite, creditedSeconds,
} from './core/limits.js';
import { isShortsUrl, shortsFilters } from './core/shorts.js';

const KEY = 'lockin.ext';
const TICK = 'lockin.tick';
const DEFAULT_SITES = ['youtube.com', 'instagram.com', 'x.com', 'reddit.com', 'tiktok.com', 'netflix.com'];

const DEFAULTS = {
  sites: DEFAULT_SITES,
  off: {},                 // domain -> true when the user unchecks it
  limits: {},              // domain -> daily allowance in minutes (absent = none)
  shorts: true,            // block short-video feeds (Shorts, Reels, Spotlight)
  blockUntil: 0,           // epoch ms; 0 means no block
  usage: {},               // { 'YYYY-MM-DD': { domain: seconds } }
  active: null,            // { domain, since }
  installedAt: 0,
};

let state = null;

async function load() {
  if (state) return state;
  const got = await chrome.storage.local.get(KEY);
  state = { ...DEFAULTS, ...(got[KEY] || {}) };
  state.sites = [...new Set((state.sites || []).map(cleanDomain).filter(Boolean))];
  state.usage = state.usage || {};
  state.off = state.off || {};
  state.limits = state.limits || {};
  if (!state.installedAt) state.installedAt = Date.now();
  return state;
}

async function save() {
  await chrome.storage.local.set({ [KEY]: state });
}

function cleanDomain(raw) {
  let s = String(raw || '').trim().toLowerCase();
  if (!s) return '';
  s = s.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(s)) return '';
  return s;
}

function domainOf(url) {
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) return null;
    return u.hostname.replace(/^www\./, '') || null;
  } catch (_) {
    return null;
  }
}

/* ---------- daily limits ---------- */

function isSpentNow(domain, now = Date.now()) {
  return allowanceSpent(state?.limits, state?.usage, domain, now);
}

/** Usage and limits live on the configured site, never on a subdomain. */
function siteOf(raw) {
  return matchSite(raw, state?.sites);
}

function spentToday(now = Date.now()) {
  return spentSet(state?.sites, state?.off, state?.limits, state?.usage, now);
}

function blockedPath(domain, why) {
  return `/blocked.html?d=${encodeURIComponent(domain)}&why=${why}`;
}

/** Redirect a tab that is already loaded. DNR only sees future navigations. */
async function redirectIfBlocked(tab) {
  if (!tab?.id || !tab.url) return;
  const raw = domainOf(tab.url);
  if (!raw) return;
  const site = siteOf(raw);
  if (site && !state?.off?.[site]) {
    if (state.blockUntil > Date.now()) {
      await chrome.tabs.update(tab.id, { url: chrome.runtime.getURL(blockedPath(site, 'block')) });
      return;
    }
    if (isSpentNow(site)) {
      await chrome.tabs.update(tab.id, { url: chrome.runtime.getURL(blockedPath(site, 'limit')) });
      return;
    }
  }
  if (state?.shorts !== false && isShortsUrl(tab.url)) {
    await chrome.tabs.update(tab.id, {
      url: chrome.runtime.getURL(blockedPath(site || raw, 'shorts')),
    });
  }
}

/* ---------- usage ---------- */

function commit(now = Date.now()) {
  if (!state?.active) return;
  /* A gap after sleep or a killed worker is not time on screen: cap it. */
  const secs = creditedSeconds(now - state.active.since);
  state.active.since = now;
  if (secs <= 0) return;
  const day = dateKey(new Date(now));
  const bucket = state.usage[day] || (state.usage[day] = {});
  bucket[state.active.domain] = (bucket[state.active.domain] || 0) + secs;
}

async function setActive(domain) {
  await load();
  commit();
  state.active = domain ? { domain, since: Date.now() } : null;
  await save();
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab || null;
}

async function trackFocusedTab() {
  const tab = await activeTab();
  const raw = tab && tab.url ? domainOf(tab.url) : null;
  await setActive(raw ? siteOf(raw) || raw : null);
  if (tab) await redirectIfBlocked(tab);
}

async function enforceActiveTab() {
  const tab = await activeTab();
  if (tab) await redirectIfBlocked(tab);
}

/* ---------- blocking ---------- */

async function syncRules() {
  await load();
  const now = Date.now();
  if (state.blockUntil && state.blockUntil <= now) state.blockUntil = 0;

  const spent = spentToday(now);
  const manual = state.blockUntil > now;

  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  const removeRuleIds = existing.map((r) => r.id);
  const addRules = [];
  let id = 1;
  for (const site of state.sites) {
    if (state.off[site]) continue;
    /* A manual block owns the reason while it lasts; once it ends, a spent
       daily allowance still holds the site until midnight. */
    const why = manual ? 'block' : spent.has(site) ? 'limit' : null;
    if (!why) continue;
    addRules.push({
      id: id++,
      priority: manual ? 3 : 2,
      action: {
        type: 'redirect',
        redirect: { extensionPath: blockedPath(site, why) },
      },
      condition: {
        urlFilter: `||${site}^`,
        resourceTypes: ['main_frame'],
      },
    });
  }

  /* Short feeds are their own toggle: they hold even when the whole site is
     not on the list, and lose to a manual block or a spent allowance. */
  if (state.shorts !== false) {
    for (const { filter, host } of shortsFilters()) {
      addRules.push({
        id: id++,
        priority: 1,
        action: {
          type: 'redirect',
          redirect: { extensionPath: blockedPath(host, 'shorts') },
        },
        condition: {
          urlFilter: filter,
          resourceTypes: ['main_frame'],
        },
      });
    }
  }

  await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds, addRules });
  await paintBadge(spent);
  await save();
}

/* Badge shows the nearest thing that frees a site: the block's countdown,
   or the hours until a spent daily allowance resets at midnight. */
async function paintBadge(spent = spentToday()) {
  const now = Date.now();
  const left = state?.blockUntil > now ? state.blockUntil - now : 0;
  let text = '';
  if (left) {
    text = String(Math.max(1, Math.ceil(left / 60000)));
  } else if (spent.size) {
    const reset = msUntilReset(now);
    text = reset >= 3600000
      ? `${Math.ceil(reset / 3600000)}h`
      : `${Math.max(1, Math.ceil(reset / 60000))}m`;
  }
  if (!text) {
    await chrome.action.setBadgeText({ text: '' });
    return;
  }
  await chrome.action.setBadgeBackgroundColor({ color: '#C6F24E' });
  if (chrome.action.setBadgeTextColor) await chrome.action.setBadgeTextColor({ color: '#0B0D12' });
  await chrome.action.setBadgeText({ text });
}

/* ---------- lifecycle ---------- */

async function boot() {
  await load();
  await chrome.alarms.create(TICK, { periodInMinutes: 1 });
  await syncRules();
  await trackFocusedTab();
}

chrome.runtime.onInstalled.addListener(() => { boot(); });
chrome.runtime.onStartup.addListener(() => { boot(); });

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== TICK) return;
  await load();
  commit();
  await save();
  await enforceActiveTab();
  await syncRules();
});

chrome.tabs.onActivated.addListener(() => { trackFocusedTab(); });

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (!tab.active) return;
  if (changeInfo.url || changeInfo.status === 'complete') {
    await load();
    const raw = tab.url ? domainOf(tab.url) : null;
    await setActive(raw ? siteOf(raw) || raw : null);
    await redirectIfBlocked({ id: tabId, url: tab.url });
  }
});

chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    await setActive(null);
    return;
  }
  await trackFocusedTab();
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== 'sync') return false;
  /* The popup and the blocked page write chrome.storage directly. Drop the
     worker's cached copy before rebuilding, or it rebuilds from stale state
     and the block the user just started never reaches the ruleset. */
  state = null;
  load()
    .then(() => syncRules())
    .then(() => enforceActiveTab())
    .then(() => sendResponse({ ok: true }))
    .catch(() => sendResponse({ ok: false }));
  return true;
});

chrome.runtime.onSuspend?.addListener(() => { commit(); save(); });
