/* Lockin extension — the blocking and screen-time half.
   The study clock stays in the app; this worker only watches the active tab
   and holds the block list. State lives in one chrome.storage key. */

import { todayKey } from './core/time.js';

const KEY = 'lockin.ext';
const TICK = 'lockin.tick';
const DEFAULT_SITES = ['youtube.com', 'instagram.com', 'x.com', 'reddit.com', 'tiktok.com', 'netflix.com'];

const DEFAULTS = {
  sites: DEFAULT_SITES,
  off: {},                 // domain -> true when the user unchecks it
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

/* ---------- usage ---------- */

function commit(now = Date.now()) {
  if (!state?.active) return;
  const secs = Math.round((now - state.active.since) / 1000);
  if (secs <= 0) return;
  const day = todayKey(new Date(now));
  const bucket = state.usage[day] || (state.usage[day] = {});
  bucket[state.active.domain] = (bucket[state.active.domain] || 0) + secs;
  state.active.since = now;
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
  await setActive(tab && tab.url ? domainOf(tab.url) : null);
}

/* ---------- blocking ---------- */

async function syncRules() {
  await load();
  const now = Date.now();
  if (state.blockUntil && state.blockUntil <= now) state.blockUntil = 0;

  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  const removeRuleIds = existing.map((r) => r.id);
  const addRules = [];

  if (state.blockUntil > now) {
    let id = 1;
    for (const site of state.sites) {
      if (state.off[site]) continue;
      addRules.push({
        id: id++,
        priority: 1,
        action: {
          type: 'redirect',
          redirect: { extensionPath: `/blocked.html?d=${encodeURIComponent(site)}` },
        },
        condition: {
          urlFilter: `||${site}^`,
          resourceTypes: ['main_frame'],
        },
      });
    }
  }

  await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds, addRules });
  await paintBadge();
  await save();
}

async function paintBadge() {
  const now = Date.now();
  const left = state?.blockUntil > now ? state.blockUntil - now : 0;
  if (!left) {
    await chrome.action.setBadgeText({ text: '' });
    return;
  }
  const mins = Math.max(1, Math.ceil(left / 60000));
  await chrome.action.setBadgeBackgroundColor({ color: '#C6F24E' });
  if (chrome.action.setBadgeTextColor) await chrome.action.setBadgeTextColor({ color: '#0B0D12' });
  await chrome.action.setBadgeText({ text: String(mins) });
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
  await syncRules();
});

chrome.tabs.onActivated.addListener(() => { trackFocusedTab(); });

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (!tab.active) return;
  if (changeInfo.url || changeInfo.status === 'complete') {
    await load();
    await setActive(tab.url ? domainOf(tab.url) : null);
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
  syncRules().then(() => sendResponse({ ok: true })).catch(() => sendResponse({ ok: false }));
  return true;
});

chrome.runtime.onSuspend?.addListener(() => { commit(); save(); });
