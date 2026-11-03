/* Lockin blocked page — reads the domain from the redirect and the deadline
   from the same storage key the worker owns. */

const KEY = 'lockin.ext';
const siteEl = document.getElementById('site');
const leftEl = document.getElementById('left');
const footEl = document.getElementById('foot');
const endBtn = document.getElementById('end');

const domain = new URLSearchParams(location.search).get('d') || 'this site';
siteEl.textContent = domain;

let state = null;
let confirming = false;
let timer = 0;

async function read() {
  const got = await chrome.storage.local.get(KEY);
  return got[KEY] || {};
}

function leftLabel(ms) {
  const mins = Math.max(1, Math.ceil(ms / 60000));
  return mins >= 60
    ? `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, '0')}m left in this block`
    : `${mins} min left in this block`;
}

function paint() {
  if (!state?.blockUntil || state.blockUntil <= Date.now()) {
    leftEl.textContent = 'The block is over.';
    endBtn.hidden = true;
    footEl.textContent = 'The list is off. Go do the thing.';
    clearInterval(timer);
    return;
  }
  leftEl.textContent = leftLabel(state.blockUntil - Date.now());
}

document.getElementById('close').addEventListener('click', async () => {
  const tab = await chrome.tabs.getCurrent();
  if (tab?.id != null) chrome.tabs.remove(tab.id);
  else window.close();
});

endBtn.addEventListener('click', async () => {
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

(async () => {
  state = await read();
  paint();
  timer = setInterval(paint, 1000);
})();
