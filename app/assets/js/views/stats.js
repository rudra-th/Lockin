/* Lockin — Progress: today, all time, the week, tasks, heat, sessions.
   Rendered inside Settings' Progress section, so these are cards to append,
   not a screen with its own heading. A day counts when it reaches the target
   that was in force on that day. */

import { Store } from '../store.js';
import { Router } from '../router.js';
import { el, todayKey, addDays, prettyDate, fmtMin, parseKey, clockLabel } from '../util.js';
import { svg } from '../icons.js';
import { openWeekShare } from '../share.js';

const DAY_LETTERS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const sum = (list) => list.reduce((a, b) => a + b, 0);

function ring(pct, size = 104) {
  const r = (size - 10) / 2;
  const c = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(1, pct));
  return el('svg', {
    width: size, height: size, viewBox: `0 0 ${size} ${size}`,
    role: 'img', 'aria-label': `${Math.round(p * 100)}% of the daily focus target`,
  },
    el('circle', { cx: size / 2, cy: size / 2, r, fill: 'none', stroke: 'var(--line-2)', 'stroke-width': 8 }),
    el('circle', {
      cx: size / 2, cy: size / 2, r, fill: 'none', stroke: 'var(--acc)',
      'stroke-width': 8, 'stroke-linecap': 'round',
      'stroke-dasharray': String(c), 'stroke-dashoffset': String(c * (1 - p)),
    })
  );
}

/* ---------- gathered numbers ---------- */

function focusSessions() {
  return Store.state.sessions.filter((s) => s.kind === 'focus');
}

function allTime() {
  const sessions = focusSessions();
  const totalMins = Math.round(sum(sessions.map((s) => Store.sessionMins(s))));
  const days = [...new Set(sessions.map((s) => s.day))];
  const tasks = Store.state.tasks;
  return {
    totalMins,
    targetDays: Store.targetDaysBetween(days),
    sessions: sessions.length,
    avgMins: sessions.length ? Math.round(totalMins / sessions.length) : 0,
    tasksDone: tasks.filter((t) => t.doneAt).length,
    tasksTotal: tasks.length,
  };
}

/* ---------- empty state ---------- */

function emptyHero() {
  return el('div', { class: 'card emptycard' },
    el('div', { class: 'ec-kicker' }, 'Nothing measured yet'),
    el('div', { class: 'ec-title' }, 'The numbers start when ', el('em', {}, 'the clock does.')),
    el('p', { class: 'ec-copy' },
      'Run one session and the record starts filling in.'),
    el('button', {
      class: 'btn btn-primary btn-block', style: 'margin-top:16px',
      onclick: () => Router.go('/focus'),
    }, svg('lock', 18), 'Start Study Mode'),
  );
}

/* ---------- today ---------- */

function todayCard() {
  const t = todayKey();
  const mins = Store.focusMinutesOn(t);
  const goal = Store.goalToday();
  const pct = goal ? mins / goal : 0;
  const left = Store.goalLeft(t);
  const over = Math.max(0, mins - goal);
  const met = Store.dayGoalMet(t);

  const note = !mins
    ? 'The clock hasn’t started. The ring fills when a session does.'
    : met
      ? `Target cleared — ${fmtMin(over)} over.`
      : `${fmtMin(left)} left to hit the target.`;

  return el('div', { class: 'card' },
    el('div', { class: 'row', style: 'gap:18px' },
      el('div', { class: 'ringbox', style: 'width:104px;height:104px' },
        ring(pct),
        el('div', { class: 'center', style: 'font-size:15px' },
          `${Math.round(Math.min(1, pct) * 100)}%`,
          el('small', {}, 'of target')),
      ),
      el('div', { class: 'grow' },
        el('h2', { style: 'margin-bottom:7px' }, 'Today'),
        el('div', { class: 'stat-lead' }, `${fmtMin(mins)} of ${fmtMin(goal)}`),
        el('div', { class: 'stat-sub' }, note),
      ),
    ),
  );
}

/* ---------- all time ---------- */

function tweakTile(label, value, caption, bar = null) {
  return el('div', { class: 'tile' },
    el('div', { class: 'tlabel' }, label),
    el('div', { class: 'tvalue' }, value),
    bar != null
      ? el('div', { class: 'tbar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.round(bar * 100)) },
          el('i', { style: `width:${Math.round(bar * 100)}%` }))
      : null,
    el('div', { class: 'tcaption' }, caption),
  );
}

function allTimeStrip(all) {
  const taskPct = all.tasksTotal ? all.tasksDone / all.tasksTotal : null;
  return el('div', { class: 'tilestrip' },
    tweakTile('All-time focus', fmtMin(all.totalMins), 'since you started'),
    tweakTile('Target days', String(all.targetDays), 'days that reached their goal'),
    tweakTile('Sessions', String(all.sessions), all.sessions ? `${fmtMin(all.avgMins)} average` : 'none yet'),
    tweakTile(
      'Tasks done',
      all.tasksTotal ? `${all.tasksDone}/${all.tasksTotal}` : '—',
      all.tasksTotal ? `${Math.round(taskPct * 100)}% complete` : 'none added yet',
      taskPct,
    ),
  );
}

/* ---------- last 7 days ---------- */

function weekCard() {
  const t = todayKey();
  const days = [];
  for (let i = 6; i >= 0; i -= 1) days.push(addDays(t, -i));
  const vals = days.map((d) => Store.focusMinutesOn(d));
  const goals = days.map((d) => Store.goalFor(d));
  const max = Math.max(60, ...goals, ...vals) * 1.08;
  const metDays = days.filter((d) => Store.dayGoalMet(d)).length;

  const bars = el('div', { class: 'bars' },
    days.map((d, i) => {
      const isToday = d === t;
      const mins = vals[i];
      const goal = goals[i];
      const met = Store.dayGoalMet(d);
      const fill = !mins ? 'dim' : met ? '' : 'partial';
      return el('div', { class: `barcol${isToday ? ' today' : ''}` },
        el('div', { class: 'barwrap' },
          el('div', {
            class: `bar ${fill}`, style: `height:${mins ? Math.max(4, (mins / max) * 100) : 2}%`,
            title: `${prettyDate(d)} · ${fmtMin(mins)} of ${fmtMin(goal)}${met ? ' · target met' : ''}`,
          }),
          el('div', {
            class: `goalmark${mins >= goal && goal ? ' hit' : ''}`,
            style: `bottom:${Math.min(100, (goal / max) * 100)}%`,
            title: `Target · ${fmtMin(goal)}`,
          }),
        ),
        el('span', { class: 'lbl' }, isToday ? 'Today' : DAY_LETTERS[parseKey(d).getDay()]),
      );
    }),
  );

  const total = sum(vals);

  return el('div', { class: 'card' },
    el('h2', {}, 'Last 7 days'),
    bars,
    el('div', { class: 'weekstats' },
      el('div', {}, el('b', {}, fmtMin(total)), el('span', {}, 'focused')),
      el('div', {}, el('b', {}, `${metDays}/7`), el('span', {}, 'days on target')),
      el('div', {}, el('b', {}, fmtMin(total / 7)), el('span', {}, 'daily average')),
    ),
    el('div', { class: 'chartlegend' },
      el('span', {}, el('i', { class: 'sw acc' }), 'target met'),
      el('span', {}, el('i', { class: 'sw broke' }), 'some focus'),
      el('span', {}, el('i', { class: 'sw goal' }), 'target'),
    ),
    el('button', {
      class: 'btn btn-subtle btn-block', style: 'margin-top:14px',
      onclick: () => openWeekShare(),
    }, svg('share', 15), 'Share the week'),
  );
}

/* ---------- heatmap: 13 weekday-aligned weeks ---------- */

function heatCard() {
  const t = todayKey();
  const WEEKS = 13;
  const cell = 12;
  const gap = 3;
  const labelW = 19;
  const top = 16;
  const W = labelW + WEEKS * (cell + gap) - gap;
  const H = top + 7 * (cell + gap) - gap;

  const svgEl = el('svg', {
    viewBox: `0 0 ${W} ${H}`, role: 'img',
    'aria-label': 'Target-day heatmap for the last 13 weeks',
  });

  /* weekday labels — odd rows only, so the grid stays quiet */
  [1, 3, 5].forEach((di) => {
    svgEl.append(el('text', {
      x: 0, y: top + di * (cell + gap) + cell - 2,
      fill: 'var(--tx-3)', 'font-size': '12', 'font-family': 'var(--font-sans)',
    }, DAY_LETTERS[di]));
  });

  const thisSunday = addDays(t, -parseKey(t).getDay());
  const firstSunday = addDays(thisSunday, -7 * (WEEKS - 1));
  let lastMonth = -1;

  for (let wi = 0; wi < WEEKS; wi += 1) {
    const weekStart = addDays(firstSunday, wi * 7);
    const month = parseKey(weekStart).getMonth();
    if (month !== lastMonth) {
      svgEl.append(el('text', {
        x: labelW + wi * (cell + gap), y: 12,
        fill: 'var(--tx-3)', 'font-size': '12', 'font-family': 'var(--font-sans)',
      }, parseKey(weekStart).toLocaleDateString(undefined, { month: 'short' })));
      lastMonth = month;
    }
    for (let di = 0; di < 7; di += 1) {
      const dayKey = addDays(weekStart, di);
      if (dayKey > t) continue; // the future is not a data point
      const mins = Store.focusMinutesOn(dayKey);
      const met = Store.dayGoalMet(dayKey);
      const fill = met
        ? 'var(--acc)'
        : mins > 0
          ? 'color-mix(in srgb, var(--acc) 28%, var(--panel-2))'
          : 'var(--panel-2)';
      svgEl.append(el('rect', {
        x: labelW + wi * (cell + gap), y: top + di * (cell + gap),
        width: cell, height: cell, rx: 3.5, fill,
        stroke: dayKey === t ? 'var(--tx)' : 'none',
        'stroke-opacity': 0.55,
        'data-day': dayKey,
        'data-mins': String(mins),
        'data-met': String(met),
      }, el('title', {}, `${prettyDate(dayKey)} · ${fmtMin(mins)} of ${fmtMin(Store.goalFor(dayKey))}${met ? ' · target met' : ''}`)));
    }
  }

  return el('div', { class: 'card hm' },
    el('h2', {}, 'Target days · 13 weeks'),
    svgEl,
    el('div', { class: 'chartlegend' },
      el('span', {}, el('i', { class: 'sw acc' }), 'target met'),
      el('span', {}, el('i', { class: 'sw quiet' }), 'some focus'),
      el('span', {}, el('i', { class: 'sw empty' }), 'quiet'),
    ),
  );
}

/* ---------- recent sessions ---------- */

function recentCard() {
  const all = focusSessions()
    .slice()
    .sort((a, b) => b.start - a.start);
  const row = (s) => el('div', { class: 'sesrow' },
    el('div', { class: 'grow' },
      el('div', { class: 'ses-name' }, 'Focus',
        s.aborted ? el('span', { class: 'ses-tag' }, 'ended early') : null),
      el('div', { class: 'ses-when' }, s.manual
        ? `${prettyDate(s.day)} · added`
        : `${prettyDate(s.day)} · ${clockLabel(s.start)}`),
    ),
    el('span', { class: 'ses-mins' }, fmtMin(Store.sessionMins(s))),
  );
  const rows = all.slice(0, 4).map(row);
  const older = all.slice(4, 20).map(row);

  return el('div', { class: 'card' },
    el('h2', {}, 'Recent sessions'),
    rows.length
      ? el('div', {},
          rows,
          older.length
            ? el('details', { class: 'ses-more' },
                el('summary', {}, `${older.length} older session${older.length === 1 ? '' : 's'}`),
                older)
            : null)
      : el('div', { class: 'empty' }, 'Nothing run yet. The log starts with your first session.'),
  );
}

/* ---------- cards ---------- */

export function progressCards() {
  const sessions = focusSessions();
  if (!sessions.length) return [emptyHero()];
  return [
    todayCard(),
    allTimeStrip(allTime()),
    weekCard(),
    heatCard(),
    recentCard(),
  ];
}
