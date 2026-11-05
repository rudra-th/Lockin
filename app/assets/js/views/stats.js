/* Lockin — Progress: today, all time, the week, tasks, heat, honesty.
   Rendered inside Settings' Progress section, so these are cards to append,
   not a screen with its own heading. */

import { Store } from '../store.js';
import { Router } from '../router.js';
import { el, todayKey, addDays, prettyDate, fmtMin, parseKey } from '../util.js';
import { svg } from '../icons.js';

const DAY_LETTERS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const sum = (list) => list.reduce((a, b) => a + b, 0);

function ring(pct, size = 104) {
  const r = (size - 10) / 2;
  const c = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(1, pct));
  return el('svg', {
    width: size, height: size, viewBox: `0 0 ${size} ${size}`,
    role: 'img', 'aria-label': `${Math.round(p * 100)}% of the daily focus goal`,
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
  const days = new Set([
    ...sessions.map((s) => s.day),
    ...Store.state.slips.map((s) => s.day),
  ]);
  let cleanDays = 0;
  days.forEach((d) => { if (Store.dayClean(d)) cleanDays += 1; });
  const tasks = Store.state.tasks;
  return {
    totalMins,
    cleanDays,
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
      'Run one session in Study Mode. Minutes, clean days and the honesty log fill themselves — no demo data, no defaults.'),
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
  const goal = Store.state.settings.goalMin;
  const pct = goal ? mins / goal : 0;
  const left = Math.max(0, goal - mins);
  const over = Math.max(0, mins - goal);
  const streak = Store.streakUpTo(t);
  const counts = Store.slipCountsOn(t);
  const clean = Store.dayClean(t);
  const slips = counts.slip + counts.abandon;

  const note = !mins
    ? 'The clock hasn’t started. The ring fills when a session does.'
    : over > 0
      ? `Target cleared — ${fmtMin(over)} over.`
      : `${fmtMin(left)} left to hit the target.`;

  const status = clean
    ? el('span', { class: 'pill acc' }, 'Clean day')
    : slips
      ? el('span', { class: 'pill warn' }, `${slips} slip${slips === 1 ? '' : 's'} today`)
      : el('span', { class: 'pill' }, 'Not clean yet');

  return el('div', { class: 'card' },
    el('div', { class: 'row', style: 'gap:18px' },
      el('div', { class: 'ringbox', style: 'width:104px;height:104px' },
        ring(pct),
        el('div', { class: 'center', style: 'font-size:15px' },
          `${Math.round(Math.min(1, pct) * 100)}%`,
          el('small', {}, 'of goal')),
      ),
      el('div', { class: 'grow' },
        el('h2', { style: 'margin-bottom:7px' }, 'Today'),
        el('div', { class: 'stat-lead' }, `${fmtMin(mins)} of ${fmtMin(goal)}`),
        el('div', { class: 'stat-sub' }, note),
        el('div', { class: 'pillrow' },
          el('span', { class: 'pill' }, streak ? `${streak}-day streak` : 'No streak yet'),
          status,
        ),
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
    tweakTile('Clean days', String(all.cleanDays), 'focus and zero slips'),
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
  const goal = Store.state.settings.goalMin;
  const days = [];
  for (let i = 6; i >= 0; i -= 1) days.push(addDays(t, -i));
  const vals = days.map((d) => Store.focusMinutesOn(d));
  const max = Math.max(60, goal, ...vals) * 1.08;

  const bars = el('div', { class: 'bars' },
    days.map((d, i) => {
      const isToday = d === t;
      const mins = vals[i];
      const clean = Store.dayClean(d);
      const fill = !mins ? 'dim' : clean ? '' : 'broke';
      return el('div', { class: `barcol${isToday ? ' today' : ''}` },
        el('div', { class: 'barwrap' },
          el('div', {
            class: `bar ${fill}`, style: `height:${mins ? Math.max(4, (mins / max) * 100) : 2}%`,
            title: `${prettyDate(d)} · ${fmtMin(mins)}${clean ? ' · clean' : mins ? ' · not clean' : ''}`,
          }),
          el('div', {
            class: `goalmark${mins >= goal && goal ? ' hit' : ''}`,
            style: `bottom:${Math.min(100, (goal / max) * 100)}%`,
            title: `Daily goal · ${fmtMin(goal)}`,
          }),
        ),
        el('span', { class: 'lbl' }, isToday ? 'Today' : DAY_LETTERS[parseKey(d).getDay()]),
      );
    }),
  );

  const total = sum(vals);
  const goalsHit = vals.filter((v) => v >= goal).length;

  return el('div', { class: 'card' },
    el('h2', {}, 'Last 7 days'),
    bars,
    el('div', { class: 'weekstats' },
      el('div', {}, el('b', {}, fmtMin(total)), el('span', {}, 'focused')),
      el('div', {}, el('b', {}, `${goalsHit}/7`), el('span', {}, 'goal days')),
      el('div', {}, el('b', {}, fmtMin(total / 7)), el('span', {}, 'daily average')),
    ),
    el('div', { class: 'chartlegend' },
      el('span', {}, el('i', { class: 'sw acc' }), 'clean'),
      el('span', {}, el('i', { class: 'sw broke' }), 'focused, not clean'),
      el('span', {}, el('i', { class: 'sw goal' }), 'goal'),
    ),
  );
}

/* ---------- tasks ---------- */

function taskCard() {
  const t = todayKey();
  const days = [];
  for (let i = 6; i >= 0; i -= 1) days.push(addDays(t, -i));
  const all = days.flatMap((d) => Store.tasksOn(d));
  const done = all.filter((x) => x.doneAt).length;
  const today = Store.tasksOn(t);
  const todayDone = today.filter((x) => x.doneAt).length;
  const pct = all.length ? done / all.length : 0;

  const body = all.length
    ? el('div', { class: 'taskstat' },
        el('div', { class: 'ts-num' }, `${Math.round(pct * 100)}%`),
        el('div', { class: 'grow' },
          el('div', { class: 'ts-line' },
            el('b', {}, `${done} of ${all.length} done`),
            el('span', {}, today.length ? `today ${todayDone}/${today.length}` : 'nothing today')),
          el('div', { class: 'tsbar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.round(pct * 100)) },
            el('i', { style: `width:${Math.round(pct * 100)}%` })),
        ),
      )
    : el('div', { class: 'empty' }, 'No tasks in the last 7 days. Add them on Schedule — today or tomorrow.');

  return el('div', { class: 'card' },
    el('h2', {}, 'Tasks · last 7 days'),
    body,
    all.length
      ? el('p', { class: 'tiny', style: 'margin-top:11px' },
          'Every task counts once, whether it was finished on time or late.')
      : el('button', {
          class: 'btn btn-subtle btn-block', style: 'margin-top:10px',
          onclick: () => Router.go('/schedule'),
        }, svg('calendar', 16), 'Open Schedule'),
  );
}

/* ---------- heatmap: 13 weekday-aligned weeks ---------- */

function heatCard() {
  const t = todayKey();
  const WEEKS = 13;
  const cell = 12;
  const gap = 3;
  const labelW = 19;
  const top = 13;
  const W = labelW + WEEKS * (cell + gap) - gap;
  const H = top + 7 * (cell + gap) - gap;

  const svgEl = el('svg', {
    viewBox: `0 0 ${W} ${H}`, role: 'img',
    'aria-label': 'Clean-day heatmap for the last 13 weeks',
  });

  /* weekday labels — odd rows only, so the grid stays quiet */
  [1, 3, 5].forEach((di) => {
    svgEl.append(el('text', {
      x: 0, y: top + di * (cell + gap) + cell - 2,
      fill: 'var(--tx-3)', 'font-size': '8', 'font-family': 'var(--font-mono)',
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
        x: labelW + wi * (cell + gap), y: 8,
        fill: 'var(--tx-3)', 'font-size': '8', 'font-family': 'var(--font-mono)',
      }, parseKey(weekStart).toLocaleDateString(undefined, { month: 'short' })));
      lastMonth = month;
    }
    for (let di = 0; di < 7; di += 1) {
      const dayKey = addDays(weekStart, di);
      if (dayKey > t) continue; // the future is not a data point
      const mins = Store.focusMinutesOn(dayKey);
      const clean = Store.dayClean(dayKey);
      let fill = 'var(--panel-2)';
      if (clean) fill = 'var(--acc)';
      else if (mins > 0) fill = 'color-mix(in srgb, var(--warn) 55%, var(--panel-2))';
      svgEl.append(el('rect', {
        x: labelW + wi * (cell + gap), y: top + di * (cell + gap),
        width: cell, height: cell, rx: 3.5, fill,
        stroke: dayKey === t ? 'var(--tx)' : 'none',
        'stroke-opacity': 0.55,
        'data-day': dayKey,
        'data-mins': String(mins),
        'data-clean': String(clean),
      }, el('title', {}, `${prettyDate(dayKey)} · ${fmtMin(mins)}${clean ? ' · clean' : ''}`)));
    }
  }

  return el('div', { class: 'card hm' },
    el('h2', {}, 'Clean days · 13 weeks'),
    svgEl,
    el('div', { class: 'chartlegend' },
      el('span', {}, el('i', { class: 'sw acc' }), 'clean'),
      el('span', {}, el('i', { class: 'sw broke' }), 'focused, broken'),
      el('span', {}, el('i', { class: 'sw quiet' }), 'quiet'),
    ),
  );
}

/* ---------- recent sessions ---------- */

function recentCard() {
  const rows = focusSessions()
    .slice()
    .sort((a, b) => b.start - a.start)
    .slice(0, 8);

  return el('div', { class: 'card' },
    el('h2', {}, 'Recent sessions'),
    rows.length
      ? rows.map((s) => {
          const time = new Date(s.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          return el('div', { class: 'sesrow' },
            el('div', { class: 'grow' },
              el('div', { class: 'ses-name' }, 'Focus',
                s.earned ? el('span', { class: 'ses-tag' }, 'ended on your terms')
                  : s.aborted ? el('span', { class: 'ses-tag' }, 'ended early') : null),
              el('div', { class: 'ses-when' }, `${prettyDate(s.day)} · ${time}`),
            ),
            el('span', { class: 'ses-mins' }, fmtMin(Store.sessionMins(s))),
          );
        })
      : el('div', { class: 'empty' }, 'Nothing run yet. The log starts with your first session.'),
  );
}

/* ---------- honesty log ---------- */

function honestyCard() {
  const rows = Store.state.slips.slice(-12).reverse();
  return el('div', { class: 'card' },
    el('h2', {}, 'Honesty log'),
    rows.length
      ? rows.map((sl) => {
          let what;
          if (sl.kind === 'abandon') what = 'Session quit';
          else if (sl.awaySec > 0) {
            const away = sl.awaySec >= 60 ? fmtMin(sl.awaySec / 60) : `${sl.awaySec}s`;
            what = `Away ${away}`;
          } else what = 'Session';
          return el('div', { class: `logrow kind-${sl.kind}` },
            el('span', { class: `kind kind-${sl.kind}` },
              { slip: 'SLIP', abandon: 'QUIT', rescue: 'FORGIVEN' }[sl.kind] || sl.kind),
            el('span', { class: 'grow logwhat' }, what),
            el('span', { class: 'when' }, prettyDate(sl.day)),
          );
        })
      : el('div', { class: 'empty' }, 'Nothing broken on record. Keep it that way — quietly.'),
  );
}

/* ---------- cards ---------- */

export function progressCards() {
  const sessions = focusSessions();
  if (!sessions.length) return [emptyHero(), taskCard()];
  return [
    todayCard(),
    allTimeStrip(allTime()),
    weekCard(),
    taskCard(),
    heatCard(),
    recentCard(),
    honestyCard(),
  ];
}
