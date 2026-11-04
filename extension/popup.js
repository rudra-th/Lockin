/* Lockin extension popup. Reads the same state key as the worker and asks it
   to rebuild the block rules after every change. */

import { dateKey } from './core/time.js';
import {
  limitMinutes, usedSeconds, spentSites as spentSet,
} from './core/limits.js';

const KEY = 'lockin.ext';
const DEFAULTS = { sites: [], off: {}, limits: {}, blockUntil: 0, usage: {} };
const LIMIT_STEPS = [0, 10, 15, 20, 25, 30, 45, 60, 90, 120];

const $app = document.getElementById('app');

function h(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (k in node && k !== 'type' && k !== 'value') node[k] = v;
    else node.setAttribute(k, v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === '') continue;
    node.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return node;
}

const icon = (d, size = 13) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;

async function read() {
  const got = await chrome.storage.local.get(KEY);
  const state = { ...DEFAULTS, ...(got[KEY] || {}) };
  state.limits = state.limits || {};
  return state;
}

async function write(state) {
  await chrome.storage.local.set({ [KEY]: state });
  try { await chrome.runtime.sendMessage({ type: 'sync' }); } catch (_) { /* worker asleep */ }
}

function cleanDomain(raw) {
  let s = String(raw || '').trim().toLowerCase();
  if (!s) return '';
  s = s.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
  return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(s) ? s : '';
}

const fmtMins = (mins) => {
  const m = Math.max(0, Math.round(mins));
  const hh = Math.floor(m / 60);
  const mm = m % 60;
  return hh ? (mm ? `${hh}h ${String(mm).padStart(2, '0')}m` : `${hh}h`) : `${mm}m`;
};

function todayUsage(state) {
  const bucket = state.usage?.[dateKey()] || {};
  const rows = Object.entries(bucket)
    .map(([site, secs]) => ({ site, secs: Math.round(secs) }))
    .filter((r) => r.secs > 0)
    .sort((a, b) => b.secs - a.secs);
  return { rows, total: rows.reduce((n, r) => n + r.secs, 0) };
}

function short(secs) {
  const m = Math.round(secs / 60);
  if (m <= 0) return '0m';
  if (m < 60) return `${m}m`;
  return fmtMins(m);
}

function leftLabel(ms) {
  const mins = Math.max(1, Math.ceil(ms / 60000));
  return mins >= 60 ? `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, '0')}m` : `${mins}m`;
}

function nextLimit(cur, dir) {
  if (dir > 0) {
    return LIMIT_STEPS.find((s) => s > cur) ?? LIMIT_STEPS[LIMIT_STEPS.length - 1];
  }
  const lower = LIMIT_STEPS.filter((s) => s < cur);
  return lower.length ? lower[lower.length - 1] : 0;
}

let state = null;
let countdownTimer = 0;
let sitesOpen = false;

function render() {
  clearInterval(countdownTimer);
  $app.replaceChildren();
  if (!state) return;

  const now = Date.now();
  const holding = state.blockUntil > now;
  const spent = spentSet(state.sites, state.off, state.limits, state.usage);
  const blocking = holding || spent.size > 0;
  const { rows, total } = todayUsage(state);

  /* header */
  const status = h('span', { class: `status${blocking ? ' on' : ''}` },
    h('i', {}),
    blocking ? 'Blocking' : 'Open');
  $app.append(h('header', { class: 'head' },
    h('div', { class: 'wordmark' }, 'Lockin', h('em', {}, '.')),
    status));

  /* today */
  $app.append(h('p', { class: 'kicker' },
    holding ? 'Holding the line' : spent.size ? 'Daily limits' : 'Today'));
  $app.append(h('h1', { class: 'lede' },
    holding ? 'The list is holding.' : spent.size ? 'A limit is holding.' : total ? 'The day, so far.' : 'A quiet start.'));
  $app.append(h('div', { class: 'total' },
    h('b', {}, total ? fmtMins(total / 60) : '0m'),
    h('span', {}, 'on screen today')));

  if (rows.length) {
    const top = rows.slice(0, 4);
    const rest = rows.slice(4);
    const restSecs = rest.reduce((n, r) => n + r.secs, 0);
    const bar = h('div', { class: 'bar', role: 'img', 'aria-label': 'Time by site' });
    top.forEach((r) => bar.append(h('i', { style: `width:${(r.secs / total) * 100}%` })));
    if (restSecs) bar.append(h('i', { style: `width:${(restSecs / total) * 100}%` }));

    const legend = h('ul', { class: 'legend' });
    top.forEach((r) => legend.append(h('li', {},
      h('span', { class: 'site' }, r.site),
      h('span', { class: 'time' }, short(r.secs)),
      h('span', { class: 'pct' }, `${Math.round((r.secs / total) * 100)}%`))));
    if (restSecs) legend.append(h('li', {},
      h('span', { class: 'site' }, `${rest.length} more`),
      h('span', { class: 'time' }, short(restSecs)),
      h('span', { class: 'pct' }, `${Math.round((restSecs / total) * 100)}%`)));
    $app.append(bar, legend);
  } else {
    $app.append(h('p', { class: 'empty' },
      'Nothing tracked yet. Open a tab and the clock starts — this counts Chrome, not your phone.'));
  }

  /* block */
  const activeSites = state.sites.filter((s) => !state.off[s]);
  if (holding) {
    const card = h('section', { class: 'blockcard holding' },
      h('div', { class: 'blocktop' },
        h('div', { class: 'blocktitle' }, 'Blocking distracting sites'),
        h('div', { class: 'blockmeta' }, `${activeSites.length} site${activeSites.length === 1 ? '' : 's'}`)),
      h('div', { class: 'holding-row' },
        h('div', {},
          h('b', { 'data-left': '' }, leftLabel(state.blockUntil - now)),
          h('span', {}, 'left')),
        h('button', { class: 'endblock', type: 'button', onclick: endBlock }, 'End block')));
    $app.append(card);
  } else {
    $app.append(h('section', { class: 'blockcard' },
      h('div', { class: 'blocktop' },
        h('div', { class: 'blocktitle' }, 'Block distracting sites'),
        h('div', { class: 'blockmeta' }, `${activeSites.length} on the list`)),
      h('div', { class: 'durations' },
        [25, 45, 60].map((m) => h('button', {
          class: 'dur', type: 'button', onclick: () => startBlock(m),
          'aria-label': `Block for ${m} minutes`,
        }, m === 60 ? '1h' : `${m}m`)))));
  }

  /* sites */
  const details = h('details', {
    class: 'sites', open: sitesOpen,
    ontoggle: (ev) => { sitesOpen = ev.currentTarget.open; },
  },
    h('summary', {}, h('span', {}, `Sites · ${state.sites.length}`), h('span', {}, 'Edit')));
  if (state.sites.length) {
    state.sites.forEach((site) => {
      const used = usedSeconds(state.usage, site);
      const limit = limitMinutes(state.limits, site);
      const isSpent = !state.off[site] && limit > 0 && used >= limit * 60;
      const pct = limit > 0 ? Math.min(100, Math.round((used / (limit * 60)) * 100)) : 0;
      const box = h('input', {
        type: 'checkbox', checked: !state.off[site],
        onchange: () => toggleSite(site, box.checked),
        'aria-label': `Block ${site}`,
      });
      details.append(h('div', {
        class: `site-item${isSpent ? ' is-spent' : ''}${state.off[site] ? ' is-off' : ''}`,
      },
        h('div', { class: 'site-top' },
          h('label', { class: 'site-name' }, box, h('span', {}, site)),
          h('button', {
            class: 'remove', type: 'button', 'aria-label': `Remove ${site}`,
            onclick: () => removeSite(site),
            innerHTML: icon('<path d="M6 6l12 12M18 6 6 18"/>', 12),
          })),
        h('div', { class: 'site-limit' },
          limit > 0
            ? h('div', {
                class: 'lim-bar', role: 'progressbar',
                'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(pct),
                'aria-label': `${site}: ${short(used)} of ${limit} minutes today`,
              }, h('i', { style: `width:${pct}%` }))
            : h('div', { class: 'lim-bar is-none', 'aria-hidden': 'true' }),
          h('span', { class: 'lim-use' },
            limit > 0 ? `${short(used)} / ${limit}m` : `${short(used)} today`),
          h('div', { class: 'stepper', role: 'group', 'aria-label': `Daily limit for ${site}` },
            h('button', {
              class: 'step', type: 'button', 'aria-label': `Lower limit for ${site}`,
              disabled: limit === 0, onclick: () => setLimit(site, -1),
            }, '−'),
            h('span', { class: 'lim-val' }, limit ? `${limit}m` : 'Off'),
            h('button', {
              class: 'step', type: 'button', 'aria-label': `Raise limit for ${site}`,
              disabled: limit >= LIMIT_STEPS[LIMIT_STEPS.length - 1],
              onclick: () => setLimit(site, 1),
            }, '+'))),
        isSpent ? h('p', { class: 'lim-note' }, 'Blocked for today · resets at midnight') : null));
    });
  } else {
    details.append(h('p', { class: 'empty', style: 'padding-bottom:6px' }, 'No sites yet. Add one below.'));
  }

  const input = h('input', {
    type: 'text', placeholder: 'add a site, e.g. news.ycombinator.com',
    autocomplete: 'off', spellcheck: false, 'aria-label': 'Add a site to block',
  });
  details.append(h('form', {
    class: 'addform',
    onsubmit: (ev) => {
      ev.preventDefault();
      addSite(input.value);
    },
  }, input, h('button', { type: 'submit' }, 'Add')));
  $app.append(details);

  /* footer */
  $app.append(h('footer', { class: 'foot' },
    h('a', {
      href: 'https://lockin.surge.sh', target: '_blank', rel: 'noreferrer',
      innerHTML: `${icon('<circle cx="12" cy="13" r="7.5"/><path d="M12 13V9.5"/><path d="M12 5.5 10.5 4M13.5 4 12 5.5M9.8 4.6h4.4"/>', 14)}<span>Open Study Mode</span>`,
    }),
    h('div', { class: 'note' }, 'Timer lives in the app')));

  if (holding) {
    countdownTimer = setInterval(() => {
      const ms = state.blockUntil - Date.now();
      const out = document.querySelector('[data-left]');
      if (!out) return;
      if (ms <= 0) { render(); return; }
      out.textContent = leftLabel(ms);
    }, 1000);
  }
}

async function startBlock(mins) {
  state.blockUntil = Date.now() + mins * 60000;
  await write(state);
  render();
}

async function endBlock() {
  state.blockUntil = 0;
  await write(state);
  render();
}

async function toggleSite(site, on) {
  if (on) delete state.off[site];
  else state.off[site] = true;
  await write(state);
  render();
}

async function removeSite(site) {
  state.sites = state.sites.filter((s) => s !== site);
  delete state.off[site];
  delete state.limits[site];
  await write(state);
  render();
}

async function setLimit(site, dir) {
  const next = nextLimit(limitMinutes(state.limits, site), dir);
  if (next) state.limits[site] = next;
  else delete state.limits[site];
  await write(state);
  render();
}

async function addSite(raw) {
  const site = cleanDomain(raw);
  if (!site) return;
  if (!state.sites.includes(site)) state.sites.push(site);
  delete state.off[site];
  await write(state);
  render();
}

(async () => {
  state = await read();
  render();
})();
