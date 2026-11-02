/* Lockin — Stats: goal, streak, week, subject split, heatmap, honesty log. */

import { Store } from '../store.js';
import { el, todayKey, addDays, prettyDate, fmtMin, parseKey } from '../util.js';

export function initStats(Router) {
  Router.register('/stats', { mount, unmount: null });
}

function ring(pct, size = 96) {
  const r = (size - 10) / 2;
  const c = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(1, pct));
  return el('svg', {
    width: size, height: size, viewBox: `0 0 ${size} ${size}`,
    style: 'transform:rotate(-90deg)',
  },
    el('circle', { cx: size / 2, cy: size / 2, r, fill: 'none', stroke: 'var(--line-2)', 'stroke-width': 8 }),
    el('circle', {
      cx: size / 2, cy: size / 2, r, fill: 'none', stroke: 'var(--acc)',
      'stroke-width': 8, 'stroke-linecap': 'round',
      'stroke-dasharray': String(c), 'stroke-dashoffset': String(c * (1 - p)),
    })
  );
}

function todayCard() {
  const t = todayKey();
  const mins = Store.focusMinutesOn(t);
  const goal = Store.state.settings.goalMin;
  const streak = Store.streakUpTo(t);
  const slips = Store.slipCountsOn(t);
  const clean = Store.dayClean(t);

  return el('div', { class: 'card' },
    el('h2', {}, 'Today'),
    el('div', { class: 'row', style: 'gap:16px' },
      el('div', { class: 'ringbox', style: 'width:96px;height:96px' },
        ring(goal ? mins / goal : 0),
        el('div', { class: 'center', style: 'font-size:14px' }, fmtMin(mins)),
      ),
      el('div', { class: 'grow' },
        el('div', { class: 'stat-lead' },
          `${fmtMin(mins)} of ${fmtMin(goal)} goal`),
        el('div', { class: 'muted', style: 'margin-top:2px' },
          clean ? 'Today is clean.' : 'Today is not clean yet.'),
        el('div', { class: 'row', style: 'gap:7px;margin-top:9px;flex-wrap:wrap' },
          el('span', { class: 'pill acc' }, `${streak} clean day${streak === 1 ? '' : 's'} in a row`),
        ),
      ),
    ),
  );
}

function weekCard() {
  const t = todayKey();
  const days = [];
  for (let i = 6; i >= 0; i--) days.push(addDays(t, -i));
  const vals = days.map((d) => Store.focusMinutesOn(d));
  const max = Math.max(60, ...vals);

  const bars = el('div', { class: 'bars' });
  days.forEach((d, i) => {
    const isToday = d === t;
    const col = el('div', { class: `barcol ${isToday ? 'today' : ''}` });
    const h = 8 + Math.round((vals[i] / max) * 88);
    col.append(el('div', { class: `bar ${vals[i] ? '' : 'dim'}`, style: `height:${vals[i] ? h : 6}px`, title: `${prettyDate(d)} · ${fmtMin(vals[i])}` }));
    col.append(el('span', { class: 'lbl' }, ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'][parseKey(d).getDay()]));
    bars.append(col);
  });

  const total = vals.reduce((a, b) => a + b, 0);
  return el('div', { class: 'card' },
    el('h2', {}, 'Last 7 days'),
    bars,
    el('div', { class: 'tiny', style: 'margin-top:10px;text-align:center' }, `${fmtMin(total)} focused this week`),
  );
}

function splitCard() {
  const map = Store.subjectMinutes(todayKey(), 7);
  const entries = [...map.entries()]
    .map(([id, mins]) => ({ act: Store.activity(id), name: Store.activity(id)?.name || 'Uncategorized', mins, hue: Store.activity(id)?.hue ?? 0 }))
    .filter((x) => x.mins > 0)
    .sort((a, b) => b.mins - a.mins);

  if (!entries.length) {
    return el('div', { class: 'card' }, el('h2', {}, 'Subjects'), el('div', { class: 'empty' }, 'No sessions yet. The chart draws itself once Study Mode runs.'));
  }
  const totalMins = entries.reduce((a, b) => a + b.mins, 0);
  const bar = el('div', { class: 'splitbar' });
  entries.forEach((x, i) => {
    const w = (x.mins / totalMins) * 100;
    const seg = el('div', { style: `width:${w}%;flex:0 0 auto;background:hsl(${x.hue} 55% 55%)`, title: x.name });
    if (i === 0) seg.style.borderRadius = '8px 0 0 8px';
    if (i === entries.length - 1) seg.style.borderRadius = seg.style.borderRadius === '' ? '0 8px 8px 0' : seg.style.borderRadius;
    bar.append(seg);
  });
  const rows = entries.map((x) => el('div', { class: 'splitrow' },
    el('span', { class: 'dot', style: `background:hsl(${x.hue} 55% 55%)` }),
    x.name,
    el('b', {}, fmtMin(x.mins)),
  ));
  return el('div', { class: 'card' },
    el('h2', {}, 'Where the time went · 7d'),
    bar, el('div', { style: 'margin-top:10px' }, rows));
}

function heatCard() {
  const t = todayKey();
  const WEEKS = 13;
  const cells = [];
  const weeks = [];
  for (let w = WEEKS - 1; w >= 0; w--) {
    const col = [];
    for (let d = 0; d < 7; d++) {
      const dayKey = addDays(t, -(w * 7 + (6 - d)));
      const mins = Store.focusMinutesOn(dayKey);
      const clean = Store.dayClean(dayKey);
      col.push({ dayKey, mins, clean });
    }
    weeks.push(col);
  }
  // draw column-aligned SVG: 13 cols × 7 rows, 12px cells, 3px gap
  const cell = 12, gap = 3;
  const W = WEEKS * (cell + gap) - gap;
  const H = 7 * (cell + gap) - gap;
  const svgEl = el('svg', { width: '100%', viewBox: `0 0 ${W} ${H}`, style: 'display:block', role: 'img', 'aria-label': 'Clean-day heatmap' });
  weeks.forEach((col, wi) => {
    col.forEach((c, di) => {
      let fill = 'var(--panel-2)';
      if (c.clean) fill = 'var(--acc)';
      else if (c.mins > 0) fill = 'color-mix(in srgb, var(--warn) 55%, var(--panel-2))';
      svgEl.append(el('rect', {
        x: wi * (cell + gap), y: di * (cell + gap),
        width: cell, height: cell, rx: 3.5,
        fill,
        'data-day': c.dayKey,
        'data-mins': String(c.mins),
        'data-clean': String(c.clean),
      }));
    });
  });
  return el('div', { class: 'card hm' },
    el('h2', {}, 'Clean days heat'),
    svgEl,
    el('div', { class: 'tiny', style: 'margin-top:8px' },
      el('span', {}, 'Lime = a genuinely clean day (focus + zero slips). Orange = focused but broken. Blank = quiet.'),
    ),
  );
}

function listCard(title, emptyText) {
  const rows = Store.state.slips.slice(-18).reverse();
  return el('div', { class: 'card' },
    el('h2', {}, title),
    rows.length
      ? rows.map((sl) => el('div', { class: `logrow kind-${sl.kind}` },
          el('span', { class: `kind kind-${sl.kind}` }, { slip: 'SLIP', abandon: 'QUIT', rescue: 'FORGIVEN' }[sl.kind] || sl.kind),
          (() => {
            const sess = Store.state.sessions.find((s) => s.id === sl.sessId);
            const name = sess && Store.activity(sess.subjectId)?.name;
            return el('span', { class: 'muted', style: 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap' },
              name ? `${name} — away ${fmtMin(sl.awaySec / 60)}` : `away ${fmtMin(sl.awaySec / 60)}`);
          })(),
          el('span', { class: 'when' }, prettyDate(sl.day)),
        ))
      : el('div', { class: 'empty' }, emptyText),
  );
}

function sessionsCard() {
  const t = todayKey();
  const rows = Store.state.sessions
    .filter((s) => s.day === t && !s.demo)
    .slice(-10).reverse();
  return el('div', { class: 'card' },
    el('h2', {}, 'Session log · today'),
    rows.length
      ? rows.map((s) => el('div', { class: 'logrow' },
          el('span', { class: 'muted', style: 'flex:1' }, Store.activity(s.subjectId)?.name || 'Study',
            s.aborted ? el('span', { class: 'tiny' }, ' · aborted') : ''),
          el('span', { class: 'when' },
            `${new Date(s.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}–${new Date(s.completed ? s.end : s.end).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
            ` · ${fmtMin((s.end - s.start) / 60000)}`),
        ))
      : el('div', { class: 'empty' }, 'Nothing run yet today.'),
  );
}

function render(host) {
  host.append(el('section', { class: 'view-anim stagger' },
    el('div', { class: 'app-head' },
      el('div', { class: 'grow' },
        el('h1', {}, 'Stats'),
        el('div', { class: 'sub' }, 'Everything local, everything honest.'),
      ),
    ),
    todayCard(),
    weekCard(),
    splitCard(),
    heatCard(),
    sessionsCard(),
    listCard('Honesty log', 'Nothing broken on record. Keep it that way — quietly.'),
  ));
}

function mount(host) {
  render(host);
}
