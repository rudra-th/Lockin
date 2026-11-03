/* Lockin — Home: "how is today going, and what do I do next?"
   The exam countdown, the day's numbers, one clear way into Study Mode, and
   the tasks that are actually waiting today. No timetable assumptions. */

import { Store } from '../store.js';
import { Router } from '../router.js';
import { el, todayKey, prettyDate, fmtMin, addDays, daysUntil } from '../util.js';
import { svg } from '../icons.js';
import { formatExamMonth } from '../exams.js';
import { taskList } from '../tasks.js';

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

/* ---------- tile strip: today's numbers as type ---------- */

function tileStrip(focusMin, streak, cleanDays, tasks) {
  const goal = Store.state.settings.goalMin;
  const done = tasks.filter((t) => t.doneAt).length;
  const cells = [];

  cells.push({
    label: 'Focused', value: fmtMin(focusMin),
    caption: goal ? `of ${fmtMin(goal)} goal` : 'today',
    bar: goal ? clamp01(focusMin / goal) : 0,
  });
  cells.push({
    label: 'Streak', value: streak ? String(streak) : '0',
    caption: streak ? 'clean days in a row' : 'no clean days yet',
  });
  cells.push({
    label: 'Tasks', value: tasks.length ? `${done}/${tasks.length}` : '—',
    caption: tasks.length
      ? (done === tasks.length ? 'all done today' : 'done today')
      : 'nothing added today',
    bar: tasks.length ? done / tasks.length : null,
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

/* ---------- honest week: 7 cells, tick for clean, hollow for fell-short ---------- */

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

/* ---------- one way in ---------- */

function focusCard({ live, subjects, suggestedMin }) {
  const startBtn = live
    ? el('button', {
        class: 'btn btn-primary btn-block',
        onclick: () => Router.go('/focus'),
      }, svg('play', 17), 'Back to the live session')
    : el('button', {
        class: 'btn btn-primary btn-block',
        onclick: () => Router.go(`/focus?min=${suggestedMin}`),
      }, svg('lock', 18), 'Start Study Mode',
      el('span', { class: 'mono', style: 'font-size:12.5px;opacity:0.75' }, `· ${suggestedMin}m`));

  const chips = subjects.length
    ? el('div', { class: 'chips' }, subjects.map((a) => el('button', {
        class: 'chip', style: `--h:${a.hue}`,
        'aria-pressed': 'false',
        onclick: () => Router.go(`/focus?min=${suggestedMin}&subj=${a.id}`),
      }, el('i', { class: 'dot' }), a.name)))
    : null;

  return el('div', { class: 'card hero' },
    el('div', { class: 'hlabel' }, live ? 'Running' : 'Study Mode'),
    el('div', { class: 'hbig' }, live ? 'Back to the room.' : 'Sit down. Start the clock.'),
    el('div', { class: 'hfine' },
      live
        ? 'The session is still running. Return before the app decides you left.'
        : subjects.length
          ? 'Pick a length and a subject on the next screen. The room stays awake and keeps the target in view.'
          : 'Name your first subject in Study Mode, then start. Nothing is preloaded for you.'),
    chips,
    startBtn,
  );
}

/* ---------- render ---------- */

function render(host) {
  const t = todayKey();
  const cfg = Store.state.settings;
  const focusMin = Store.focusMinutesOn(t);
  const streak = Store.streakUpTo(t);
  const subjects = Store.subjects();
  const tasks = Store.tasksOn(t);
  const done = tasks.filter((x) => x.doneAt).length;
  const week = weekRail(t);
  const band = examBand();
  const live = Store.state.session
    && ['running', 'break', 'paused'].includes(Store.state.session.phase);
  const suggestedMin = cfg.pomo?.focus || 25;

  host.append(el('section', { class: 'view-anim stagger' },
    el('div', { class: 'app-head' },
      el('div', { class: 'grow' },
        el('h1', {}, greeting()),
        el('div', { class: 'sub' }, prettyDate(t)),
      ),
      el('button', {
        class: 'iconbtn', 'aria-label': 'Open Plan', innerHTML: svg('book'),
        onclick: () => Router.go('/plan'),
      }),
    ),
    band,
    tileStrip(focusMin, streak, week.cleanDays, tasks),
    focusCard({ live, subjects, suggestedMin }),
    el('div', { class: 'card' },
      el('div', { class: 'taskdayhead' },
        el('div', {},
          el('h2', {}, 'Today’s tasks'),
          el('div', { class: 'taskday-date' }, done === tasks.length && tasks.length ? 'All clear.' : 'Small, finishable things.'),
        ),
        el('span', { class: `pill${tasks.length && done === tasks.length ? ' acc' : ''}` },
          tasks.length ? `${done}/${tasks.length} done` : 'empty'),
      ),
      taskList(t, tasks, {
        emptyText: 'No tasks yet. Add the first thing you want to finish today.',
        placeholder: 'Add a task for today…',
        onChange: rerender,
      }),
      el('button', {
        class: 'btn btn-subtle btn-block', style: 'margin-top:10px',
        onclick: () => Router.go('/plan'),
      }, svg('book', 16), 'Plan tomorrow'),
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
  if (!host) return;
  const scroll = host.scrollTop;
  host.textContent = '';
  render(host);
  host.scrollTop = scroll;
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
