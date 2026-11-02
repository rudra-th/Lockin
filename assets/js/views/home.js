/* Lockin — Home: today's shape, the goal ring, and the door into Study Mode. */

import { Store } from '../store.js';
import { Router } from '../router.js';
import { el, todayKey, prettyDate, slotsToT, fmtMin, addDays } from '../util.js';
import { svg } from '../icons.js';

let lastMin = 25;

export function initHome(Router) {
  Router.register('/home', { mount, unmount });
}

function clamp01(x) { return Math.max(0, Math.min(1, x)); }

function ringFor(pct) {
  const r = 44;
  const c = 2 * Math.PI * r;
  return el('div', { class: 'ringbox' },
    el('svg', { width: 108, height: 108, viewBox: '0 0 108 108' },
      el('circle', { class: 'track', cx: 54, cy: 54, r, fill: 'none', 'stroke-width': 9 }),
      el('circle', {
        class: 'bar', cx: 54, cy: 54, r, fill: 'none', 'stroke-width': 9,
        'stroke-dasharray': String(c),
        'stroke-dashoffset': String(c * (1 - clamp01(pct))),
      })
    ),
    el('div', { class: 'center' },
      `${Math.round(clamp01(pct) * 100)}%`,
      el('small', {}, 'of goal')
    )
  );
}

function greeting() {
  const h = new Date().getHours();
  if (h < 5) return 'Up late';
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  if (h < 22) return 'Good evening';
  return 'Still going';
}

const DAY_LETTERS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

/* genuine 24h mini-map of today's plan, with a ticking now-marker */
function dayShape(blocks, nowSlot) {
  const strip = el('div', { class: 'dayshape' });
  for (const b of blocks) {
    const act = Store.activity(b.actId);
    if (!act) continue;
    strip.append(el('i', {
      class: 'seg',
      style: `--h:${act.hue};left:${(b.s / 48) * 100}%;width:${((b.e - b.s) / 48) * 100}%`,
    }));
  }
  if (nowSlot >= 0 && nowSlot < 48) {
    strip.append(el('i', { class: 'nowmark', style: `left:calc(${(nowSlot / 48) * 100}% - 1px)` }));
  }
  const hours = el('div', { class: 'shapehours' },
    ['00', '06', '12', '18', '24'].map((h) => el('span', {}, h)));
  return el('div', { class: 'shapewrap' }, strip, hours);
}

/* the honest week at a glance — lime is clean, orange is focused-but-broken */
function weekStrip(t) {
  const cols = [];
  let cleanDays = 0;
  for (let i = 6; i >= 0; i -= 1) {
    const d = addDays(t, -i);
    const mins = Store.focusMinutesOn(d);
    const clean = Store.dayClean(d);
    if (clean) cleanDays += 1;
    const dt = new Date(`${d}T12:00:00`);
    const cls = clean ? ' cleaned' : (mins > 0 ? ' broken' : '');
    cols.push(el('div', {
      class: `wday${i === 0 ? ' today' : ''}${cls}`,
      title: `${prettyDate(d)} · ${fmtMin(mins)} focused${clean ? ' · clean' : mins > 0 ? ' · fell short' : ''}`,
    }, el('i'), el('span', { class: 'd' }, i === 0 ? 'Today' : DAY_LETTERS[dt.getDay()])));
  }
  return { strip: el('div', { class: 'weekstrip' }, cols), cleanDays };
}

function render(host) {
  const t = todayKey();
  const cfg = Store.state.settings;
  const focusMin = Store.focusMinutesOn(t);
  const slips = Store.slipCountsOn(t);
  const streak = Store.streakUpTo(t);
  const subjects = Store.subjects();
  const blocks = Store.blocks(t);
  const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
  const nowSlot = nowMin / 30;
  const cur = blocks.find((b) => b.s <= nowSlot && nowSlot < b.e && Store.activity(b.actId)?.kind !== 'sleep');
  const next = blocks.find((b) => b.s > nowSlot);
  const live = Store.state.session;
  const dayStat = Store.dayStats(t);
  const plannedByAct = {};
  for (const b of blocks) plannedByAct[b.actId] = (plannedByAct[b.actId] || 0) + (b.e - b.s) * 30;

  /* today card */
  const nowText = cur
    ? `Now: ${Store.activity(cur.actId)?.name} till ${slotsToT(cur.e)}`
    : next
      ? `Next: ${Store.activity(next.actId)?.name} at ${slotsToT(next.s)}`
      : blocks.length
        ? 'Plan done for today'
        : 'Nothing planned yet';

  const badges = el('div', { class: 'row', style: 'gap:7px;margin-top:10px;flex-wrap:wrap' },
    el('span', { class: 'pill acc', title: 'Clean days in a row' }, svg('flame', 12), ` ${streak} clean`),
    dayStat.tally.study > 0
      ? el('span', { class: 'pill', title: 'Study time actually on today\'s plan' },
          svg('book', 12), ` ${fmtMin(dayStat.tally.study)} planned`)
      : null,
    slips.slip + slips.abandon > 0
      ? el('span', { class: 'pill', style: 'color:var(--warn);border-color:color-mix(in srgb, var(--warn) 45%, transparent)' },
          `${slips.slip + slips.abandon} slip${slips.slip + slips.abandon === 1 ? '' : 's'} today`)
      : null,
    slips.rescue > 0
      ? el('span', { class: 'pill' }, `${slips.rescue} accident${slips.rescue === 1 ? '' : 's'} forgiven`)
      : null,
  );

  const week = weekStrip(t);
  const weekHead = el('div', { class: 'row', style: 'margin-top:16px' },
    el('span', { class: 'tiny', style: 'color:var(--tx-3)' }, 'Last 7 days'),
    el('div', { class: 'sp' }),
    el('span', { class: 'tiny', style: 'color:var(--tx-3)' }, `${week.cleanDays}/7 clean`),
  );

  const todayCard = el('div', { class: 'card' },
    el('h2', {}, 'Today'),
    el('div', { class: 'row', style: 'gap:16px' },
      ringFor(cfg.goalMin ? focusMin / cfg.goalMin : 0),
      el('div', { class: 'grow', style: 'min-width:0' },
        el('div', { style: 'font:600 22px "Instrument Serif", serif;white-space:nowrap' },
          fmtMin(focusMin),
          el('span', { class: 'muted', style: 'font:500 13px Inter, sans-serif;margin-left:6px' }, `of ${fmtMin(cfg.goalMin)}`)),
        el('div', { class: 'muted', style: 'margin-top:4px' }, nowText),
        badges,
      )
    ),
    dayShape(blocks, nowSlot),
    weekHead,
    week.strip,
  );

  /* dive-in card */
  const subjectChips = el('div', { class: 'chips' },
    subjects.length
      ? subjects.map((a) => el('button', {
          class: 'chip', style: `--h:${a.hue}`,
          'aria-pressed': 'false',
          onclick: () => {
            lastMin = lastMin || 25;
            Router.go(`/focus?min=${lastMin}&subj=${a.id}`);
          },
        }, el('i', { class: 'dot' }), a.name,
        plannedByAct[a.id] > 0
          ? el('span', { class: 'tiny', style: 'color:var(--tx-3);font-family:"JetBrains Mono",monospace;font-size:10.5px;margin-left:5px' }, fmtMin(plannedByAct[a.id]))
          : null))
      : el('button', { class: 'chip add', onclick: () => Router.go('/plan') }, el('i', { innerHTML: svg('plus', 14) }), 'Add your first subject on the Plan tab')
  );

  const quick = el('div', { class: 'card tight' },
    el('h2', {}, 'Dive in'),
    el('div', { class: 'chips', style: 'margin-bottom:12px' },
      [25, 45, 50, 90].map((m) =>
        el('button', {
          class: 'chip', 'aria-pressed': String(m === lastMin),
          onclick: () => { lastMin = m; rerender(); },
        }, `${m}m`))),
    subjectChips
  );

  const door = el('button', {
    class: 'btn btn-primary btn-block',
    onclick: () => Router.go(live ? '/focus' : `/focus?min=${lastMin}`),
  },
    svg('lock', 18),
    live ? 'Back to live session' : 'Start Study Mode',
    el('span', { class: 'tiny', style: 'margin-left:2px' }, live ? '' : `· ${lastMin}m`));

  host.append(el('section', { class: 'view-anim stagger' },
    el('div', { class: 'app-head' },
      el('div', { class: 'grow' },
        el('h1', {}, greeting()),
        el('div', { class: 'sub' }, prettyDate(t)),
      ),
      el('button', {
        class: 'iconbtn', 'aria-label': 'Open the planner', innerHTML: svg('book'),
        onclick: () => Router.go('/plan'),
      }),
    ),
    todayCard,
    quick,
    door,
  ));
}

function rerender() {
  const host = document.getElementById('view');
  host.textContent = '';
  render(host);
}

let minuteTimer = null;

function mount(host) {
  document.body.dataset.mode = '';
  render(host);
  minuteTimer = setInterval(rerender, 60000);
}

function unmount() {
  clearInterval(minuteTimer);
}
