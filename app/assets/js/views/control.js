/* Lockin — Control: the phone side in one place.
   Screen time, app blocking, per-app limits, distraction presets and the
   optional kiosk. Everything here is device-local by design; the synced store
   only holds the kiosk preference. */

import { Store } from '../store.js';
import { el, fmtMin, parseKey } from '../util.js';
import { svg } from '../icons.js';
import { openSheet, hint } from '../ui.js';
import { setrow } from '../controls.js';
import {
  isNative, blockingStatus, saveBlocking, listLaunchableApps,
  saveAppLimits, openAccessibilitySettings, strictStatus, saveStrictPackages,
  nativeStatus, queryUsageToday, queryUsageDaily, openUsageAccessSettings,
} from '../native.js';
import { isTrial, trialScreenTime } from '../trial.js';

export function initControl(Router) {
  Router.register('/control', { mount, unmount });
}

const LIMIT_STEPS = [15, 30, 45, 60, 90, 120, 180];

/* Quick presets: the apps that most often swallow an evening. Only the ones
   actually installed are shown. The list is intentionally conservative — the
   full picker still reaches every launchable app. */
const DISTRACTIONS = [
  {
    group: 'Short videos',
    apps: [
      { pkg: 'com.google.android.youtube', name: 'YouTube' },
      { pkg: 'com.instagram.android', name: 'Instagram' },
      { pkg: 'com.facebook.katana', name: 'Facebook' },
      { pkg: 'com.snapchat.android', name: 'Snapchat' },
      { pkg: 'com.zhiliaoapp.musically', name: 'TikTok' },
      { pkg: 'com.ss.android.ugc.trill', name: 'TikTok' },
    ],
  },
  {
    group: 'Feeds & chat',
    apps: [
      { pkg: 'com.twitter.android', name: 'X' },
      { pkg: 'com.reddit.frontpage', name: 'Reddit' },
      { pkg: 'com.discord', name: 'Discord' },
      { pkg: 'org.telegram.messenger', name: 'Telegram' },
      { pkg: 'com.whatsapp', name: 'WhatsApp' },
    ],
  },
  {
    group: 'Streaming',
    apps: [
      { pkg: 'com.netflix.mediaclient', name: 'Netflix' },
      { pkg: 'com.amazon.avod.media.playback', name: 'Prime Video' },
      { pkg: 'tv.twitch.android.app', name: 'Twitch' },
    ],
  },
];
const OWNER_CMD = 'adb shell dpm set-device-owner com.lockin.app/.LockinDeviceAdminReceiver';
const REMOVE_CMD = 'adb shell dpm remove-active-admin com.lockin.app/.LockinDeviceAdminReceiver';

/* ---------- shared device state ---------- */

let device = null;        // blockingStatus()
let deviceError = false;
let strict = null;        // strictStatus()
let appList = [];
let appsLoaded = false;

let paints = [];
let cleanup = null;
let refreshing = false;

function fmtDur(ms) {
  const mins = Math.max(0, Math.round((Number(ms) || 0) / 60000));
  if (ms > 0 && mins < 1) return '<1m';
  return fmtMin(mins);
}

function appLabel(pkg) {
  const found = appList.find((a) => a.package === pkg);
  if (found) return found.label;
  const tail = String(pkg).split('.').filter(Boolean).pop() || String(pkg);
  return tail.charAt(0).toUpperCase() + tail.slice(1);
}

async function loadApps() {
  appList = await listLaunchableApps();
  appsLoaded = true;
}

async function refresh() {
  if (refreshing) return;
  refreshing = true;
  try {
    const [st, strictSt] = await Promise.all([blockingStatus(), strictStatus()]);
    if (st) { device = st; deviceError = false; } else { deviceError = true; }
    if (strictSt) strict = strictSt;
    if (!appsLoaded) await loadApps();
    paintAll();
  } finally {
    refreshing = false;
  }
}

function paintAll() {
  for (const paint of paints) {
    try { paint(); } catch (_) { /* one broken card must not blank the screen */ }
  }
}

/* Blocking edits share one queue so quick taps cannot drop each other. */
let blockingSaving = false;
let blockingDirty = false;

async function persistBlocking() {
  if (!device) return;
  if (blockingSaving) { blockingDirty = true; return; }
  blockingSaving = true;
  try {
    do {
      blockingDirty = false;
      const next = await saveBlocking({
        enabled: Boolean(device.enabled),
        packages: [...device.packages],
      });
      if (!next) {
        hint('Could not save app blocking. Try again.');
        const actual = await blockingStatus();
        if (actual) device = actual;
        break;
      }
      /* Keep edits made while the save was in flight; take fresh usage. */
      device = {
        ...next,
        enabled: device.enabled,
        packages: device.packages,
        limits: device.limits,
      };
      paintAll();
    } while (blockingDirty);
  } finally {
    blockingSaving = false;
    paintAll();
  }
}

/* Limit edits use their own queue; the native keys do not overlap. */
let limitsSaving = false;
let limitsDirty = false;

async function persistLimits() {
  if (!device) return;
  if (limitsSaving) { limitsDirty = true; return; }
  limitsSaving = true;
  try {
    do {
      limitsDirty = false;
      const next = await saveAppLimits({ ...device.limits });
      if (!next) {
        hint('Could not save that limit. Try again.');
        const actual = await blockingStatus();
        if (actual) device = actual;
        break;
      }
      device = {
        ...next,
        enabled: device.enabled,
        packages: device.packages,
        limits: device.limits,
      };
      paintAll();
    } while (limitsDirty);
  } finally {
    limitsSaving = false;
    paintAll();
  }
}

function setLimit(pkg, minutes) {
  if (!device) return;
  const limits = { ...device.limits };
  if (minutes > 0) limits[pkg] = minutes;
  else delete limits[pkg];
  device = { ...device, limits };
  paintAll();
  persistLimits();
}

/* ---------- mount ---------- */

function mount(host) {
  paints = [];
  const blocking = blockingCard();
  const limits = limitsCard();
  const distractions = distractionCard();
  const strictCardView = strictCard();
  const screen = screenTimeCard();

  paints = [
    blocking.paint, limits.paint, distractions.paint, strictCardView.paint,
  ].filter(Boolean);

  host.append(el('section', { class: 'view-anim stagger' },
    el('div', { class: 'app-head' },
      el('div', { class: 'grow' },
        el('h1', {}, 'Control'),
        el('div', { class: 'sub' }, 'Your phone, on your terms.'),
      ),
      isNative
        ? el('button', {
          class: 'iconbtn', 'aria-label': 'Refresh device state',
          onclick: () => { refresh(); screen.load(); },
        }, svg('refresh', 17))
        : null,
    ),
    isNative
      ? [screen.node, blocking.node, limits.node, distractions.node, strictCardView.node]
      : [...(isTrial ? [screen.node] : []), webCard()],
  ));

  const onVisible = () => { if (!document.hidden) refresh(); };
  addEventListener('visibilitychange', onVisible);
  cleanup = () => {
    removeEventListener('visibilitychange', onVisible);
    screen.cleanup();
  };

  refresh();
}

function unmount() {
  if (cleanup) cleanup();
  cleanup = null;
  paints = [];
}

/* ---------- screen time ---------- */

function appHue(label) {
  let h = 0;
  for (let i = 0; i < label.length; i += 1) h = (h * 31 + label.charCodeAt(i)) % 360;
  return h;
}

function lastSeven(rows) {
  const byDay = new Map(rows.map((row) => [row.day, row.ms]));
  const now = new Date();
  const out = [];
  for (let i = 6; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    out.push({ day: key, ms: byDay.get(key) || 0 });
  }
  return out;
}

function screenTimeCard() {
  const node = el('div', { class: 'card ctl-screen' });
  let data = { loading: true, usageOn: isNative || isTrial, week: [], apps: [], demo: isTrial };
  let busy = false;

  function fmtDay(day) {
    const d = parseKey(day);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) return 'Today';
    return d.toLocaleDateString(undefined, { weekday: 'short' });
  }

  function paint() {
    const { week, apps, demo, usageOn, loading } = data;
    const days = lastSeven(week);
    const total = days[days.length - 1].ms || apps.reduce((n, row) => n + row.ms, 0);
    const max = Math.max(...days.map((row) => row.ms), 1);
    const previous = days.slice(0, -1).filter((row) => row.ms > 0);
    const average = previous.length
      ? previous.reduce((n, row) => n + row.ms, 0) / previous.length
      : 0;
    const diff = average && total ? total - average : 0;
    const deltaText = !average || !total
      ? 'No week to compare yet'
      : Math.abs(diff) < 10 * 60000
        ? 'About your 7-day average'
        : `${fmtDur(Math.abs(diff))} ${diff > 0 ? 'above' : 'below'} your 7-day average`;

    const head = el('div', { class: 'ctl-card-head' },
      el('h2', { class: 'blocking-head' }, svg('clock', 16), el('span', {}, 'Screen time')),
      el('span', { class: 'ctl-tag' }, loading ? '…' : demo ? 'Demo' : usageOn ? 'Today' : 'Off'));

    if (!usageOn) {
      node.replaceChildren(
        head,
        el('div', { class: 'ctl-empty' },
          el('div', { class: 'ctl-empty-icon' }, svg('clock', 24)),
          el('b', {}, 'Usage access is off'),
          el('p', {}, 'Android only shares per-app foreground time with apps you allow. Lockin reads the app name and the minutes — never page content, text or keystrokes.'),
          el('button', {
            class: 'btn btn-primary btn-block',
            onclick: () => openUsageAccessSettings(),
          }, 'Open usage access')),
      );
      return;
    }

    const chartLabel = `Daily screen time: ${days.map((row) => `${fmtDay(row.day)} ${fmtDur(row.ms)}`).join(', ')}.`;
    const chart = el('div', {
      class: 'ctl-chart', role: 'img', 'aria-label': chartLabel,
    }, days.map((row, i) => {
      const today = i === days.length - 1;
      const pct = Math.max(6, Math.round((row.ms / max) * 100));
      return el('div', {
        class: `ctl-day${today ? ' is-today' : ''}`,
        title: `${fmtDay(row.day)} · ${fmtDur(row.ms)}`,
      },
        el('div', { class: 'ctl-day-bar' }, el('i', { style: `height:${pct}%` })),
        el('span', { class: 'ctl-day-name' }, today ? 'Today' : fmtDay(row.day)));
    }));

    const top = apps.slice(0, 4);
    const appMax = Math.max(...top.map((row) => row.ms), 1);
    const most = top.length
      ? el('div', { class: 'ctl-apps' }, top.map((row) => {
        const label = String(row.label || row.package || 'App');
        const pct = Math.max(4, Math.round((row.ms / appMax) * 100));
        return el('div', { class: 'ctl-app' },
          el('span', {
            class: 'ctl-app-badge', style: `--h:${appHue(label)}`,
            'aria-hidden': 'true',
          }, label.charAt(0).toUpperCase()),
          el('span', { class: 'ctl-app-name' }, label),
          el('span', { class: 'ctl-app-time' }, fmtDur(row.ms)),
          el('span', {
            class: 'ctl-app-bar', role: 'progressbar',
            'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(pct),
            'aria-label': `${label}: ${fmtDur(row.ms)} today`,
          }, el('i', { style: `width:${pct}%` })));
      }))
      : el('p', { class: 'muted ctl-first' }, 'No foreground time yet today. Pick up the phone and this fills in.');

    node.replaceChildren(
      head,
      el('div', { class: 'ctl-screen-total' },
        el('b', {}, total ? fmtDur(total) : '0m'),
        el('span', {}, 'on screen today')),
      el('p', { class: `ctl-delta${diff > 0 ? ' is-up' : ''}` }, deltaText),
      chart,
      el('div', { class: 'ctl-chart-foot' }, el('span', {}, 'Last 7 days')),
      el('div', { class: 'ctl-most-head' },
        el('b', {}, 'Most used'),
        el('span', {}, demo ? 'Demo data' : 'Today')),
      most,
      el('p', { class: 'tiny ctl-note' }, demo
        ? 'Demo week for the trial. On Android this is your real foreground time, read on the phone.'
        : 'Per-app foreground time from Android. It stays on this phone.'),
    );
  }

  async function load() {
    if (busy) return;
    busy = true;
    try {
      if (isTrial) {
        const demo = trialScreenTime();
        data = { loading: false, usageOn: true, week: demo.week, apps: demo.apps, demo: true };
      } else if (isNative) {
        const [status, today, week] = await Promise.all([
          nativeStatus(), queryUsageToday(), queryUsageDaily(7),
        ]);
        data = {
          loading: false, usageOn: Boolean(status?.usage),
          week, apps: today, demo: false,
        };
      } else {
        data = { loading: false, usageOn: false, week: [], apps: [], demo: false };
      }
      paint();
    } finally {
      busy = false;
    }
  }

  paint();
  setTimeout(load, 0);

  const onVisible = () => {
    if (!document.contains(node)) { removeEventListener('visibilitychange', onVisible); return; }
    if (!document.hidden) load();
  };
  addEventListener('visibilitychange', onVisible);

  return {
    node,
    load,
    cleanup: () => removeEventListener('visibilitychange', onVisible),
  };
}

/* ---------- app blocking ---------- */

function blockingCard() {
  let query = '';
  let failed = false;

  const servicePill = el('span', { class: 'native-pill' }, '…');
  const serviceBtn = el('button', {
    class: 'btn btn-subtle btn-sm',
    onclick: () => openAccessibilitySettings(),
  }, 'Enable');

  const master = el('button', {
    class: 'switch', role: 'switch', 'aria-checked': 'false',
    'aria-label': 'Block selected apps during focus',
    onclick: () => {
      if (!device) return;
      device = { ...device, enabled: !device.enabled };
      paintAll();
      persistBlocking();
    },
  });

  const summary = el('p', { class: 'tiny blocking-summary' });
  const count = el('span', { class: 'blocking-count' }, '0 selected');
  const search = el('input', {
    class: 'inp', type: 'search', placeholder: 'Search apps…', 'aria-label': 'Search apps to block',
    autocomplete: 'off', spellcheck: 'false',
    oninput: () => { query = search.value.trim().toLowerCase(); renderApps(); },
  });
  const list = el('div', { class: 'app-list', role: 'group', 'aria-label': 'Every app on this phone' });
  const listWrap = el('div', { class: 'app-list-wrap' }, list);

  /* The full picker is a long scrolling list. Keep it closed by default: the
     chips show what is already blocked, and presets, limits and the kiosk
     stay above the fold until someone asks to browse. */
  const picked = el('div', { class: 'app-picked', role: 'group', 'aria-label': 'Apps to block' });
  const browseLabel = el('span', {}, 'Browse all apps');
  const browse = el('button', {
    class: 'btn btn-subtle btn-sm app-browse', type: 'button',
    'aria-expanded': 'false', 'aria-controls': 'blocking-app-list',
  }, svg('grid', 15), browseLabel);
  const pickerBody = el('div', {
    class: 'blocking-picker-body', id: 'blocking-app-list', hidden: true,
  }, search, listWrap, el('p', { class: 'tiny' },
    'Only apps with a launcher icon are listed. The overlay appears when an app comes to the front, and within about 15 seconds if it was already open when a window starts.'));

  browse.onclick = () => {
    const open = pickerBody.hidden;
    pickerBody.hidden = !open;
    browse.setAttribute('aria-expanded', String(open));
    browseLabel.textContent = open ? 'Hide app list' : 'Browse all apps';
    if (open) search.focus({ preventScroll: true });
  };

  function renderPicked() {
    picked.replaceChildren();
    if (!device) {
      picked.append(el('p', { class: 'app-picked-empty' }, 'Reading blocking state…'));
      return;
    }
    if (!device.packages.length) {
      picked.append(el('p', { class: 'app-picked-empty' },
        'No apps picked yet — nothing is blocked.'));
      return;
    }
    const names = new Map(appList.map((app) => [app.package, app.label]));
    for (const pkg of device.packages) {
      const label = names.get(pkg) || pkg.split('.').pop();
      picked.append(el('button', {
        class: 'app-pick-chip', type: 'button', title: pkg,
        'aria-label': `Stop blocking ${label}`,
        onclick: () => {
          if (!device) return;
          device = { ...device, packages: device.packages.filter((p) => p !== pkg) };
          paintAll();
          persistBlocking();
        },
      }, el('span', {}, label), svg('x', 11)));
    }
  }

  const syncFade = () => {
    listWrap.classList.toggle('more',
      list.scrollHeight - list.scrollTop - list.clientHeight > 4);
  };
  list.addEventListener('scroll', syncFade);

  function renderApps() {
    const scroll = list.scrollTop;
    list.replaceChildren();

    if (!device) {
      list.append(el('p', { class: 'app-empty' }, 'Reading blocking state…'));
      syncFade();
      return;
    }
    if (!appsLoaded) {
      list.append(el('p', { class: 'app-empty' }, 'Reading installed apps…'));
      syncFade();
      return;
    }

    const chosen = new Set(device.packages);
    const matches = appList.filter((app) => !query
      || app.label.toLowerCase().includes(query)
      || app.package.toLowerCase().includes(query));

    if (!matches.length) {
      list.append(el('p', { class: 'app-empty' },
        appList.length ? 'No app matches that.' : 'No launchable apps found.'));
      syncFade();
      return;
    }

    for (const app of matches.slice(0, 80)) {
      const on = chosen.has(app.package);
      list.append(el('button', {
        class: `app-row${on ? ' on' : ''}`,
        type: 'button',
        'aria-pressed': String(on),
        title: app.package,
        onclick: () => {
          if (!device) return;
          const set = new Set(device.packages);
          if (set.has(app.package)) set.delete(app.package); else set.add(app.package);
          device = { ...device, packages: [...set] };
          paintAll();
          persistBlocking();
        },
      },
        el('span', { class: 'app-check' }, on ? svg('check', 13) : ''),
        el('span', { class: 'app-name' }, app.label)));
    }

    if (matches.length > 80) {
      list.append(el('p', { class: 'app-empty' },
        `${matches.length - 80} more — keep typing to narrow the list.`));
    }
    list.scrollTop = scroll;
    syncFade();
  }

  function paint() {
    const ready = Boolean(device);
    servicePill.textContent = device ? (device.service ? 'On' : 'Off') : '…';
    servicePill.classList.toggle('on', Boolean(device?.service));
    serviceBtn.textContent = device?.service ? 'Settings' : 'Enable';

    master.setAttribute('aria-checked', String(Boolean(device?.enabled)));
    master.disabled = !ready;
    count.textContent = `${device?.packages?.length || 0} selected`;

    let text;
    let warn = false;
    if (deviceError) {
      text = 'Could not read the blocking state. Pull to refresh or reopen Control.';
      warn = true;
    } else if (!ready) {
      text = 'Reading blocking status…';
    } else if (failed) {
      text = 'Could not save that change. Try again.';
      warn = true;
    } else if (!device.service) {
      text = 'Service off — nothing is blocked yet. Turn on the accessibility service, then pick apps.';
      warn = true;
    } else if (!device.enabled) {
      text = 'Service on. Blocking is switched off.';
    } else if (!device.packages.length) {
      text = 'Service on, but no apps are selected.';
      warn = true;
    } else if (device.active) {
      text = `Covering now: ${device.active.label}, until ${new Date(device.active.end).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.`;
    } else if (device.next) {
      text = `Next window: ${device.next.label}, ${new Date(device.next.start).toLocaleDateString([], { weekday: 'short' })} ${new Date(device.next.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.`;
    } else {
      text = 'No focus windows in the next 14 days. Add a schedule block or start a session.';
    }
    summary.textContent = text;
    summary.classList.toggle('warn', warn);
    renderPicked();
    renderApps();
  }

  const node = el('div', { class: 'card ctl-blocking' },
    el('div', { class: 'ctl-card-head' },
      el('h2', { class: 'blocking-head' }, svg('lock', 16), el('span', {}, 'App blocking')),
      el('span', { class: 'ctl-tag' }, 'During focus')),
    el('div', { class: 'ctl-master' },
      el('div', { class: 'ctl-master-icon' }, svg('shield', 21)),
      el('div', { class: 'ctl-master-txt' },
        el('b', {}, 'Block selected apps'),
        el('span', {}, 'Only during schedule blocks and Study Mode.')),
      master),
    setrow('Accessibility service',
      'Android needs it to see which app comes to the front. Lockin never reads screen content, text or keystrokes.',
      el('div', { class: 'native-ctrl' }, servicePill, serviceBtn)),
    summary,
    el('div', { class: 'blocking-picker' },
      el('div', { class: 'blocking-picker-head' },
        el('b', {}, 'Apps to block'), count),
      picked,
      browse,
      pickerBody));

  return { node, paint };
}

/* ---------- daily limits ---------- */

function limitsCard() {
  const body = el('div', { class: 'ctl-limits' });
  const empty = el('p', { class: 'ctl-empty-line' }, 'No daily limits yet.');
  const pickBtn = el('button', {
    class: 'btn btn-subtle btn-block',
    onclick: () => openLimitPicker(),
  }, svg('plus', 16), 'Add a limit');
  const serviceNote = el('p', { class: 'tiny' });

  function stepLimit(pkg, dir) {
    if (!device) return;
    const current = device.limits[pkg] || 0;
    let idx = LIMIT_STEPS.indexOf(current);
    if (idx < 0) idx = LIMIT_STEPS.findIndex((v) => v >= current);
    if (idx < 0) idx = LIMIT_STEPS.length - 1;
    let next;
    if (dir > 0) next = LIMIT_STEPS[Math.min(LIMIT_STEPS.length - 1, idx + 1)];
    else next = idx <= 0 ? 0 : LIMIT_STEPS[idx - 1];
    setLimit(pkg, next);
  }

  function openLimitPicker() {
    if (!device) return;
    openSheet('Add a daily limit', (close) => {
      const search = el('input', {
        class: 'inp', type: 'search', placeholder: 'Search apps…',
        'aria-label': 'Search apps for a limit', autocomplete: 'off', spellcheck: 'false',
      });
      const list = el('div', { class: 'app-list', role: 'group', 'aria-label': 'Apps to limit' });
      const wrap = el('div', { class: 'app-list-wrap' }, list);
      const done = el('button', { class: 'btn btn-subtle btn-block', style: 'margin-top:12px' }, 'Done');
      done.onclick = () => close();

      let q = '';
      function render() {
        list.replaceChildren();
        if (!appsLoaded) {
          list.append(el('p', { class: 'app-empty' }, 'Reading installed apps…'));
          return;
        }
        const matches = appList.filter((app) => !q
          || app.label.toLowerCase().includes(q)
          || app.package.toLowerCase().includes(q));
        if (!matches.length) {
          list.append(el('p', { class: 'app-empty' }, 'No app matches that.'));
          return;
        }
        for (const app of matches.slice(0, 80)) {
          const limit = device?.limits?.[app.package] || 0;
          list.append(el('button', {
            class: `app-row${limit ? ' on' : ''}`,
            type: 'button',
            'aria-pressed': String(Boolean(limit)),
            title: app.package,
            onclick: () => {
              setLimit(app.package, limit ? 0 : 30);
              render();
            },
          },
            el('span', { class: 'app-check' }, limit ? svg('check', 13) : ''),
            el('span', { class: 'app-name' }, app.label),
            el('span', { class: 'app-limit-tag' }, limit ? fmtMin(limit) : '')));
        }
      }

      search.oninput = () => { q = search.value.trim().toLowerCase(); render(); };
      render();
      return [
        el('p', { class: 'tiny', style: 'margin:0 0 10px' },
          'Thirty minutes to start. Change the allowance on the card after adding.'),
        search, wrap, done,
      ];
    });
  }

  function paint() {
    body.replaceChildren();

    if (!device) {
      body.append(el('p', { class: 'app-empty' }, 'Reading limits…'));
      empty.hidden = true;
    } else {
      const entries = Object.entries(device.limits).sort((a, b) => {
        const pa = (device.usage[a[0]] || 0) / (a[1] * 60000);
        const pb = (device.usage[b[0]] || 0) / (b[1] * 60000);
        return pb - pa;
      });

      empty.hidden = entries.length > 0;
      if (!entries.length) body.append(empty);

      for (const [pkg, limit] of entries) {
        const used = device.usage[pkg] || 0;
        const ratio = Math.min(1, used / Math.max(1, limit * 60000));
        const over = used >= limit * 60000;
        const label = appLabel(pkg);

        body.append(el('div', { class: `ctl-limit${over ? ' is-over' : ''}` },
          el('div', { class: 'ctl-limit-top' },
            el('b', {}, label),
            el('span', { class: 'ctl-limit-time' },
              el('b', {}, fmtDur(used)), ` / ${fmtMin(limit)}`)),
          el('div', {
            class: 'ctl-limit-meter', role: 'progressbar',
            'aria-valuemin': '0', 'aria-valuemax': '100',
            'aria-valuenow': String(Math.round(ratio * 100)),
            'aria-label': `${label}: ${fmtDur(used)} of ${fmtMin(limit)} used today`,
          }, el('i', { class: ratio >= 0.8 ? 'is-warn' : '', style: `width:${Math.max(2, ratio * 100)}%` })),
          el('div', { class: 'ctl-limit-controls' },
            el('span', { class: 'ctl-limit-cap' }, over ? 'Limit spent' : 'Allowance'),
            el('button', {
              class: 'ctl-mini', 'aria-label': `Reduce the ${label} allowance`,
              onclick: () => stepLimit(pkg, -1),
            }, svg('minus', 14)),
            el('span', { class: 'ctl-limit-val' }, fmtMin(limit)),
            el('button', {
              class: 'ctl-mini', 'aria-label': `Increase the ${label} allowance`,
              onclick: () => stepLimit(pkg, 1),
            }, svg('plus', 14)),
            el('button', {
              class: 'ctl-mini ctl-off', 'aria-label': `Remove the ${label} limit`,
              onclick: () => setLimit(pkg, 0),
            }, svg('x', 13)))));
      }
    }

    const on = Boolean(device?.service);
    serviceNote.textContent = on
      ? 'Counts foreground time while the accessibility service is on. Resets at midnight.'
      : 'The accessibility service is off, so limits cannot count or cover anything. Turn it on in App blocking above.';
    serviceNote.classList.toggle('warn', !on);
  }

  const node = el('div', { class: 'card' },
    el('div', { class: 'ctl-card-head' },
      el('h2', { class: 'blocking-head' }, svg('clock', 16), el('span', {}, 'Daily limits')),
      el('span', { class: 'ctl-tag' }, 'Per app')),
    el('p', { class: 'muted ctl-lede' },
      'A soft ceiling per app, every day. When it is spent, the app is covered until midnight.'),
    body,
    pickBtn,
    serviceNote);

  return { node, paint };
}

/* ---------- distraction presets ---------- */

function installedPresets() {
  return DISTRACTIONS
    .map((section) => ({
      group: section.group,
      apps: section.apps
        .filter((app) => appList.some((a) => a.package === app.pkg))
        .filter((app, i, list) => list.findIndex((x) => x.name === app.name) === i),
    }))
    .filter((section) => section.apps.length);
}

function distractionCard() {
  const node = el('div', { class: 'card' });

  function togglePackage(pkg) {
    if (!device) return;
    const set = new Set(device.packages);
    const removing = set.has(pkg);
    if (removing) set.delete(pkg);
    else {
      set.add(pkg);
      device = { ...device, enabled: true };
    }
    device = { ...device, packages: [...set] };
    paintAll();
    persistBlocking();
    hint(removing ? 'Removed from app blocking.' : 'Added to app blocking.');
  }

  function paint() {
    const sections = installedPresets();
    const total = sections.reduce((n, s) => n + s.apps.length, 0);
    const chosen = sections.reduce(
      (n, s) => n + s.apps.filter((a) => device?.packages?.includes(a.pkg)).length, 0);
    const allOn = total > 0 && chosen === total;

    const body = sections.length
      ? sections.map((section) => el('div', { class: 'ctl-preset' },
        el('div', { class: 'ctl-preset-label' }, section.group),
        el('div', { class: 'ctl-chips' },
          section.apps.map((app) => {
            const on = Boolean(device?.packages?.includes(app.pkg));
            const label = appLabel(app.pkg);
            return el('button', {
              class: `ctl-chip ctl-chip-btn${on ? ' is-on' : ''}`,
              type: 'button', 'aria-pressed': String(on),
              'aria-label': `${on ? 'Stop blocking' : 'Block'} ${label}`,
              title: app.pkg,
              onclick: () => togglePackage(app.pkg),
            }, on ? svg('check', 12) : svg('plus', 12), label);
          }))))
      : [el('p', { class: 'ctl-empty-line' },
        appsLoaded
          ? 'No YouTube, Instagram, TikTok, X, Reddit, Discord, Netflix or Twitch found on this phone.'
          : 'Reading installed apps…')];

    node.replaceChildren(
      el('div', { class: 'ctl-card-head' },
        el('h2', { class: 'blocking-head' }, svg('film', 16), el('span', {}, 'Distraction apps')),
        el('span', { class: `native-pill${chosen ? ' on' : ''}` },
          chosen ? `${chosen}/${total}` : 'None')),
      el('p', { class: 'muted ctl-lede' },
        'One tap puts short videos, feeds and streams inside App blocking. Tap again to lift it.'),
      ...body,
      el('button', {
        class: 'btn btn-subtle btn-block',
        disabled: !total || !device,
        onclick: () => {
          if (!device) return;
          const set = new Set(device.packages);
          if (allOn) {
            sections.forEach((s) => s.apps.forEach((a) => set.delete(a.pkg)));
          } else {
            sections.forEach((s) => s.apps.forEach((a) => set.add(a.pkg)));
            device = { ...device, enabled: true };
          }
          device = { ...device, packages: [...set] };
          paintAll();
          persistBlocking();
          hint(allOn ? 'Removed from app blocking.' : 'All distraction apps are covered during focus.');
        },
      }, allOn ? 'Clear all presets' : 'Block every installed preset'),
      el('p', { class: 'tiny ctl-note' },
        'Android sees an app, not a page. It cannot tell Shorts from a normal YouTube video without reading the screen, which Lockin refuses to do. On a laptop, the Lockin extension blocks the /shorts and /reels URLs themselves.'),
    );
  }

  return { node, paint };
}

/* ---------- optional kiosk ---------- */

function strictCard() {
  const pillEl = el('span', { class: 'native-pill' }, 'Reading…');
  const liveRow = el('div', { class: 'ctl-live is-idle' },
    el('i', { class: 'ctl-live-dot' }),
    el('span', { class: 'ctl-live-text' }, 'Reading kiosk…'));
  const chipsEl = el('div', { class: 'ctl-chips' });
  const allowCount = el('span', { class: 'blocking-count' }, '0 allowed');
  const setupBody = el('div');
  const setup = el('details', { class: 'ctl-setup' }, el('summary', {}, 'Set up a real kiosk (one time)'), setupBody);

  const kioskSwitch = el('button', {
    class: 'switch', role: 'switch',
    'aria-checked': String(Boolean(Store.state.settings.kiosk)),
    'aria-label': 'Use kiosk mode during sessions',
    onclick: () => {
      const next = !Store.state.settings.kiosk;
      Store.set((s) => { s.settings.kiosk = next; });
      kioskSwitch.setAttribute('aria-checked', String(next));
      if (next && !strict?.deviceOwner) {
        hint('Kiosk not set up — Android will still let you press Home.');
      }
      if (next && strict && strict.packages.length === 0) {
        hint('No apps allowed yet — only Lockin will open.');
      }
      paintAll();
    },
  });

  const chooseBtn = el('button', {
    class: 'btn btn-subtle btn-block',
    onclick: () => openStrictPicker(),
  }, svg('grid', 16), 'Choose allowed apps');

  let saving = false;
  let pending = null;

  async function persist(list) {
    pending = [...list];
    strict = { ...(strict || {}), packages: [...list] };
    paintAll();
    if (saving) return;
    saving = true;
    while (pending) {
      const next = pending;
      pending = null;
      const res = await saveStrictPackages(next);
      if (!res) {
        hint('Could not save the allowlist. Try again.');
        break;
      }
      strict = { ...res, packages: pending ? strict.packages : res.packages };
      paintAll();
    }
    saving = false;
    paintAll();
  }

  function openStrictPicker() {
    openSheet('Allowed in the kiosk', (close) => {
      const search = el('input', {
        class: 'inp', type: 'search', placeholder: 'Search apps…',
        'aria-label': 'Search allowed apps', autocomplete: 'off', spellcheck: 'false',
      });
      const list = el('div', { class: 'app-list', role: 'group', 'aria-label': 'Allowed apps' });
      const wrap = el('div', { class: 'app-list-wrap' }, list);
      const done = el('button', { class: 'btn btn-subtle btn-block', style: 'margin-top:12px' }, 'Done');
      done.onclick = () => close();

      let q = '';
      function render() {
        list.replaceChildren();
        if (!appsLoaded) {
          list.append(el('p', { class: 'app-empty' }, 'Reading installed apps…'));
          return;
        }
        const matches = appList.filter((app) => !q
          || app.label.toLowerCase().includes(q)
          || app.package.toLowerCase().includes(q));
        if (!matches.length) {
          list.append(el('p', { class: 'app-empty' }, 'No app matches that.'));
          return;
        }
        const chosen = new Set(strict?.packages || []);
        for (const app of matches.slice(0, 80)) {
          const on = chosen.has(app.package);
          list.append(el('button', {
            class: `app-row${on ? ' on' : ''}`,
            type: 'button',
            'aria-pressed': String(on),
            title: app.package,
            onclick: () => {
              const set = new Set(strict?.packages || []);
              if (set.has(app.package)) set.delete(app.package); else set.add(app.package);
              persist([...set]);
              render();
            },
          },
            el('span', { class: 'app-check' }, on ? svg('check', 13) : ''),
            el('span', { class: 'app-name' }, app.label)));
        }
      }

      search.oninput = () => { q = search.value.trim().toLowerCase(); render(); };
      render();
      return [
        el('p', { class: 'tiny', style: 'margin:0 0 10px' },
          'Lockin itself is always allowed. Everything else on the phone is covered while a kiosk session runs.'),
        search, wrap, done,
      ];
    });
  }

  function paint() {
    const owner = Boolean(strict?.deviceOwner);
    const active = Boolean(strict?.active);
    const locked = strict?.lockTask === 'locked';
    const pinned = strict?.lockTask === 'pinned';

    pillEl.textContent = strict ? (owner ? 'Kiosk ready' : 'Limited kiosk') : 'Reading…';
    pillEl.classList.toggle('on', owner);
    pillEl.classList.toggle('warn', Boolean(strict) && !owner);

    liveRow.classList.toggle('is-idle', !active);
    const liveText = liveRow.querySelector('.ctl-live-text');
    if (!strict) {
      liveText.textContent = 'Reading kiosk…';
    } else if (active) {
      liveText.textContent = locked
        ? 'Kiosk holding now — Home, Recents and Settings are closed. End the session in Lockin.'
        : pinned
          ? 'Screen pinned now. Android still shows its own unpin gesture, so this is a strong nudge, not a cage.'
          : 'Covering every app outside the allowlist until the session ends.';
    } else if (strict.armed) {
      liveText.textContent = 'Armed. The next session will hold the phone.';
    } else if (!device?.service && !owner) {
      liveText.textContent = 'Accessibility is off — the kiosk cannot cover apps. Turn it on in App blocking.';
    } else {
      liveText.textContent = owner
        ? 'Ready. A kiosk session pins the phone to Lockin and the allowlist.'
        : 'Ready. Without device owner, Android can still leave Lockin with Home.';
    }

    const pkgs = strict?.packages || [];
    allowCount.textContent = `${pkgs.length} allowed`;
    chipsEl.replaceChildren();
    if (!pkgs.length) {
      chipsEl.append(el('span', { class: 'ctl-chip is-on' }, svg('lock', 12), 'Only Lockin'));
    } else {
      for (const pkg of pkgs.slice(0, 8)) {
        chipsEl.append(el('span', { class: 'ctl-chip is-on' }, svg('check', 12), appLabel(pkg)));
      }
      if (pkgs.length > 8) {
        chipsEl.append(el('span', { class: 'ctl-chip' }, `+${pkgs.length - 8} more`));
      }
    }

    setupBody.replaceChildren(
      owner
        ? [
          el('p', { class: 'tiny' },
            'This phone is Lockin’s device owner. Kiosk sessions can close Home, Recents and Settings.'),
          el('code', { class: 'ctl-cmd' }, REMOVE_CMD),
          el('button', {
            class: 'btn btn-subtle btn-sm',
            onclick: () => copy(REMOVE_CMD),
          }, svg('copy', 14), 'Copy remove command'),
          el('p', { class: 'tiny' },
            'Removing device owner turns the kiosk back into screen pinning. Your data stays.'),
        ]
        : [
          el('p', { class: 'tiny' },
            'Real kiosk needs one command from a computer with USB debugging, on a phone with no accounts or work profile yet. The release APK must already be installed.'),
          el('code', { class: 'ctl-cmd' }, OWNER_CMD),
          el('button', {
            class: 'btn btn-subtle btn-sm',
            onclick: () => copy(OWNER_CMD),
          }, svg('copy', 14), 'Copy setup command'),
          el('p', { class: 'tiny' },
            'Without it, the kiosk still covers apps and pins the screen, but Android always lets you leave with Home. Lockin says “Limited kiosk” instead of pretending.'),
        ],
    );
  }

  function copy(text) {
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text)
        .then(() => hint('Command copied.'))
        .catch(() => hint('Copy failed — select the command instead.'));
    } else {
      hint('Copy failed — select the command instead.');
    }
  }

  const node = el('div', { class: 'card ctl-strict' },
    el('div', { class: 'ctl-card-head' },
      el('h2', { class: 'blocking-head' }, svg('shield', 16), el('span', {}, 'Kiosk')),
      pillEl),
    el('p', { class: 'muted ctl-lede' },
      'No exits, no “just one reel”. While a kiosk session runs, Lockin holds the phone and only the apps you allow can open.'),
    liveRow,
    setrow('Pin the phone during sessions',
      'Every new Study Mode session arms the kiosk. Finish or end the session in Lockin to release it.',
      kioskSwitch),
    el('div', { class: 'ctl-allow-head' },
      el('b', {}, 'Allowed apps'), allowCount),
    chipsEl,
    chooseBtn,
    setup,
    el('p', { class: 'tiny ctl-note' },
      'The kiosk releases itself if Lockin stops responding: the native deadline fails open. Launchers, Settings and the dialer are never covered by the accessibility overlay — only the kiosk can close them.'));

  return { node, paint };
}

/* ---------- web fallback ---------- */

function webCard() {
  const item = (icon, text) => el('li', {}, svg(icon, 16), el('span', {}, text));
  return el('div', { class: 'card ctl-upgrade' },
    el('div', { class: 'ctl-upgrade-badge' }, svg('phone', 26)),
    el('h2', {}, 'The phone side needs Android'),
    el('p', { class: 'ctl-upgrade-lede' },
      'Blocking, daily limits and kiosk sessions use Android’s own accessibility and usage services. A browser cannot see or cover another app — and this trial will not pretend it can.'),
    el('ul', { class: 'ctl-web-list' },
      item('clock', 'Your real screen time, read on the phone.'),
      item('lock', 'Chosen apps covered during focus blocks.'),
      item('shield', 'Kiosk sessions that pin the phone to Lockin.'),
      item('film', 'Short-video and feed presets.')),
    el('div', { class: 'btn-stack ctl-upgrade-actions' },
      el('a', {
        class: 'btn btn-primary btn-block',
        href: '/downloads/lockin.apk', download: '',
      }, svg('phone', 17), 'Get the Android app'),
      el('a', {
        class: 'btn btn-subtle btn-block',
        href: '/downloads/lockin-extension.zip', download: '',
      }, svg('copy', 17), 'Add the Chrome extension'),
    ),
    el('p', { class: 'ctl-upgrade-note' },
      'The extension blocks sites, sets daily site limits and cuts Shorts/Reels URLs. Chrome and Edge only.'),
  );
}
