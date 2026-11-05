/* Lockin blocked page — reads the domain and the reason from the redirect,
   and the deadline from the same storage key the worker owns. */

import { limitMinutes, usedSeconds, msUntilReset } from './core/limits.js';
import { surfaceForDomain } from './core/shorts.js';

const KEY = 'lockin.ext';
const params = new URLSearchParams(location.search);
const domain = params.get('d') || 'this site';
const rawWhy = params.get('why');
const why = rawWhy === 'limit' ? 'limit' : rawWhy === 'shorts' ? 'shorts' : 'block';
const surface = why === 'shorts' ? surfaceForDomain(domain) : null;

const siteEl = document.getElementById('site');
const leftEl = document.getElementById('left');
const footEl = document.getElementById('foot');
const endBtn = document.getElementById('end');
const kickerEl = document.getElementById('kicker');
const ledeEl = document.querySelector('.lede');

siteEl.textContent = domain;

const ACTION_LABELS = {
  end: 'End the block',
  home: 'Back to the site',
};

let state = null;
let confirming = false;
let confirmTimer = 0;
let timer = 0;
let action = 'none';

/** One secondary action at a time: end a block, or go back to the site. */
function setAction(kind) {
  endBtn.hidden = kind === 'none';
  if (!kind) {
    action = 'none';
    return;
  }
  const changed = action !== kind;
  action = kind;
  if (changed || !confirming) endBtn.textContent = ACTION_LABELS[kind];
}

function homeUrl() {
  return domain === 'this site' ? null : `https://${domain.replace(/^https?:\/\//, '')}/`;
}

async function read() {
  const got = await chrome.storage.local.get(KEY);
  return got[KEY] || {};
}

function spanLabel(ms, tail) {
  const mins = Math.max(1, Math.ceil(ms / 60000));
  return mins >= 60
    ? `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, '0')}m ${tail}`
    : `${mins} min ${tail}`;
}

function limitStillSpent() {
  if (state?.off?.[domain]) return false;
  const limit = limitMinutes(state?.limits, domain);
  const used = usedSeconds(state?.usage, domain);
  return limit > 0 && used >= limit * 60;
}

function resetConfirm() {
  confirming = false;
  clearTimeout(confirmTimer);
  if (action === 'end') endBtn.textContent = ACTION_LABELS.end;
}

function paint() {
  if (why === 'shorts') {
    kickerEl.textContent = 'Short videos';
    ledeEl.textContent = 'Not the scroll hole.';
    leftEl.textContent = surface
      ? `${surface.label} is off while the toggle is on.`
      : 'Short-video feeds are off while the toggle is on.';
    footEl.textContent = 'The feed is still there. Turn short videos back on in the Lockin popup.';
    document.title = 'Short videos — Lockin';
    setAction('home');
    return;
  }

  if (why === 'limit') {
    kickerEl.textContent = 'Daily limit';
    document.title = 'Daily limit — Lockin';
    setAction('none');
    if (!limitStillSpent()) {
      ledeEl.textContent = 'The limit is off.';
      leftEl.textContent = 'Raised for the rest of today.';
      footEl.textContent = 'Reload the site and carry on.';
      setAction('home');
      clearInterval(timer);
      return;
    }
    ledeEl.textContent = 'That’s the allowance.';
    leftEl.textContent = spanLabel(msUntilReset(), 'until the limit resets');
    footEl.textContent = 'The limit resets at midnight. Change it in the Lockin popup.';
    return;
  }

  if (!state?.blockUntil || state.blockUntil <= Date.now()) {
    const spent = limitStillSpent();
    ledeEl.textContent = 'The block is over.';
    leftEl.textContent = spent
      ? 'The daily limit still holds until midnight.'
      : 'The list is off. Go do the thing.';
    footEl.textContent = spent
      ? 'Raise the limit in the Lockin popup to carry on.'
      : 'Close this tab, or head back to the site.';
    setAction(spent ? 'none' : 'home');
    clearInterval(timer);
    return;
  }
  ledeEl.textContent = 'Not now.';
  leftEl.textContent = spanLabel(state.blockUntil - Date.now(), 'left in this block');
  setAction('end');
}

document.getElementById('close').addEventListener('click', async () => {
  const tab = await chrome.tabs.getCurrent();
  if (tab?.id != null) chrome.tabs.remove(tab.id);
  else window.close();
});

endBtn.addEventListener('click', async () => {
  if (action === 'home') {
    const url = homeUrl();
    if (url) location.href = url;
    return;
  }
  if (action !== 'end') return;

  if (!confirming) {
    confirming = true;
    endBtn.textContent = 'Click again to end it';
    confirmTimer = setTimeout(resetConfirm, 4000);
    return;
  }

  resetConfirm();
  state = { ...(await read()), blockUntil: 0 };
  await chrome.storage.local.set({ [KEY]: state });
  try { await chrome.runtime.sendMessage({ type: 'sync' }); } catch (_) { /* worker asleep */ }
  paint();
});

/* If the popup raises the limit or ends the block while this page is open,
   say so. */
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes[KEY]) return;
  state = changes[KEY].newValue || {};
  paint();
});

(async () => {
  state = await read();
  paint();
  timer = setInterval(paint, 1000);
})();
