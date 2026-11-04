/* Lockin — Home: four honest facts about today.
   Days left, today's focus, where the time went, and the next block.
   Tasks live in Schedule; streaks and history live in Stats. Nothing else. */

import { Store } from '../store.js';
import { Router } from '../router.js';
import {
  el, todayKey, prettyDate, fmtMin, daysUntil,
  nextOccurrence, occurrencesOn, spanLabel, DAYS,
} from '../util.js';
import { svg } from '../icons.js';
import { formatExamMonth } from '../exams.js';
import { isNative, nativeStatus, queryUsage, openUsageAccessSettings } from '../native.js';

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

/* ---------- the anchor: days left ---------- */

function examCard() {
  const p = Store.state.profile || {};
  const open = () => Router.go('/settings');

  if (!p.exam && !p.examDate) {
    return el('button', {
      class: 'home-exam is-empty', onclick: open,
      'aria-label': 'Set your exam and date in Settings',
    },
      el('span', { class: 'he-kicker' }, svg('target', 13), 'Your exam'),
      el('span', { class: 'he-side' },
        el('span', { class: 'he-exam' }, 'Set the date — the countdown lives here'),
        el('span', { class: 'he-date' }, 'Settings · Profile'),
      ),
      el('span', { class: 'he-go', innerHTML: svg('chevR', 18) }),
    );
  }

  const days = p.examDate ? daysUntil(p.examDate) : null;
  const past = days != null && days < 0;
  const close = days != null && days >= 0 && days <= 30;
  const exam = p.exam || 'Your exam';

  let num = '—';
  let kicker = 'Your exam';
  let date = 'Add the date in Settings';
  let aria;
  if (days == null) {
    aria = `${exam} — add the exam date in Settings`;
  } else if (past) {
    kicker = 'Exam passed';
    date = 'Set the next one in Settings';
    aria = `${exam} has passed — set the next date in Settings`;
  } else if (days === 0) {
    num = '0';
    kicker = 'Exam day';
    date = 'Today. Everything you have.';
    aria = `${exam} is today`;
  } else {
    num = String(days);
    kicker = 'Days left';
    date = formatExamMonth(p.examDate).replace(/^[≈·]\s*/, '');
    aria = `${days} day${days === 1 ? '' : 's'} left until ${exam} — edit in Settings`;
  }

  return el('button', {
    class: `home-exam${close ? ' is-close' : ''}${past ? ' is-past' : ''}`,
    onclick: open, 'aria-label': aria,
  },
    el('span', { class: 'he-kicker' }, svg('target', 13), kicker),
    el('span', { class: 'he-num' }, num),
    el('span', { class: 'he-side' },
      el('span', { class: 'he-exam' }, exam),
      el('span', { class: 'he-date' }, date),
    ),
    el('span', { class: 'he-go', innerHTML: svg('chevR', 18) }),
  );
}

/* ---------- today's focus ---------- */

function focusCaption(focusMin, live) {
  const goal = Store.state.settings.goalMin || 0;
  const met = goal > 0 && focusMin >= goal;
  const left = Math.max(0, goal - focusMin);
  if (live) return met ? '🎉 Target met. The room is still open.' : `${fmtMin(left)} to go — the clock is running.`;
  if (met) return '🎉 Target met. Anything more is a bonus.';
  if (!goal) return 'Set a daily target in Settings to give the day a bar.';
  return `${fmtMin(left)} to go. One session at a time.`;
}

function focusCard({ focusMin, live, suggestedMin }) {
  const goal = Store.state.settings.goalMin || 0;

  const num = el('b', {}, fmtMin(focusMin));
  const meterFill = goal
    ? el('i', { style: `--pct:${Math.round(clamp01(focusMin / goal) * 100)}%` })
    : null;
  const meter = goal
    ? el('div', {
        class: `hf-meter${focusMin >= goal ? ' is-met' : ''}`, role: 'progressbar',
        'aria-valuemin': '0', 'aria-valuemax': '100',
        'aria-valuenow': String(Math.round(clamp01(focusMin / goal) * 100)),
        'aria-label': `Today: ${fmtMin(focusMin)} of ${fmtMin(goal)}`,
      }, meterFill)
    : null;
  const caption = el('div', { class: 'hf-caption' }, focusCaption(focusMin, live));

  const card = el('div', { class: 'card home-focus' },
    el('div', { class: 'hf-head' },
      el('h2', {}, 'Today'),
      live ? el('span', { class: 'live-pill' }, el('i'), 'In session') : null,
    ),
    el('div', { class: 'hf-num' },
      num,
      goal ? el('span', {}, `/ ${fmtMin(goal)}`) : el('span', {}, 'focused'),
    ),
    meter,
    caption,
    el('button', {
      class: 'btn btn-primary btn-block',
      onclick: () => Router.go(live ? '/focus' : `/focus?min=${suggestedMin}`),
    }, svg(live ? 'play' : 'lock', live ? 17 : 18), live ? 'Back to the room' : 'Start Study Mode',
    live ? null : el('span', { class: 'mono', style: 'font-size:12.5px;opacity:0.75' }, `· ${suggestedMin}m`)),
  );

  function update(min, nowLive) {
    num.textContent = fmtMin(min);
    caption.textContent = focusCaption(min, nowLive);
    if (meter) {
      const pct = Math.round(clamp01(min / goal) * 100);
      meterFill.style.setProperty('--pct', `${pct}%`);
      meter.classList.toggle('is-met', goal > 0 && min >= goal);
      meter.setAttribute('aria-label', `Today: ${fmtMin(min)} of ${fmtMin(goal)}`);
      meter.setAttribute('aria-valuenow', String(pct));
    }
  }

  return { node: card, update };
}

/* ---------- the next block ---------- */

function scheduleCard() {
  const count = el('span', { class: 'sched-count' });
  const body = el('div', { class: 'sched-body' });
  const ctaLabel = el('span', {}, 'Open schedule');
  const cta = el('button', {
    class: 'btn btn-subtle btn-block', onclick: () => Router.go('/schedule'),
  }, svg('calendar', 16), ctaLabel);

  const card = el('div', { class: 'card home-sched' },
    el('div', { class: 'sched-head' },
      el('h2', {}, svg('calendar', 14), el('span', {}, 'Schedule')),
      count,
    ),
    body,
    el('div', { class: 'sched-link' }, cta),
  );

  function update() {
    const now = new Date();
    const schedules = Store.schedules();
    const next = nextOccurrence(schedules, now);
    const todayCount = occurrencesOn(schedules, now).length;

    count.textContent = todayCount ? `${todayCount} today` : '';
    ctaLabel.textContent = next ? 'Open schedule' : 'Plan a block';

    if (!next) {
      body.replaceChildren(el('p', { class: 'sched-empty' },
        schedules.length
          ? 'No blocks in the next week. Add one and the alarm will ring when it starts.'
          : 'Nothing scheduled yet. Recurring blocks are how a day gets a shape.'));
      return;
    }

    const s = next.schedule;
    const when = next.ongoing
      ? `ends ${untilLabel(next.end - now)}`
      : `${dayLabel(next.start)} · ${untilLabel(next.start - now)}`;

    body.replaceChildren(
      el('span', { class: `sched-kicker${next.ongoing ? ' is-now' : ''}` },
        next.ongoing ? el('i') : null,
        next.ongoing ? 'In a block' : 'Next up'),
      el('div', { class: 'sched-name' }, s.name),
      el('div', { class: 'sched-time' }, spanLabel(s)),
      el('div', { class: 'sched-until' }, when),
    );
  }

  update();
  return { node: card, update };
}

/* ---------- where the time went (Android) ---------- */

function screenCard() {
  const card = el('div', { class: 'card home-screen' });
  const body = el('div', { class: 'screen-body' });
  card.append(
    el('div', { class: 'screen-head' },
      el('h2', {}, svg('phone', 14), el('span', {}, 'Screen time')),
      el('span', { class: 'screen-day' }, 'Last 24h'),
    ),
    body,
  );

  let painting = false;
  async function paint() {
    if (painting) return;
    painting = true;
    try {
      const st = await nativeStatus();
      if (!document.contains(card)) return;
      if (!st?.usage) {
        body.replaceChildren(
          el('p', { class: 'screen-copy' },
            'See where the time went. Lockin reads foreground time only — never page content, keystrokes or files.'),
          el('button', {
            class: 'btn btn-subtle btn-block',
            onclick: () => openUsageAccessSettings(),
          }, svg('target', 16), 'Grant usage access'),
        );
        return;
      }
      body.replaceChildren(el('div', { class: 'screen-loading' },
        el('i'), 'Reading the last 24 hours…'));
      const rows = await queryUsage(1);
      if (!document.contains(card)) return;
      if (!rows.length) {
        body.replaceChildren(el('p', { class: 'screen-copy' }, 'No usage recorded yet.'));
        return;
      }
      const total = rows.reduce((n, r) => n + r.ms, 0);
      const max = Math.max(...rows.map((r) => r.ms), 1);
      body.replaceChildren(
        el('div', { class: 'screen-total' },
          el('span', {}, 'Foreground time'),
          el('b', {}, fmtMin(Math.round(total / 60000))),
        ),
        ...rows.slice(0, 3).map((r, i) => el('div', { class: `screen-row${i === 0 ? ' is-top' : ''}` },
          el('b', {}, r.label),
          el('span', {}, r.ms < 60000 ? '<1m' : fmtMin(Math.round(r.ms / 60000))),
          el('div', { class: 'screen-bar' },
            el('i', { style: `width:${Math.max(2, Math.round((r.ms / max) * 100))}%` })),
        )),
      );
    } finally {
      painting = false;
    }
  }

  /* Refresh when the owner returns from the system usage screen. */
  const onVisible = () => {
    if (!document.contains(card)) {
      document.removeEventListener('visibilitychange', onVisible);
      return;
    }
    if (!document.hidden) paint();
  };
  document.addEventListener('visibilitychange', onVisible);
  paint();
  return card;
}

/* ---------- render ---------- */

let tickTimer = null;
let paintedDay = '';

function paint(host, animate = true) {
  clearInterval(tickTimer);
  paintedDay = todayKey();

  const cfg = Store.state.settings;
  const live = isLive();
  const focusMin = Store.focusMinutesOn(paintedDay) + liveMinutes();
  const suggestedMin = cfg.pomo?.focus || 25;

  const focus = focusCard({ focusMin, live, suggestedMin });
  const sched = scheduleCard();

  host.append(el('section', { class: `home${animate ? ' view-anim stagger' : ''}` },
    el('div', { class: 'app-head home-head' },
      el('div', { class: 'grow' },
        el('h1', {}, greeting()),
        el('div', { class: 'sub' }, prettyDate(paintedDay)),
      ),
    ),
    examCard(),
    el('div', { class: 'home-grid' },
      focus.node,
      sched.node,
      isNative ? screenCard() : null,
    ),
  ));

  tickTimer = setInterval(() => {
    /* A page left open overnight belongs to the new day, not yesterday. */
    if (todayKey() !== paintedDay) {
      host.textContent = '';
      paint(host, false);
      return;
    }
    focus.update(Store.focusMinutesOn(paintedDay) + liveMinutes(), isLive());
    sched.update();
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
