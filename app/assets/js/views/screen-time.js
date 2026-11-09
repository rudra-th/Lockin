/* Lockin — Screen time detail.
   The Phone tab keeps one number; this screen is where the days live. It
   shows a 7- or 30-day chart, the selected day's apps, and a plain list of
   past days. Android owns the counters; nothing here leaves the phone. */

import { Store } from '../store.js';
import { Router } from '../router.js';
import { el, parseKey, todayKey, addDays } from '../util.js';
import { svg } from '../icons.js';
import {
  isNative, nativeStatus, queryUsageDaily, openUsageAccessSettings,
} from '../native.js';
import { isTrial, trialScreenTime } from '../trial.js';
import { fmtDur, appHue, recentDays } from '../usage-format.js';

export function initScreenTime(Router) {
  Router.register('/screen-time', { mount });
}

function dayName(day) {
  if (day === todayKey()) return 'Today';
  if (day === addDays(todayKey(), -1)) return 'Yesterday';
  return parseKey(day).toLocaleDateString(undefined, {
    weekday: 'short', day: 'numeric', month: 'short',
  });
}

function shortName(day) {
  const d = parseKey(day);
  if (day === todayKey()) return 'Today';
  return d.toLocaleDateString(undefined, { weekday: 'short' }).slice(0, 2);
}

function mount(host) {
  let range = 7;
  let selected = todayKey();
  let rows = (Store.state.screenTime || []).map((row) => ({
    day: row.day,
    ms: row.mins * 60000,
    apps: (row.apps || []).map((a) => ({ label: a.label, package: a.package, ms: a.mins * 60000 })),
  }));
  let usageOn = isNative || isTrial;
  let demo = isTrial;
  let loading = isNative;
  let busy = false;

  if (isTrial) {
    const t = trialScreenTime();
    rows = t.week.map((row) => ({ ...row, apps: t.apps }));
  }

  const root = el('section', { class: 'view-anim' });
  host.append(root);

  function paint() {
    const byDay = new Map(rows.map((row) => [row.day, row]));
    const days = recentDays(rows, range);
    const todayRow = byDay.get(todayKey());
    const todayMs = todayRow?.ms || 0;

    const previous = days
      .filter((row) => row.day !== todayKey() && row.ms > 0)
      .slice(-7);
    const average = previous.length
      ? previous.reduce((n, row) => n + row.ms, 0) / previous.length
      : 0;
    const diff = average && todayMs ? todayMs - average : 0;
    const deltaText = !average || !todayMs
      ? 'No week to compare yet'
      : Math.abs(diff) < 10 * 60000
        ? 'About your 7-day average'
        : `${fmtDur(Math.abs(diff))} ${diff > 0 ? 'above' : 'below'} your 7-day average`;

    const max = Math.max(...days.map((row) => row.ms), 1);
    const chart = el('div', {
      class: `day-chart${range === 30 ? ' is-month' : ''}`,
      role: 'img',
      'aria-label': `Daily screen time: ${days.map((row) => `${dayName(row.day)} ${fmtDur(row.ms)}`).join(', ')}.`,
    }, days.map((row, i) => {
      const isToday = row.day === todayKey();
      const on = row.day === selected;
      const label = range === 30
        ? (i % 5 === 0 || isToday ? shortName(row.day) : '')
        : (isToday ? 'Today' : shortName(row.day));
      return el('button', {
        class: `day-col${isToday ? ' is-today' : ''}${on ? ' is-on' : ''}`,
        type: 'button',
        title: `${dayName(row.day)} · ${fmtDur(row.ms)}`,
        'aria-pressed': String(on),
        onclick: () => { selected = row.day; paint(); },
      },
        el('i', { class: 'day-bar', style: `height:${Math.max(5, Math.round((row.ms / max) * 100))}%` }),
        el('span', {}, label));
    }));

    const head = el('header', { class: 'app-head' },
      el('div', { class: 'grow' },
        el('h1', {}, 'Screen time'),
        el('div', { class: 'sub' }, demo
          ? 'A demo month for the trial. Real numbers live on the Android app.'
          : 'Foreground time from Android, minus the home screen and Lockin. It stays on this phone.'),
      ),
      el('button', {
        class: 'iconbtn', type: 'button', 'aria-label': 'Back to Phone',
        onclick: () => Router.go('/control'),
      }, svg('chevL', 18)),
    );

    if (!usageOn) {
      root.replaceChildren(
        el('button', { class: 'backrow', type: 'button', onclick: () => Router.go('/control') },
          svg('chevL', 16), 'Phone'),
        head,
        el('div', { class: 'card' },
          el('div', { class: 'empty-state' },
            el('b', {}, isNative ? 'Usage access is off' : 'Screen time is an Android feature'),
            el('p', {}, isNative
              ? 'Android shares per-app foreground time only with apps you allow. Lockin reads the app name and the minutes — never page content, text or keystrokes.'
              : 'On the phone, Lockin reads how long apps stay in front. The web app cannot see other apps, so there is nothing to show here.'),
            isNative
              ? el('button', {
                  class: 'btn btn-primary btn-block',
                  onclick: () => openUsageAccessSettings(),
                }, 'Open usage access')
              : null)),
      );
      return;
    }

    const selectedRow = byDay.get(selected) || { day: selected, ms: 0, apps: [] };
    const selectedApps = (selectedRow.apps || []).slice(0, 6);
    const appMax = Math.max(...selectedApps.map((a) => a.ms), 1);

    const appList = selectedApps.length
      ? el('div', {}, selectedApps.map((app) => {
        const label = String(app.label || app.package || 'App');
        const pct = Math.max(4, Math.round((app.ms / appMax) * 100));
        return el('div', { class: 'app-line' },
          el('span', {
            class: 'app-badge', style: `--h:${appHue(label)}`,
            'aria-hidden': 'true',
          }, label.charAt(0).toUpperCase()),
          el('span', { class: 'app-name' }, label),
          el('span', { class: 'app-time' }, fmtDur(app.ms)),
          el('span', {
            class: 'app-track', role: 'progressbar',
            'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(pct),
            'aria-label': `${label}: ${fmtDur(app.ms)}`,
          }, el('i', { style: `width:${pct}%` })));
      }))
      : el('p', { class: 'muted' }, selectedRow.ms
        ? 'No app breakdown stored for this day.'
        : 'No foreground time recorded for this day.');

    const list = el('div', { class: 'day-list' }, days.slice().reverse().map((row) =>
      el('button', {
        class: `day-row${row.day === selected ? ' is-on' : ''}`,
        type: 'button',
        'aria-pressed': String(row.day === selected),
        onclick: () => { selected = row.day; paint(); },
      },
        el('span', { class: 'dr-day' }, dayName(row.day)),
        el('span', { class: 'dr-total' }, fmtDur(row.ms)),
        el('span', { class: 'menu-go', innerHTML: svg('chevR', 15) }))));

    root.replaceChildren(
      el('button', { class: 'backrow', type: 'button', onclick: () => Router.go('/control') },
        svg('chevL', 16), 'Phone'),
      head,
      el('div', { class: 'segmented range-row', role: 'group', 'aria-label': 'Chart range' },
        [7, 30].map((n) => el('button', {
          class: 'seg-btn', type: 'button',
          'aria-pressed': String(range === n),
          onclick: () => {
            if (range === n) return;
            range = n;
            if (!recentDays(rows, n).some((row) => row.day === selected)) selected = todayKey();
            paint();
          },
        }, `${n} days`))),
      el('div', { class: 'detail-hero' },
        el('div', { class: 'phone-total' },
          el('b', {}, todayMs ? fmtDur(todayMs) : '0m'),
          el('span', {}, 'today')),
        el('p', { class: `phone-delta${diff > 0 ? ' is-up' : ''}` }, deltaText)),
      el('div', { class: 'card' },
        el('div', { class: 'card-head' },
          svg('clock', 14), el('span', {}, `Last ${range} days`)),
        chart),
      el('div', { class: 'select-day' },
        el('span', { class: 'sd-date' }, dayName(selected)),
        el('div', { class: 'sd-total' }, fmtDur(selectedRow.ms)),
        el('span', { class: 'sd-note' },
          selectedApps.length
            ? `${selectedApps.length} app${selectedApps.length === 1 ? '' : 's'} · tap another day above`
            : 'Top apps for this day'),
        el('div', { class: 'split-bar' }, appList)),
      el('div', { class: 'most-head' },
        el('b', {}, 'Past days'),
        el('span', {}, loading ? 'Refreshing…' : demo ? 'Demo' : 'On device')),
      list,
      demo
        ? el('p', { class: 'tiny', style: 'margin-top:16px' }, 'Demo data for the trial. On Android this is your real foreground time, read on the phone.')
        : null,
    );
  }

  async function load() {
    if (busy || !isNative) return;
    busy = true;
    try {
      const [status, daily] = await Promise.all([
        nativeStatus(), queryUsageDaily(30),
      ]);
      usageOn = Boolean(status?.usage);
      if (usageOn) {
        rows = daily.length
          ? daily.map((row) => ({
              day: row.day,
              ms: row.ms,
              apps: (row.apps || []).map((a) => ({ label: a.label, package: a.package, ms: a.ms })),
            }))
          : rows;
        demo = false;
      }
    } finally {
      loading = false;
      busy = false;
      if (document.contains(root)) paint();
    }
  }

  paint();
  load();

  const onVisible = () => {
    if (!document.contains(root)) { removeEventListener('visibilitychange', onVisible); return; }
    if (!document.hidden) load();
  };
  addEventListener('visibilitychange', onVisible);
}
