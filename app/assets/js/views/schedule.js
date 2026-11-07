/* Lockin — Schedule: recurring blocks, alarms, and the day's tasks.
   The old Plan screen grew a timetable; this is that timetable made real.
   A block is a local-time range plus days of the week. The alarm engine
   lives in alarms.js and reads the same store. */

import { Store } from '../store.js';
import { Router } from '../router.js';
import {
  el, todayKey, addDays, prettyDate, parseKey, fmtMin, dateKey,
  spanMin, spanLabel, daysLabel, occurrencesOn, nextOccurrence, parseHM,
  DAYS, WEEKDAYS,
} from '../util.js';
import { svg } from '../icons.js';
import { taskList } from '../tasks.js';
import { openSheet, hint } from '../ui.js';
import { toggle, stepper, setrow } from '../controls.js';

export function initSchedule(router) {
  router.register('/schedule', { mount, unmount });
  /* old bookmarks and the old tab still land somewhere sensible */
  router.register('/plan', { mount: () => Router.go('/schedule'), unmount: null });
}

/* ---------- small time helpers ---------- */

const pad = (n) => String(n).padStart(2, '0');
const hhmm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/* A dismissed occurrence stays on the calendar but stops being "next". */
function nextBlock(schedules, now) {
  return nextOccurrence(schedules, now,
    (occ) => Store.isBlockSkipped(occ.schedule.id, dateKey(occ.start)));
}

function untilText(next, now) {
  const ms = next.ongoing ? next.end - now : next.start - now;
  const mins = Math.max(0, Math.ceil(ms / 60000));
  if (mins <= 1) return next.ongoing ? 'ends now' : 'starts now';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const body = h ? (m ? `${h}h ${pad(m)}m` : `${h}h`) : `${m} min`;
  return next.ongoing ? `ends in ${body}` : `in ${body}`;
}

function shortUntil(ms) {
  const mins = Math.max(1, Math.ceil(ms / 60000));
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h}h ${pad(m)}m` : `${h}h`;
}

/* ---------- the day ring ---------- */

const RING = { size: 220, cx: 110, cy: 110, r: 84 };

function polar(frac, r = RING.r) {
  const a = frac * Math.PI * 2 - Math.PI / 2;
  return [RING.cx + r * Math.cos(a), RING.cy + r * Math.sin(a)];
}

function arcPath(f0, f1) {
  const span = Math.max(0.0001, Math.min(0.9999, f1 - f0));
  const [x0, y0] = polar(f0);
  const [x1, y1] = polar(f0 + span);
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${RING.r} ${RING.r} 0 ${span > 0.5 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

function fracOf(date) {
  const mins = date.getHours() * 60 + date.getMinutes() + date.getSeconds() / 60;
  return mins / 1440;
}

function dayRing(occs, now, next) {
  const graph = el('svg', {
    class: 'dayring', viewBox: `0 0 ${RING.size} ${RING.size}`,
    'aria-hidden': 'true', focusable: 'false',
  });

  graph.append(el('circle', { cx: RING.cx, cy: RING.cy, r: RING.r, class: 'dr-track' }));

  for (let i = 0; i < 24; i += 1) {
    const major = i % 6 === 0;
    const [x1, y1] = polar(i / 24, RING.r + 9);
    const [x2, y2] = polar(i / 24, RING.r + (major ? 18 : 14));
    graph.append(el('line', { x1, y1, x2, y2, class: `dr-tick${major ? ' major' : ''}` }));
  }

  for (const occ of occs) {
    const startFrac = fracOf(occ.start);
    const endFrac = fracOf(occ.end);
    const state = now >= occ.end ? 'past' : now >= occ.start ? 'now' : 'next';
    const cls = `dr-block is-${state}`;
    if (!sameDay(occ.start, occ.end)) {
      graph.append(el('path', { d: arcPath(startFrac, 1), class: cls }));
      graph.append(el('path', { d: arcPath(0, endFrac), class: cls }));
    } else {
      graph.append(el('path', { d: arcPath(startFrac, endFrac), class: cls }));
    }
  }

  const deg = fracOf(now) * 360;
  graph.append(el('g', { 'data-now-hand': '', transform: `rotate(${deg} ${RING.cx} ${RING.cy})` },
    el('line', { x1: RING.cx, y1: RING.cy, x2: RING.cx, y2: RING.cy - (RING.r - 11), class: 'dr-hand' }),
    el('circle', { cx: RING.cx, cy: RING.cy - (RING.r - 11), r: 2.5, class: 'dr-hand-dot' })));

  const center = el('div', { class: 'dr-center' },
    el('span', { class: 'dr-kicker' }, next ? (next.ongoing ? 'Now' : 'Next') : 'Today'),
    el('b', {}, hhmm(next ? next.start : now)),
    el('span', { class: 'dr-sub' }, next
      ? (next.ongoing ? `until ${hhmm(next.end)}` : daysLabel(next.schedule.days))
      : 'open day'));

  const label = occs.length
    ? `${occs.length} block${occs.length === 1 ? '' : 's'} today. ${next ? `Next: ${next.schedule.name} at ${hhmm(next.start)}.` : ''}`
    : 'No blocks today.';

  return el('div', { class: 'dayring-wrap', role: 'img', 'aria-label': label }, graph, center);
}

/* ---------- hero ---------- */

function heroCard(now) {
  const schedules = Store.schedules();
  const occs = occurrencesOn(schedules, now);
  const next = nextBlock(schedules, now);
  const text = el('div', { class: 'sched-hero-txt' });

  if (!next) {
    text.append(
      el('p', { class: 'sched-kicker' }, schedules.length ? 'Nothing ahead' : 'Your day'),
      el('h2', { class: 'sched-next-name' }, schedules.length ? 'Every block is off.' : 'Give the day a shape.'),
      el('p', { class: 'sched-next-meta' }, schedules.length
        ? 'Turn one back on, or add a new block.'
        : 'Recurring blocks, an alarm at the start, and a five-minute warning.'),
      el('button', { class: 'btn btn-primary btn-sm sched-hero-cta', onclick: () => openEditor() },
        svg('plus', 15), 'Add a block'),
    );
  } else {
    text.append(
      el('p', { class: 'sched-kicker' }, next.ongoing ? 'Happening now' : 'Next block'),
      el('h2', { class: 'sched-next-name' }, next.schedule.name),
      el('p', { class: 'sched-next-meta' }, daysLabel(next.schedule.days)),
      el('div', { class: 'sched-count' },
        el('b', { 'data-next-in': '' }, untilText(next, now)),
        el('span', { 'data-next-sub': '' }, next.ongoing ? `ends ${hhmm(next.end)}` : `at ${hhmm(next.start)}`)),
      el('button', { class: 'btn btn-subtle btn-sm sched-hero-cta', onclick: () => openEditor(next.schedule) },
        svg('pencil', 14), 'Edit block'),
    );
  }

  const enabled = schedules.filter((s) => s.enabled).length;
  const master = schedules.length
    ? el('div', { class: 'sched-master' },
      el('span', { class: 'sched-master-label' }, enabled
        ? `Schedule on · ${enabled}/${schedules.length}`
        : 'Schedule paused'),
      toggle(() => enabled > 0, () => setAllSchedules(!(enabled > 0)), 'Pause or resume every block'))
    : null;

  return el('div', { class: 'card sched-hero-card' },
    el('div', { class: 'sched-hero' }, text, dayRing(occs, now, next)),
    master);
}

/** Pause or resume every recurring block at once. */
function setAllSchedules(on) {
  Store.set((st) => {
    st.schedules.forEach((s) => { s.enabled = on; });
  });
}

/* ---------- today ---------- */

function todaySection(now) {
  const occs = occurrencesOn(Store.schedules(), now);
  const total = occs.reduce((n, o) => n + spanMin(o.schedule), 0);

  const head = el('div', { class: 'sched-sec-head' },
    el('h2', {}, 'Today'),
    el('span', { class: 'sched-sec-meta' },
      occs.length ? `${occs.length} block${occs.length === 1 ? '' : 's'} · ${fmtMin(total)}` : 'No blocks'));

  let body;
  if (!occs.length) {
    body = el('div', { class: 'sched-empty' },
      el('div', { class: 'sched-empty-glyph', innerHTML: svg('calendar', 25) }),
      el('div', { class: 'sched-empty-txt' },
        el('b', {}, 'Nothing scheduled today.'),
        el('span', {}, 'Add a repeating block and it appears here.')));
  } else {
    body = el('div', { class: 'sched-daylist' }, occs.map((occ) => {
      const skipped = Store.isBlockSkipped(occ.schedule.id, dateKey(occ.start));
      const state = skipped ? 'skipped' : now >= occ.end ? 'past' : now >= occ.start ? 'now' : 'next';
      const stateText = skipped ? 'Skipped' : state === 'now' ? 'Now' : state === 'past' ? 'Done' : shortUntil(occ.start - now);
      return el('button', {
        class: `sched-slot is-${state}`,
        onclick: () => openEditor(occ.schedule),
        'aria-label': `Edit ${occ.schedule.name}, ${spanLabel(occ.schedule)}${skipped ? ', skipped today' : ''}`,
      },
        el('span', { class: 'slot-time' }, occ.schedule.start),
        el('span', { class: 'slot-rail' }, el('i', {})),
        el('span', { class: 'slot-body' },
          el('b', {}, occ.schedule.name),
          el('span', {}, `${occ.schedule.end} · ${fmtMin(spanMin(occ.schedule))}`)),
        el('span', { class: 'slot-state' }, stateText));
    }));
  }

  return el('section', { class: 'sched-sec' }, head, body);
}

/* ---------- repeating blocks ---------- */

function scheduleRow(sch) {
  const sw = toggle(() => sch.enabled, () => Store.toggleSchedule(sch.id));
  sw.setAttribute('aria-label', `${sch.enabled ? 'Disable' : 'Enable'} ${sch.name}`);
  sw.setAttribute('title', `${sch.enabled ? 'Disable' : 'Enable'} ${sch.name}`);

  return el('div', { class: `sched-row${sch.enabled ? '' : ' is-off'}` },
    el('button', {
      class: 'sched-row-main',
      onclick: () => openEditor(sch),
      'aria-label': `Edit ${sch.name}`,
    },
      el('span', { class: 'sched-row-mark' }),
      el('span', { class: 'sched-row-txt' },
        el('b', {}, sch.name),
        el('span', {}, `${spanLabel(sch)} · ${daysLabel(sch.days)}`))),
    el('div', { class: 'sched-row-side' }, sw));
}

function repeatingSection() {
  const schedules = Store.schedules();
  const head = el('div', { class: 'sched-sec-head' },
    el('h2', {}, 'Repeating'),
    el('button', { class: 'btn btn-subtle btn-sm', onclick: () => openEditor() }, svg('plus', 14), 'Block'));

  const body = schedules.length
    ? el('div', { class: 'sched-rows' }, schedules.map(scheduleRow))
    : el('div', { class: 'sched-empty' },
      el('div', { class: 'sched-empty-glyph', innerHTML: svg('repeat', 25) }),
      el('div', { class: 'sched-empty-txt' },
        el('b', {}, 'No repeating blocks yet.'),
        el('span', {}, 'Study, sleep, meals — give the day a shape.')),
      el('button', { class: 'btn btn-subtle btn-sm', onclick: () => openEditor() }, svg('plus', 14), 'Add the first'));

  return el('section', { class: 'sched-sec' }, head, body);
}

/* ---------- tasks ---------- */

function taskDayCard(day) {
  const tasks = Store.tasksOn(day);
  const done = tasks.filter((t) => t.doneAt).length;
  const long = parseKey(day).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

  return el('div', { class: 'card' },
    el('div', { class: 'taskdayhead' },
      el('div', {},
        el('h2', {}, prettyDate(day)),
        el('div', { class: 'taskday-date' }, long)),
      el('span', { class: `pill${tasks.length && done === tasks.length ? ' acc' : ''}` },
        tasks.length ? `${done}/${tasks.length} done` : 'nothing yet')),
    taskList(day, tasks, {
      emptyText: day === todayKey()
        ? 'No tasks yet. Add the first thing you want to finish.'
        : 'Tomorrow is open. Add what you want waiting for you.',
      placeholder: day === todayKey() ? 'Add a task for today…' : 'Add a task for tomorrow…',
      onChange: rerender,
    }));
}

function tasksSection() {
  const t = todayKey();
  return el('section', { class: 'sched-sec' },
    el('div', { class: 'sched-sec-head' },
      el('h2', {}, 'Tasks'),
      el('span', { class: 'sched-sec-meta' }, 'Today & tomorrow')),
    taskDayCard(t),
    taskDayCard(addDays(t, 1)));
}

/* ---------- the editor ---------- */

function openEditor(schedule = null) {
  const editing = Boolean(schedule);
  const draft = schedule
    ? { ...schedule, days: [...schedule.days] }
    : {
        name: '', start: '09:00', end: '10:30', days: [...WEEKDAYS],
        enabled: true, alarm: true, remind: Store.state.settings.remindDefault ?? 5,
      };

  openSheet(editing ? 'Edit block' : 'New block', (close) => {
    const nameInp = el('input', {
      class: 'inp', maxlength: 40, value: draft.name,
      placeholder: 'Morning deep work', autocomplete: 'off', spellcheck: 'false',
      'aria-label': 'Block name',
    });
    const startInp = el('input', {
      class: 'inp', type: 'time', value: draft.start, step: '300', 'aria-label': 'Start time',
    });
    const endInp = el('input', {
      class: 'inp', type: 'time', value: draft.end, step: '300', 'aria-label': 'End time',
    });

    const dayBtns = DAYS.map((label, i) => {
      const b = el('button', {
        type: 'button', class: 'daypick-btn', 'aria-pressed': String(draft.days.includes(i)),
        'aria-label': label,
        onclick: () => {
          const on = draft.days.includes(i);
          draft.days = on ? draft.days.filter((d) => d !== i) : [...draft.days, i].sort();
          b.setAttribute('aria-pressed', String(!on));
          updatePreview();
        },
      }, label);
      return b;
    });

    const preview = el('div', { class: 'sched-preview' });
    const save = el('button', { class: 'btn btn-primary', type: 'button' }, editing ? 'Save changes' : 'Add block');

    function updatePreview() {
      const start = parseHM(startInp.value);
      const end = parseHM(endInp.value);
      const span = spanMin({ start: startInp.value, end: endInp.value });
      const overnight = start != null && end != null && span > 0 && end < start;
      const valid = span > 0 && draft.days.length > 0;

      preview.replaceChildren(...[
        el('span', {}, span ? `${startInp.value} – ${endInp.value}` : 'Pick a start and end'),
        el('span', {}, span ? fmtMin(span) : '—'),
        el('span', {}, daysLabel(draft.days)),
        overnight ? el('span', { class: 'sched-overnight' }, 'crosses midnight') : null,
      ].filter(Boolean));
      preview.classList.toggle('is-bad', !valid);
      save.disabled = !valid;
    }

    save.addEventListener('click', () => {
      draft.name = nameInp.value;
      draft.start = startInp.value;
      draft.end = endInp.value;
      const id = Store.saveSchedule(draft);
      if (!id) { hint('That block needs a start, an end and at least one day.'); return; }
      close();
      hint(editing ? 'Block updated.' : 'Block added.');
    });

    startInp.addEventListener('input', updatePreview);
    endInp.addEventListener('input', updatePreview);
    nameInp.addEventListener('input', () => { draft.name = nameInp.value; });

    const alarmRow = setrow('Alarm at start',
      'A full-screen alarm and a notification when the block begins.',
      toggle(() => draft.alarm, () => { draft.alarm = !draft.alarm; }));

    const remindRow = setrow('Reminder',
      'A quieter warning before the block. Off means no early notice.',
      stepper(() => draft.remind, (v) => { draft.remind = v; },
        { lo: 0, hi: 30, step: 5, fmt: (v) => (v === 0 ? 'Off' : `${v} min`) }));

    const parts = [
      el('p', { class: 'sheet-lede' },
        'A local-time block that repeats on the days you choose. It does not run a session — it rings, then you decide.'),
      el('label', { class: 'field' }, el('span', {}, 'Name'), nameInp),
      el('div', { class: 'timepair' },
        el('label', { class: 'field' }, el('span', {}, 'Starts'), startInp),
        el('label', { class: 'field' }, el('span', {}, 'Ends'), endInp)),
      el('div', { class: 'field' }, el('span', {}, 'Days'), el('div', { class: 'daypick' }, dayBtns)),
      preview,
      el('div', { class: 'sheet-rows' }, alarmRow, remindRow),
      el('div', { class: 'actions' },
        el('button', { class: 'btn btn-subtle', type: 'button', onclick: () => close() }, 'Cancel'),
        save),
    ];

    if (editing) {
      const delLabel = el('span', {}, 'Delete block');
      const del = el('button', {
        class: 'btn btn-danger btn-block sched-delete', type: 'button',
        onclick: () => {
          if (del.dataset.armed !== '1') {
            del.dataset.armed = '1';
            delLabel.textContent = 'Click again to delete';
            setTimeout(() => {
              if (!del.isConnected) return;
              del.dataset.armed = '';
              delLabel.textContent = 'Delete block';
            }, 4000);
            return;
          }
          Store.deleteSchedule(schedule.id);
          close();
          hint('Block deleted.');
        },
      }, svg('trash', 15), delLabel);
      parts.push(del);
    }

    updatePreview();
    return parts;
  });
}

/* ---------- render / live updates ---------- */

let hostEl = null;
let ticker = 0;
let liveKey = null;

function nextKey(now) {
  const next = nextBlock(Store.schedules(), now);
  return next ? `${next.schedule.id}:${next.start.getTime()}:${next.ongoing ? 1 : 0}` : 'none';
}

function render(host) {
  const now = new Date();
  host.append(el('section', { class: 'view-anim stagger' },
    el('div', { class: 'app-head' },
      el('div', { class: 'grow' },
        el('h1', {}, 'Schedule'),
        el('div', { class: 'sub' }, 'Recurring blocks, alarms, and the day’s tasks.')),
      el('button', {
        class: 'iconbtn', 'aria-label': 'Add a block', title: 'Add a block',
        innerHTML: svg('plus', 18), onclick: () => openEditor(),
      })),
    heroCard(now),
    todaySection(now),
    tasksSection(),
    repeatingSection(),
  ));
  liveKey = nextKey(now);
}

function rerender() {
  if (!hostEl || Router.parse().path !== '/schedule') return;
  const scroll = hostEl.scrollTop;
  hostEl.textContent = '';
  render(hostEl);
  hostEl.scrollTop = scroll;
}

function paintLive() {
  if (!hostEl || Router.parse().path !== '/schedule') return;
  const now = new Date();
  const key = nextKey(now);
  if (key !== liveKey) { rerender(); return; }

  const next = nextBlock(Store.schedules(), now);
  const inEl = hostEl.querySelector('[data-next-in]');
  const subEl = hostEl.querySelector('[data-next-sub]');
  if (next && inEl) inEl.textContent = untilText(next, now);
  if (next && subEl) subEl.textContent = next.ongoing ? `ends ${hhmm(next.end)}` : `at ${hhmm(next.start)}`;

  const hand = hostEl.querySelector('[data-now-hand]');
  if (hand) hand.setAttribute('transform', `rotate(${fracOf(now) * 360} ${RING.cx} ${RING.cy})`);
}

function mount(host) {
  hostEl = host;
  liveKey = null;
  render(host);
  clearInterval(ticker);
  ticker = setInterval(paintLive, 30000);
  document.addEventListener('lockin:changed', rerender);
}

function unmount() {
  clearInterval(ticker);
  ticker = 0;
  document.removeEventListener('lockin:changed', rerender);
}
