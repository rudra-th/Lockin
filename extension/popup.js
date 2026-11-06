/* Lockin extension popup. Reads the same state key as the worker and asks it
   to rebuild the block rules after every change. */

import { dateKey } from './core/time.js';
import {
  limitMinutes, usedSeconds, spentSites as spentSet,
} from './core/limits.js';

const KEY = 'lockin.ext';
const CLOUD_KEY = 'lockin.cloud';
const CLOUD_PROJECT = 'lockin-29758';
const CLOUD_API = 'AIzaSyCpgy7nEoqaHNgQeDsJXggzNeMDuMP91pY';
const DEFAULTS = { sites: [], off: {}, limits: {}, shorts: true, blockUntil: 0, usage: {} };
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

/**
 * Read-modify-write against the newest stored state. The popup can sit open
 * while the worker commits usage; writing the copy read at open time would
 * roll the day's clock backwards.
 */
async function mutate(fn) {
  const next = await read();
  fn(next);
  await chrome.storage.local.set({ [KEY]: next });
  state = next;
  try { await chrome.runtime.sendMessage({ type: 'sync' }); } catch (_) { /* worker asleep */ }
  render();
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

/* ---------- phone summary (public doc, pairing code) ---------- */

function fsValue(v) {
  if (!v || typeof v !== 'object') return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('booleanValue' in v) return Boolean(v.booleanValue);
  if ('nullValue' in v) return null;
  if ('mapValue' in v) return fsMap(v.mapValue?.fields);
  if ('arrayValue' in v) return (v.arrayValue?.values || []).map(fsValue);
  return null;
}

function fsMap(fields = {}) {
  const out = {};
  for (const [k, v] of Object.entries(fields || {})) out[k] = fsValue(v);
  return out;
}

async function readCloud() {
  const got = await chrome.storage.local.get(CLOUD_KEY);
  const saved = got[CLOUD_KEY] || {};
  return {
    code: typeof saved.code === 'string' ? saved.code : '',
    data: saved.data || null,
    fetchedAt: Number(saved.fetchedAt) || 0,
    error: String(saved.error || ''),
  };
}

async function fetchCloud(code) {
  const url = `https://firestore.googleapis.com/v1/projects/${CLOUD_PROJECT}/databases/(default)/documents/public/${encodeURIComponent(code)}?key=${CLOUD_API}`;
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (res.status === 404) return { error: 'No summary yet. Open Lockin on your phone.' };
    if (!res.ok) return { error: 'Could not reach the Lockin cloud.' };
    const doc = await res.json();
    return { data: fsMap(doc.fields), fetchedAt: Date.now(), error: '' };
  } catch (_) {
    return { error: 'Offline — showing the last summary.' };
  }
}

function ago(ts) {
  const mins = Math.max(0, Math.round((Date.now() - ts) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  return hrs < 24 ? `${hrs}h ago` : `${Math.round(hrs / 24)}d ago`;
}

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
let cloud = null;          // { code, data, fetchedAt, error }
let pairing = false;
let countdownTimer = 0;
let sitesOpen = false;
let pendingFocus = '';

function announce(text) {
  const el = document.getElementById('a11y-status');
  if (el) el.textContent = text;
}

function pairForm() {
  const input = h('input', {
    class: 'pairinput', type: 'text', value: cloud?.code || '',
    placeholder: 'paste pairing code', autocomplete: 'off', spellcheck: false,
    'aria-label': 'Pairing code from Lockin settings', 'data-focus': 'pair-input',
  });
  const err = h('p', { class: 'pairerr', role: 'alert' }, cloud?.error || '');
  return h('form', {
    class: 'pairform',
    onsubmit: async (ev) => {
      ev.preventDefault();
      const code = input.value.trim().toLowerCase();
      if (!/^[a-z0-9]{16,40}$/.test(code)) {
        err.textContent = 'That code does not look right. Copy it from Settings → Account.';
        return;
      }
      cloud = { code, data: null, fetchedAt: 0, error: '' };
      pairing = false;
      await chrome.storage.local.set({ [CLOUD_KEY]: cloud });
      render();
      refreshCloud();
    },
  },
    input,
    h('button', { type: 'submit', 'data-focus': 'pair-save' }, 'Link'),
    err);
}

function cloudCard() {
  const card = h('section', { class: 'phonecard' });
  const linked = Boolean(cloud?.code);
  card.append(h('div', { class: 'blocktop' },
    h('div', {},
      h('div', { class: 'blocktitle' }, 'Your phone'),
      h('div', { class: 'blockmeta' }, cloud?.data ? 'Screen time · focus' : 'Screen time · focus')),
    linked
      ? h('button', {
        class: 'phonelink', type: 'button', 'data-focus': 'pair-toggle',
        onclick: () => { pairing = !pairing; render(); },
      }, pairing ? 'Close' : 'Change')
      : null));

  if (!linked || pairing) {
    card.append(h('p', { class: 'phonecopy' },
      'Link the app to see your phone’s screen time and focus minutes here. The code is in Settings → Account.'));
    card.append(pairForm());
    if (linked) {
      card.append(h('button', {
        class: 'phonelink', type: 'button', style: 'margin-top:8px',
        onclick: async () => {
          cloud = { code: '', data: null, fetchedAt: 0, error: '' };
          pairing = false;
          await chrome.storage.local.set({ [CLOUD_KEY]: cloud });
          render();
        },
      }, 'Unlink this phone'));
    }
    return card;
  }

  if (!cloud.data) {
    card.append(h('p', { class: 'phonecopy' },
      cloud.error || 'Waiting for the phone to publish. Open Lockin there once.'));
    return card;
  }

  const data = cloud.data;
  const screenMin = Math.max(0, Math.round(Number(data.screen?.today) || 0));
  const focusMin = Math.max(0, Math.round(Number(data.focus?.today) || 0));
  const goalMin = Math.max(0, Math.round(Number(data.goalMin) || 0));
  const week = Array.isArray(data.screen?.week) ? data.screen.week.slice(-7) : [];
  const max = Math.max(1, ...week.map((w) => Number(w?.mins) || 0));

  card.append(h('div', { class: 'phoneheadline' },
    h('b', {}, fmtMins(screenMin)),
    h('span', {}, 'on your phone today')));

  card.append(h('div', { class: 'phonebadges' },
    h('span', { class: 'phonebadge' }, `Focus ${fmtMins(focusMin)}`),
    goalMin ? h('span', { class: 'phonebadge is-quiet' }, `Goal ${fmtMins(goalMin)}`) : null));

  if (week.length) {
    card.append(h('div', {
      class: 'weekbars', role: 'img',
      'aria-label': `Screen time this week: ${week.map((w) => fmtMins(Number(w?.mins) || 0)).join(', ')}`,
    }, week.map((w) => h('i', {
      style: `height:${Math.max(4, Math.round(((Number(w?.mins) || 0) / max) * 100))}%`,
      title: `${w?.day || ''} · ${fmtMins(Number(w?.mins) || 0)}`,
    }))));
  }

  const apps = Array.isArray(data.screen?.apps) ? data.screen.apps.slice(0, 3) : [];
  if (apps.length) {
    card.append(h('ul', { class: 'phoneapps' },
      apps.map((a) => h('li', {},
        h('span', {}, String(a?.label || 'App')),
        h('span', { class: 'time' }, fmtMins(Number(a?.mins) || 0))))));
  }

  card.append(h('div', { class: 'phonefoot' },
    h('span', {}, cloud.fetchedAt ? `Updated ${ago(cloud.fetchedAt)}` : ''),
    h('button', { class: 'phonelink', type: 'button', onclick: () => refreshCloud() }, 'Refresh')));
  return card;
}

async function refreshCloud() {
  if (!cloud?.code) return;
  const out = await fetchCloud(cloud.code);
  cloud = { ...cloud, ...out };
  try { await chrome.storage.local.set({ [CLOUD_KEY]: cloud }); } catch (_) { /* popup closed */ }
  render();
}

function render() {
  clearInterval(countdownTimer);
  const active = document.activeElement;
  if (active && $app.contains(active) && active.dataset.focus) pendingFocus = active.dataset.focus;
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

  $app.append(cloudCard());

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
        h('button', { class: 'endblock', type: 'button', 'data-focus': 'end-block', onclick: endBlock }, 'End block')));
    $app.append(card);
  } else {
    $app.append(h('section', { class: 'blockcard' },
      h('div', { class: 'blocktop' },
        h('div', { class: 'blocktitle' }, 'Block distracting sites'),
        h('div', { class: 'blockmeta' }, `${activeSites.length} on the list`)),
      h('div', { class: 'durations' },
        [25, 45, 60].map((m) => h('button', {
          class: 'dur', type: 'button', 'data-focus': `dur-${m}`, onclick: () => startBlock(m),
          'aria-label': `Block for ${m} minutes`,
        }, m === 60 ? '1h' : `${m}m`)))));
  }

  /* short videos */
  const shortsOn = state.shorts !== false;
  $app.append(h('section', { class: `shortcard${shortsOn ? ' on' : ''}` },
    h('div', { class: 'shortcopy' },
      h('div', { class: 'blocktitle' }, 'Short videos'),
      h('div', { class: 'blockmeta' }, 'Shorts · Reels · Spotlight')),
    h('button', {
      class: `switch${shortsOn ? ' on' : ''}`,
      type: 'button',
      role: 'switch',
      'data-focus': 'shorts',
      'aria-checked': String(shortsOn),
      'aria-label': 'Block short-video feeds',
      onclick: toggleShorts,
    }, h('i', {}))));

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
        'data-focus': `site-${site}`,
        onchange: () => toggleSite(site, box.checked),
        'aria-label': `Block ${site}`,
      });
      details.append(h('div', {
        class: `site-item${isSpent ? ' is-spent' : ''}${state.off[site] ? ' is-off' : ''}`,
      },
        h('div', { class: 'site-top' },
          h('label', { class: 'site-name' }, box, h('span', {}, site)),
          h('button', {
            class: 'remove', type: 'button', 'data-focus': `remove-${site}`, 'aria-label': `Remove ${site}`,
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
              class: 'step', type: 'button', 'data-focus': `limit-${site}-down`, 'aria-label': `Lower limit for ${site}`,
              disabled: limit === 0, onclick: () => setLimit(site, -1),
            }, '−'),
            h('span', { class: 'lim-val' }, limit ? `${limit}m` : 'Off'),
            h('button', {
              class: 'step', type: 'button', 'data-focus': `limit-${site}-up`, 'aria-label': `Raise limit for ${site}`,
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
    autocomplete: 'off', spellcheck: false, 'aria-label': 'Add a site to block', 'data-focus': 'add-input',
  });
  const addHint = h('p', { class: 'addhint', role: 'alert' });
  details.append(h('form', {
    class: 'addform',
    onsubmit: async (ev) => {
      ev.preventDefault();
      const outcome = await addSite(input.value);
      if (outcome === 'bad') {
        addHint.textContent = 'That does not look like a site. Try news.ycombinator.com.';
        input.classList.add('is-bad');
        input.focus();
        return;
      }
      addHint.textContent = '';
      input.classList.remove('is-bad');
      if (outcome === 'dup') announce(`${cleanDomain(input.value)} is already on the list.`);
    },
  }, input, h('button', { type: 'submit', 'data-focus': 'add-submit' }, 'Add')), addHint);
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

  /* A mutation re-renders the whole popup. Put focus back on the control that
     caused it, or on the title when that control no longer exists. */
  if (pendingFocus) {
    const key = pendingFocus;
    pendingFocus = '';
    const next = $app.querySelector(`[data-focus="${CSS.escape(key)}"]`);
    if (next && !next.disabled) {
      next.focus({ preventScroll: true });
    } else {
      const heading = $app.querySelector('h1');
      if (heading) {
        heading.setAttribute('tabindex', '-1');
        heading.focus({ preventScroll: true });
      }
    }
  }
}

async function startBlock(mins) {
  await mutate((s) => { s.blockUntil = Date.now() + mins * 60000; });
  announce(`Block set for ${mins} minutes.`);
}

async function endBlock() {
  await mutate((s) => { s.blockUntil = 0; });
  announce('Block ended.');
}

async function toggleShorts() {
  await mutate((s) => { s.shorts = s.shorts === false; });
  announce(state.shorts === false ? 'Short-video blocking off.' : 'Short-video blocking on.');
}

async function toggleSite(site, on) {
  await mutate((s) => {
    if (on) delete s.off[site];
    else s.off[site] = true;
  });
  announce(`${site} ${on ? 'blocked' : 'unblocked'}.`);
}

async function removeSite(site) {
  await mutate((s) => {
    s.sites = s.sites.filter((x) => x !== site);
    delete s.off[site];
    delete s.limits[site];
  });
  announce(`${site} removed.`);
}

async function setLimit(site, dir) {
  await mutate((s) => {
    const next = nextLimit(limitMinutes(s.limits, site), dir);
    if (next) s.limits[site] = next;
    else delete s.limits[site];
  });
  const limit = limitMinutes(state.limits, site);
  announce(limit ? `${site} limit set to ${limit} minutes.` : `${site} limit removed.`);
}

async function addSite(raw) {
  const site = cleanDomain(raw);
  if (!site) return 'bad';
  if (state.sites.includes(site)) return 'dup';
  await mutate((s) => {
    if (!s.sites.includes(site)) s.sites.push(site);
    delete s.off[site];
  });
  announce(`${site} added.`);
  return 'added';
}

(async () => {
  state = await read();
  cloud = await readCloud();
  render();
  if (cloud.code) refreshCloud();
})();
