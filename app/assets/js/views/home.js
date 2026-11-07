/* Lockin — Home: today, in one glance.
   One hero (minutes focused), the next block, and the week. Everything else
   has a tab. */

import { Store } from '../store.js';
import { Router } from '../router.js';
import {
  el, todayKey, prettyDate, fmtMin, daysUntil, dateKey, addDays, clockLabel,
  nextOccurrence, spanLabel, parseKey, DAYS,
} from '../util.js';
import { svg } from '../icons.js';
import { formatExamMonth } from '../exams.js';

export function initHome(Router) {
  Router.register('/home', { mount, unmount });
}

const clamp01 = (x) => Math.max(0, Math.min(1, x));

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

const dayKeyOf = (d) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

function dayLabel(date) {
  const now = new Date();
  if (dayKeyOf(date) === dayKeyOf(now)) return 'Today';
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  if (dayKeyOf(date) === dayKeyOf(tomorrow)) return 'Tomorrow';
  return DAYS[date.getDay()];
}

/** "in 3h 12m" / "in 18m" / "in 2d" — rounded up, never a fake zero. */
function untilLabel(ms) {
  const mins = Math.max(0, Math.ceil(ms / 60000));
  if (mins <= 1) return 'in a minute';
  if (mins < 60) return `in ${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h < 24) return `in ${h}h${m ? ` ${m}m` : ''}`;
  return `in ${Math.round(h / 24)}d`;
}

/** Minutes inside the live session that are not banked yet. */
function liveMinutes() {
  const s = Store.state.session;
  if (!s || !['running', 'paused'].includes(s.phase)) return 0;
  if (s.cfg?.mode === 'stop') {
    const ms = (s.savedMs || 0) + (s.phase === 'running' ? Date.now() - s.startedAt : 0);
    return Math.max(0, Math.floor(ms / 60000));
  }
  return Math.max(0, Math.floor((Date.now() - s.startedAt) / 60000));
}

function isLive() {
  return Boolean(Store.state.session
    && ['running', 'break', 'paused'].includes(Store.state.session.phase));
}

/* ---------- header ---------- */

function topBar() {
  const p = Store.state.profile || {};
  const avatar = el('button', {
    class: 'home-you', type: 'button', 'aria-label': 'Your profile and settings',
    onclick: () => Router.go('/settings'),
  });
  if (p.photo) avatar.append(el('img', { src: p.photo, alt: '' }));
  else avatar.textContent = (p.name || 'You').trim().charAt(0).toUpperCase() || 'Y';

  const exam = el('button', {
    class: `home-exam-line${p.exam || p.examDate ? '' : ' is-empty'}`,
    type: 'button',
    onclick: () => Router.go('/settings?section=study'),
    'aria-label': 'Exam countdown — edit in Settings',
  });

  /* svg() returns markup; Node.append would make it literal text. el()'s
     child handling parses it, so the icon goes through a span. */
  const icon = () => el('span', { class: 'exam-ico', innerHTML: svg('target', 13) });

  if (!p.exam && !p.examDate) {
    exam.append(icon(), el('span', {}, 'Set your exam date'));
  } else {
    const days = p.examDate ? daysUntil(p.examDate) : null;
    const label = p.exam || 'Your exam';
    if (days == null) {
      exam.append(icon(), el('span', {}, label), el('span', {}, '· add date'));
    } else if (days < 0) {
      exam.append(icon(), el('span', {}, label), el('span', {}, '· passed'));
    } else {
      const when = formatExamMonth(p.examDate).replace(/^[≈·]\s*/, '');
      exam.append(icon(), el('span', { class: 'exam-name' }, label), el('b', {}, days === 0 ? 'today' : `${days}d`), el('span', {}, `· ${when}`));
    }
  }

  return el('header', { class: 'home-top' },
    el('div', { class: 'grow' },
      el('div', { class: 'eyebrow' }, prettyDate(todayKey())),
      el('h1', {}, greeting()),
      exam,
    ),
    avatar,
  );
}

/* ---------- hero: today's minutes ---------- */

function heroCard() {
  const goal = Store.goalToday();
  const suggested = Store.state.settings.pomo?.focus || 25;

  const num = el('b', {}, fmtMin(Store.focusMinutesOn(todayKey())));
  const goalLabel = el('span', {}, goal ? `/ ${fmtMin(goal)}` : 'focused');
  const fill = el('i', { style: 'width:0%' });
  const track = el('div', { class: 'hero-track' }, fill);
  const note = el('p', { class: 'hero-note' });
  const live = el('span', { class: 'hero-live', hidden: true }, el('i'), 'Live');
  const card = el('div', { class: 'hero' },
    el('div', { class: 'hero-top' },
      el('span', { class: 'hero-label' }, 'Focus today'),
      live,
    ),
    el('div', { class: 'hero-num' }, num, goalLabel),
    track,
    note,
    el('div', { class: 'hero-actions' },
      el('button', {
        class: 'btn btn-primary btn-block',
        onclick: () => Router.go(isLive() ? '/focus' : `/focus?min=${suggested}&mode=timer`),
      }, svg(isLive() ? 'play' : 'lock', 17), isLive() ? 'Back to the room' : `Start ${suggested} minute${suggested === 1 ? '' : 's'}`),
    ),
  );

  function update(min, nowLive) {
    const g = Store.goalToday();
    const pct = g ? Math.round(clamp01(min / g) * 100) : 0;
    num.textContent = fmtMin(min);
    goalLabel.textContent = g ? `/ ${fmtMin(g)}` : 'focused';
    fill.style.width = `${g ? pct : 0}%`;
    track.setAttribute('aria-label', g ? `${pct}% of ${fmtMin(g)}` : `${fmtMin(min)} focused`);
    card.classList.toggle('is-met', Boolean(g) && min >= g);
    live.hidden = !nowLive;

    if (!min && !g) {
      note.textContent = 'Set a daily target in You to give the day a bar.';
    } else if (!min) {
      note.textContent = `${fmtMin(g)} to go. The clock hasn’t started.`;
    } else if (g && min >= g) {
      note.textContent = `Target cleared · ${fmtMin(min - g)} over. Anything more is a bonus.`;
    } else if (g) {
      note.textContent = `${fmtMin(Math.max(0, g - min))} to go · ${pct}% of today’s target.`;
    } else {
      note.textContent = 'One session at a time.';
    }
  }

  update(Store.focusMinutesOn(todayKey()), isLive());
  return { node: card, update };
}

/* ---------- the next block ---------- */

function nextBlock() {
  const time = el('span', { class: 'next-time' });
  const kicker = el('span', { class: 'next-kicker' });
  const name = el('span', { class: 'next-name' });
  const meta = el('span', { class: 'next-meta' });
  const node = el('button', {
    class: 'next', type: 'button',
    onclick: () => Router.go('/schedule'),
    'aria-label': 'Open the schedule',
  },
    time,
    el('span', { class: 'next-body' }, kicker, name, meta),
    el('span', { class: 'next-go', innerHTML: svg('chevR', 17) }),
  );

  function update() {
    const now = new Date();
    const schedules = Store.schedules();
    const next = nextOccurrence(schedules, now,
      (occ) => Store.isBlockSkipped(occ.schedule.id, dateKey(occ.start)));

    if (!next) {
      node.classList.add('is-empty');
      time.textContent = '—';
      kicker.textContent = schedules.length ? 'No blocks this week' : 'Nothing planned';
      name.textContent = schedules.length ? 'Plan the next one' : 'Build a study block';
      meta.textContent = schedules.length ? 'The alarm rings when a block starts' : 'Recurring blocks give the day a shape';
      return;
    }

    node.classList.remove('is-empty');
    const s = next.schedule;
    const start = new Date(next.start);
    if (next.ongoing) {
      time.replaceChildren(el('b', {}, 'Now'), el('span', {}, `→ ${clockLabel(next.end)}`));
      kicker.textContent = 'In a block';
      kicker.classList.add('is-now');
      name.textContent = s.name;
      meta.textContent = `ends ${untilLabel(next.end - now)}`;
    } else {
      time.replaceChildren(
        el('b', {}, clockLabel(start)),
        el('span', {}, dayLabel(start)),
      );
      kicker.textContent = 'Next up';
      kicker.classList.remove('is-now');
      name.textContent = s.name;
      meta.textContent = `${spanLabel(s)} · ${untilLabel(next.start - now)}`;
    }
  }

  update();
  return { node, update };
}

/* ---------- the week ---------- */

function weekStrip() {
  const days = [];
  for (let i = 6; i >= 0; i -= 1) days.push(addDays(todayKey(), -i));
  const vals = days.map((d) => Store.focusMinutesOn(d));
  const max = Math.max(1, ...vals);
  const total = vals.reduce((a, b) => a + b, 0);

  const node = el('button', {
    class: 'week', type: 'button',
    onclick: () => Router.go('/progress'),
    'aria-label': 'Open the full focus record',
  },
    el('span', { class: 'week-head' },
      el('b', {}, 'This week'),
      el('span', {}, fmtMin(total)),
    ),
    el('span', { class: 'week-bars' }, days.map((d, i) => el('span', {
      class: `week-day${d === todayKey() ? ' is-today' : ''}${vals[i] >= Store.goalFor(d) && vals[i] > 0 ? ' is-met' : ''}`,
    },
      el('i', { class: 'week-fill', style: `height:${Math.max(6, Math.round((vals[i] / max) * 100))}%` }),
      el('span', {}, d === todayKey() ? 'Today' : DAYS[parseKey(d).getDay()].slice(0, 2)),
    ))),
  );

  return node;
}

/* ---------- render ---------- */

let tickTimer = null;
let paintedDay = '';

function paint(host, animate = true) {
  clearInterval(tickTimer);
  paintedDay = todayKey();

  const hero = heroCard();
  const next = nextBlock();

  host.append(el('section', { class: `home${animate ? ' view-anim' : ''}` },
    topBar(),
    hero.node,
    next.node,
    weekStrip(),
  ));

  tickTimer = setInterval(() => {
    if (todayKey() !== paintedDay) {
      host.textContent = '';
      paint(host, false);
      return;
    }
    hero.update(Store.focusMinutesOn(paintedDay) + liveMinutes(), isLive());
    next.update();
  }, 30000);
}

function mount(host) {
  document.body.dataset.mode = '';
  paint(host);
}

function unmount() {
  clearInterval(tickTimer);
  tickTimer = null;
}
