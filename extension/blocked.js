/* Lockin blocked page — reads the domain and the reason from the redirect,
   and the deadline from the same storage key the worker owns. */

import { limitMinutes, usedSeconds, msUntilReset } from './core/limits.js';

const KEY = 'lockin.ext';
const params = new URLSearchParams(location.search);
const domain = params.get('d') || 'this site';
const why = params.get('why') === 'limit' ? 'limit' : 'block';

const siteEl = document.getElementById('site');
const leftEl = document.getElementById('left');
const footEl = document.getElementById('foot');
const endBtn = document.getElementById('end');
const kickerEl = document.getElementById('kicker');
const ledeEl = document.querySelector('.lede');

siteEl.textContent = domain;

if (why === 'limit') {
  kickerEl.textContent = 'Daily limit';
  ledeEl.textContent = 'That’s the allowance.';
  footEl.textContent = 'The limit resets at midnight. Change it in the Lockin popup.';
  document.title = 'Daily limit — Lockin';
  endBtn.hidden = true;
}

let state = null;
let confirming = false;
let timer = 0;

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

function paint() {
  if (why === 'limit') {
    if (!limitStillSpent()) {
      ledeEl.textContent = 'The limit is off.';
      leftEl.textContent = 'Raised for the rest of today.';
      footEl.textContent = 'Reload the site and carry on.';
      endBtn.hidden = false;
      endBtn.textContent = 'Try the site';
      clearInterval(timer);
      return;
    }
    ledeEl.textContent = 'That’s the allowance.';
    leftEl.textContent = spanLabel(msUntilReset(), 'until the limit resets');
    return;
  }

  if (!state?.blockUntil || state.blockUntil <= Date.now()) {
    const spent = limitStillSpent();
    leftEl.textContent = spent
      ? 'The block is over. The daily limit holds until midnight.'
      : 'The block is over.';
    endBtn.hidden = true;
    footEl.textContent = spent
      ? 'Raise the limit in the Lockin popup to carry on.'
      : 'The list is off. Go do the thing.';
    clearInterval(timer);
    return;
  }
  leftEl.textContent = spanLabel(state.blockUntil - Date.now(), 'left in this block');
}

document.getElementById('close').addEventListener('click', async () => {
  const tab = await chrome.tabs.getCurrent();
  if (tab?.id != null) chrome.tabs.remove(tab.id);
  else window.close();
});

endBtn.addEventListener('click', async () => {
  if (why === 'limit') {
    location.href = `https://${domain}/`;
    return;
  }

  if (!confirming) {
    confirming = true;
    endBtn.textContent = 'Click again to end it';
    setTimeout(() => {
      confirming = false;
      endBtn.textContent = 'End the block';
    }, 4000);
    return;
  }

  state = { ...(await read()), blockUntil: 0 };
  await chrome.storage.local.set({ [KEY]: state });
  try { await chrome.runtime.sendMessage({ type: 'sync' }); } catch (_) { /* worker asleep */ }
  endBtn.hidden = true;
  footEl.textContent = 'The list is off. Go do the thing.';
  leftEl.textContent = 'The block is over.';
  clearInterval(timer);
});

/* If the popup raises the limit while this page is open, say so. */
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
