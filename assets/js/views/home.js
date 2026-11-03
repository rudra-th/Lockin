/* Lockin — Home: "what should I be doing right now, and how is today going?"
   Largest thing answers the first part (now/next + plan shape), the tile strip
   answers the second (focused / streak / planned / week). One primary action:
   Start Study Mode. */

import { Store } from '../store.js';
import { Router } from '../router.js';
import { el, todayKey, prettyDate, slotsToT, fmtMin, addDays, daysUntil } from '../util.js';
import { svg } from '../icons.js';
import { formatExamMonth } from '../exams.js';

let lastMin = 25;

export function initHome(Router) {
  Router.register('/home', { mount, unmount });
}

function clamp01(x) { return Math.max(0, Math.min(1, x)); }

function greeting() {
  const who = Store.state.profile?.name;
  if (who) return `Hey, ${who}`;
  const h = new Date().getHours();
  if (h < 5) return 'Up late';
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  if (h < 22) return 'Good evening';
  return 'Still going';
}

function headSub(t) {
  return prettyDate(t);
}

/* ---------- the exam band: one countdown, no card pile ---------- */

function examBand() {
  const p = Store.state.profile || {};
  if (!p.exam && !p.examDate) return null;

  const days = p.examDate ? daysUntil(p.examDate) : null;
  const past = days != null && days < 0;
  const close = days != null && days >= 0 && days <= 30;
  const exam = p.exam || 'your exam';

  let num = '—';
  let line;
  let sub;
  if (days == null) {
    line = el('span', {}, 'Add the exam date');
    sub = `${exam} · days left will live here`;
  } else if (past) {
    line = el('span', {}, 'Exam passed — update the date');
    sub = `${exam} · ${formatExamMonth(p.examDate)}`;
  } else if (days === 0) {
    num = '0';
    line = el('span', {}, 'Exam day · ', el('em', {}, exam));
    sub = 'Today. Everything you have.';
  } else {
    num = String(days);
    line = el('span', {}, `day${days === 1 ? '' : 's'} left until `, el('em', {}, exam));
    sub = formatExamMonth(p.examDate);
  }

  let aria;
  if (days == null) aria = `Add the exam date for ${exam} in Settings`;
  else if (past) aria = `${exam} exam date has passed — update it in Settings`;
  else if (days === 0) aria = `${exam} is today — edit in Settings`;
  else aria = `${days} day${days === 1 ? '' : 's'} until ${exam} — edit in Settings`;

  return el('button', {
    class: `exambar${close ? ' is-close' : ''}${past ? ' is-past' : ''}`,
    onclick: () => Router.go('/settings'),
    'aria-label': aria,
  },
    el('span', { class: 'eb-num' }, num),
    el('span', { class: 'eb-txt' },
      el('b', { class: 'eb-line' }, line),
      el('span', { class: 'eb-date' }, sub),
    ),
    el('span', { class: 'eb-go', innerHTML: svg('chevR', 16) }),
  );
}

/* ---------- tile strip: the numbers of today, as type (no icon tiles) ---------- */

function tileStrip(t, focusMin, streak, cleanDays) {
  const goal = Store.state.settings.goalMin;
  const cells = [];
  const dayStat = Store.dayStats(t);

  cells.push({
    label: 'Focused', value: fmtMin(focusMin),
    caption: goal ? `of ${fmtMin(goal)} goal` : 'today',
    bar: goal ? clamp01(focusMin / goal) : 0, // progress bar, ends labelled by caption + value
  });
  cells.push({
    label: 'Streak', value: streak ? String(streak) : '0',
    caption: streak ? 'clean days in a row' : 'no clean days yet',
  });
  cells.push({
    label: 'Planned', value: dayStat.tally.study ? fmtMin(dayStat.tally.study) : '—',
    caption: dayStat.tally.study ? 'study on today’s plan' : 'nothing on the plan',
  });
  cells.push({
    label: 'This week', value: `${cleanDays}/7`,
    caption: 'clean days',
  });

  return el('div', { class: 'tilestrip' },
    cells.map((c) => el('div', { class: 'tile' },
      el('div', { class: 'tlabel' }, c.label),
      el('div', { class: 'tvalue' }, c.value),
      c.bar != null
        ? el('div', { class: 'tbar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.round(c.bar * 100)) },
            el('i', { style: `width:${Math.round(c.bar * 100)}%` }))
        : null,
      el('div', { class: 'tcaption' }, c.caption),
    )));
}

/* ---------- now / next hero: the screen's answer, largest ---------- */

function finding(blocks, focusMin, goal) {
  const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
  const nowSlot = nowMin / 30;
  const isStudy = (b) => Store.activity(b.actId)?.kind === 'study';

  const ahead = blocks
    .filter((b) => b.e > nowSlot && isStudy(b))
    .reduce((a, b) => a + (b.e - Math.max(b.s, nowSlot)) * 30, 0);
  const aheadText = fmtMin(Math.max(0, ahead));

  if (!blocks.length) return 'Plan is empty — paint the day, then run it.';
  if (goal && focusMin >= goal) return 'Goal met. Anything more is a bonus.';
  if (!ahead) return 'Nothing left on the plan — the ring is still short of goal.';
  return `${aheadText} of study still on today’s plan.`;
}

function heroBlocks(t, live) {
  const blocks = Store.blocks(t);
  const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
  const nowSlot = nowMin / 30;
  const vis = blocks.filter((b) => Store.activity(b.actId)?.kind !== 'sleep');
  const cur = vis.find((b) => b.s <= nowSlot && nowSlot < b.e);
  const next = vis.find((b) => b.s > nowSlot);
  const liveAct = live && Store.state.session?.cfg
    ? Store.activity(Store.state.session.cfg.subjId) : null;

  /* headline — hue marks study subjects only (colour on data, not decoration) */
  let big, hue, sub;
  if (live) {
    big = liveAct?.name || 'Focus';
    hue = liveAct?.kind === 'study' ? liveAct.hue : null;
    sub = (Store.state.session?.cfg?.mode === 'stop' ? 'Live stopwatch' : 'Live session') + ' — it holds the screen while you work.';
  } else if (cur) {
    const act = Store.activity(cur.actId);
    big = act?.name || 'On plan';
    hue = act?.kind === 'study' ? act.hue : null;
    sub = `till ${slotsToT(cur.e)}`;
  } else if (next) {
    const act = Store.activity(next.actId);
    big = act?.name || 'On plan';
    hue = act?.kind === 'study' ? act.hue : null;
    sub = `starts at ${slotsToT(next.s)}`;
  } else {
    big = blocks.length ? 'Nothing scheduled' : 'Nothing planned';
    hue = null; // free time is neutral ink — the plan's colours stay off it
    sub = blocks.length ? 'the rest of today is yours' : 'the day is untouched';
  }

  return el('div', { class: 'herorow' },
    el('div', { class: 'gyro' },
      el('div', { class: 'hlabel' }, live ? 'Running' : cur ? 'Right now' : next ? 'Next up' : 'Open day'),
      el('div', { class: `hbig${hue ? ' hue' : ''}`, style: hue ? `--h:${hue}` : 'color:var(--tx)' }, big),
      el('div', { class: 'hsub' }, sub),
    ),
  );
}

/* the 24h mini-map — Lockin's signature element, promoted */
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

/* honest week: 7 cells, tick for clean, hollow for fell-short, blank for untouched */
const DAY_LETTERS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

/* compact minutes for the rail's tiny cells: 0m, 45m, 1h, 1h35 — title carries exact */
const railMin = (m) => (m < 60 ? `${m}m`
  : `${Math.floor(m / 60)}h${m % 60 ? String(m % 60).padStart(2, '0') : ''}`);

function weekRail(t) {
  const cells = [];
  let cleanDays = 0;
  for (let i = 6; i >= 0; i -= 1) {
    const d = addDays(t, -i);
    const mins = Store.focusMinutesOn(d);
    const clean = Store.dayClean(d);
    if (clean) cleanDays += 1;
    const dt = new Date(`${d}T12:00:00`);
    const cls = clean ? 'cleaned' : (mins > 0 ? 'broken' : 'flat');
    cells.push(el('div', {
      class: `wday ${cls}${i === 0 ? ' today' : ''}`,
      title: `${prettyDate(d)} · ${fmtMin(mins)} focused${clean ? ' · clean' : mins > 0 ? ' · fell short' : ''}`,
    },
      el('i', { class: 'tick' }),
      el('span', { class: 'm' }, mins ? railMin(mins) : '0m'),
      el('span', { class: 'd' }, i === 0 ? 'Today' : DAY_LETTERS[dt.getDay()]),
    ));
  }
  return { rail: el('div', { class: 'weekstrip' }, cells), cleanDays };
}

/* ---------- render ---------- */

function render(host) {
  const t = todayKey();
  const cfg = Store.state.settings;
  const focusMin = Store.focusMinutesOn(t);
  const streak = Store.streakUpTo(t);
  const subjects = Store.subjects();
  const blocks = Store.blocks(t);
  const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
  const nowSlot = nowMin / 30;
  const live = Store.state.session
    && ['running', 'break', 'paused'].includes(Store.state.session.phase);
  const plannedByAct = {};
  for (const b of blocks) plannedByAct[b.actId] = (plannedByAct[b.actId] || 0) + (b.e - b.s) * 30;

  const week = weekRail(t);
  const band = examBand();

  /* subject pick — planned minutes ride along as honest mono suffixes */
  const subjectChips = el('div', { class: 'chips' },
    subjects.length
      ? subjects.map((a) => el('button', {
          class: 'chip', style: `--h:${a.hue}`,
          'aria-pressed': 'false',
          onclick: () => Router.go(`/focus?min=${lastMin}&subj=${a.id}`),
        }, el('i', { class: 'dot' }), a.name,
        plannedByAct[a.id] > 0
          ? el('span', { class: 'small', style: 'color:var(--tx-2);font-family:var(--font-mono);font-size:11px;margin-left:2px' }, fmtMin(plannedByAct[a.id]))
          : null))
      : [el('button', { class: 'chip add', onclick: () => Router.go('/plan') },
          el('i', { innerHTML: svg('plus', 14) }), 'Add your first subject on the Plan tab')],
  );

  const startBtn = live
    ? el('button', {
        class: 'btn btn-primary btn-block',
        onclick: () => Router.go('/focus'),
      }, svg('play', 17), 'Back to the live session')
    : el('button', {
        class: 'btn btn-primary btn-block',
        onclick: () => Router.go(`/focus?min=${lastMin}`),
      }, svg('lock', 18), 'Start Study Mode',
      el('span', { class: 'mono', style: 'font-size:12.5px;opacity:0.75' }, `· ${lastMin}m`));

  host.append(el('section', { class: 'view-anim stagger' },
    el('div', { class: 'app-head' },
      el('div', { class: 'grow' },
        el('h1', {}, greeting()),
        el('div', { class: 'sub' }, headSub(t)),
      ),
      el('button', {
        class: 'iconbtn', 'aria-label': 'Open the planner', innerHTML: svg('book'),
        onclick: () => Router.go('/plan'),
      }),
    ),
    band,
    tileStrip(t, focusMin, streak, week.cleanDays),
    el('div', { class: 'card hero' },
      heroBlocks(t, live),
      el('div', { class: 'hfine' }, finding(blocks, focusMin, cfg.goalMin)),
      dayShape(blocks, nowSlot),
      subjects.length ? el('div', { style: 'margin:6px 0 2px' }, subjectChips) : null,
      startBtn,
    ),
    el('div', { class: 'card week' },
      el('div', { class: 'row', style: 'margin-bottom:10px' },
        el('b', { class: 'ptitle' }, 'Streak week'),
        el('div', { class: 'sp' }),
        el('span', { class: 'tiny' }, `${week.cleanDays}/7 clean`),
      ),
      week.rail,
    ),
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
