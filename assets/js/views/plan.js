/* Lockin — the 24-hour planner. Tap a palette chip, tap start, tap end. */

import { Store, uid } from '../store.js';
import { el, slotsToT, dateKey, todayKey, addDays, prettyDate, parseKey, weekdayShort, clamp } from '../util.js';
import { svg } from '../icons.js';
import { openSheet, closeSheet, hint } from '../ui.js';

const SLOT_MIN = 30;

let brush = null;          // activity id | 'erase' | null
let anchor = null;         // first tap's slot index
let day = todayKey();      // the date being edited
let tickTimer = null;

const slotPx = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--slot'));

export function initPlan(Router) {
  Router.register('/plan', { mount, unmount });
}

/* ---------- view ---------- */

function render(host) {
  const blocks = Store.blocks(day);
  const nowDate = todayKey();

  /* header */
  const titleBox = el('div', { class: 'grow' },
    el('h1', {}, prettyDate(day)),
    el('div', { class: 'sub' }, parseKey(day).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }))
  );
  if (day === nowDate) titleBox.append(el('span', { class: 'pill acc' }, 'Today'));

  const head = el('div', { class: 'app-head' },
    el('button', {
      class: 'iconbtn', 'aria-label': 'Previous day', innerHTML: svg('chevL'),
      onclick: () => { day = addDays(day, -1); anchor = null; rerender(); },
    }),
    titleBox,
    el('button', {
      class: 'iconbtn', 'aria-label': 'Copy this day', innerHTML: svg('copy'),
      onclick: openCopySheet,
    }),
    el('button', {
      class: 'iconbtn', 'aria-label': 'Next day', innerHTML: svg('chevR'),
      onclick: () => { day = addDays(day, 1); anchor = null; rerender(); },
    }),
  );

  /* palette */
  const palette = el('div', { class: 'chips', role: 'toolbar', 'aria-label': 'Activity palette' },
    Store.state.activities.map((a) =>
      el('button', {
        class: 'chip', style: `--h:${a.hue}`, dataset: { act: a.id },
        'aria-pressed': String(brush === a.id),
        onclick: () => pickBrush(a.id),
      }, el('i', { class: 'dot' }), a.name)
    ),
    el('button', {
      class: 'chip', 'aria-pressed': String(brush === 'erase'),
      onclick: () => pickBrush('erase'),
    }, el('i', { innerHTML: svg('broom', 14) }), 'Erase'),
    el('button', { class: 'chip add', onclick: addSubjectFlow },
      el('i', { innerHTML: svg('plus', 14) }), 'Subject')
  );

  /* grid */
  const grid = el('div', { class: 'grid' });

  for (const b of blocks) {
    const act = Store.activity(b.actId);
    grid.append(el('button', {
      class: 'block',
      style: `--h:${act ? act.hue : 100};top:${b.s * slotPx()}px;height:${(b.e - b.s) * slotPx() - 2}px`,
      'aria-label': `${act ? act.name : 'Block'} ${slotsToT(b.s)} to ${slotsToT(b.e)}`,
      onclick: () => (brush ? onGridTapBrush(b) : openBlockSheet(b.id)),
    },
      el('b', {}, act ? act.name : '?'),
      (b.e - b.s) >= 2 ? el('span', {}, `${slotsToT(b.s)}–${slotsToT(b.e)}`) : null
    ));
  }

  if (!blocks.length) {
    grid.append(el('div', {
      class: 'empty',
      style: 'position:absolute;inset:0;display:grid;place-items:center;pointer-events:none;padding:0 26px;text-align:center',
    },
      brush ? 'Tap the start, then tap the end.' : 'Pick a chip above, then tap two spots to paint.'
    ));
  }

  if (day === nowDate && !Store.state.session) {
    const now = new Date();
    grid.append(el('div', { class: 'nowline', style: `top:${((now.getHours() * 60 + now.getMinutes()) / SLOT_MIN) * slotPx()}px` }));
  }
  if (anchor !== null) {
    grid.append(el('div', { class: 'anchorline', style: `top:${anchor * slotPx()}px` }));
  }

  grid.addEventListener('click', onGridTap);
  const gridRow = el('div', { class: 'row', style: 'align-items:stretch;gap:8px' },
    hoursCol(), el('div', { class: 'grow', style: 'min-width:0' }, grid));

  /* day stats */
  const st = Store.dayStats(day).tally;
  const mins = (m) => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ' ' + (m % 60) + 'm' : ''}` : `${m}m`);
  const tasks = Store.tasksOn(day);
  const daystats = el('div', { class: 'card tight' },
    el('div', { class: 'daystats' },
      el('span', { class: 'dstat hl' }, 'Study ', el('b', {}, mins(st.study))),
      el('span', { class: 'dstat' }, 'Sleep ', el('b', {}, mins(st.sleep))),
      el('span', { class: 'dstat' }, 'Rest ', el('b', {}, mins(st.rest))),
      el('span', { class: 'dstat' }, 'Meals ', el('b', {}, mins(st.meal))),
      el('span', { class: 'dstat' }, 'Free ', el('b', {}, mins(st.free))),
      tasks.length ? el('span', { class: 'dstat' }, `Tasks ${tasks.filter((t) => t.doneAt).length}/${tasks.length}`) : null,
    )
  );

  host.append(el('section', { class: 'view-anim stagger' },
    head,
    el('div', { class: 'card tight', style: 'padding:12px' }, palette),
    el('div', { class: 'card', style: 'padding:10px 12px' }, gridRow),
    daystats,
    el('div', { class: 'card' }, el('h2', {}, 'Tasks for this day'), tasksList(tasks)),
  ));

  if (anchor !== null) hint('Now tap the end. Tapping the same slot paints one block.');
}

/* hours gutter */
function hoursCol() {
  const col = el('div', { class: 'hours' });
  for (let h = 0; h <= 24; h += 2) {
    col.append(el('span', { style: `top:${h * 2 * slotPx()}px` }, slotsToT(h * 2)));
  }
  col.style.height = `${48 * slotPx()}px`;
  return col;
}

/* ---------- palette ---------- */

function pickBrush(id) {
  brush = brush === id ? null : id;
  anchor = null;
  rerender();
}

function addSubjectFlow() {
  openSheet('Add a subject', (close) => {
    const input = el('input', { type: 'text', placeholder: 'e.g. Physics', maxlength: 24 });
    const suggestions = el('div', { class: 'chips', style: 'margin-top:12px' },
      ['Physics', 'Chemistry', 'Maths', 'Biology', 'Revision', 'Mock tests'].map((s) =>
        el('button', { class: 'chip', type: 'button', onclick: () => { input.value = s; } }, s)));
    const form = el('form', {
      onsubmit: (ev) => {
        ev.preventDefault();
        const name = input.value.trim();
        if (!name) return;
        const act = Store.addSubject(name);
        close();
        brush = act.id;
        anchor = null;
        rerender();
      },
    },
      el('p', { class: 'muted', style: 'margin:0 0 10px' }, 'Subjects become study blocks on the grid.'),
      el('div', { class: 'addtask' },
        input,
        el('button', { type: 'submit', class: 'btn btn-primary', 'aria-label': 'Add' }, svg('check', 17))),
      suggestions);
    setTimeout(() => input.focus(), 140);
    return form;
  });
}

/* ---------- painting ---------- */

function slotFromEvent(grid, ev) {
  const rect = grid.getBoundingClientRect();
  return clamp(Math.floor((ev.clientY - rect.top) / slotPx()), 0, 47);
}

function onGridTap(ev) {
  // block taps are owned by the block's own button handler
  if (ev.target.closest('.block')) return;
  if (!brush) {
    if (anchor !== null) { deselection(); }
    else hint('Pick a chip above first.');
    return;
  }
  const grid = ev.currentTarget;
  const slot = slotFromEvent(grid, ev);

  if (anchor === null) {
    anchor = slot;
    rerender();
    return;
  }
  applyPaint(slot);
}

function onGridTapBrush(block) {
  // painting straight onto a block: anchor there (or close the range)
  if (anchor === null) {
    anchor = block.s;
    rerender();
    return;
  }
  applyPaint(block.s);
}

function applyPaint(slot) {
  const s = Math.min(anchor, slot);
  const e = Math.max(anchor, slot) + 1;
  if (brush === 'erase') {
    Store.replaceRange(day, Store.erode(Store.blocks(day), s, e));
  } else {
    Store.replaceRange(day, Store.paint(Store.blocks(day), brush, s, e));
  }
  anchor = null;
  rerender();
}

function deselection() {
  anchor = null;
  rerender();
}

/* ---------- block editor ---------- */

function openBlockSheet(blockId) {
  const b = Store.blocks(day).find((x) => x.id === blockId);
  if (!b) return;
  const act = Store.activity(b.actId);
  let s = b.s;
  let e = b.e;

  const timeSpan = el('span', { class: 'mono', style: 'font-weight:600' }, `${slotsToT(s)}–${slotsToT(e)}`);
  const dur = el('div', { class: 'tiny', style: 'text-align:center;margin-top:2px' }, `${(e - s) * SLOT_MIN} min`);

  const commit = () => {
    const fresh = Store.blocks(day).filter((x) => x.id !== blockId);
    Store.replaceRange(day, Store.paint(fresh, b.actId, s, e));
    timeSpan.textContent = `${slotsToT(s)}–${slotsToT(e)}`;
    dur.textContent = `${(e - s) * SLOT_MIN} min`;
    rerender();
  };

  const step = (label, delta, fn) => el('button', {
    class: 'iconbtn', 'aria-label': label, innerHTML: svg(delta > 0 ? 'plus' : 'minus'),
    onclick: () => { fn(); commit(); },
  });

  const actChips = el('div', { class: 'chips', style: 'margin-top:14px' },
    Store.state.activities.map((a) =>
      el('button', {
        class: 'chip', style: `--h:${a.hue}`,
        'aria-pressed': String(a.id === b.actId),
        onclick: () => { b.actId = a.id; commit(); },
      }, el('i', { class: 'dot' }), a.name)
    ));

  const row = el('div', { class: 'row', style: 'justify-content:center;gap:16px' },
    step('Move start earlier', -1, () => { s = clamp(s - 1, 0, e - 1); }),
    el('div', {}, timeSpan, dur),
    step('Move end later', +1, () => { e = clamp(e + 1, s + 1, 48); }),
    step('Shrink end', -1, () => { e = clamp(e - 1, s + 1, 48); }),
    step('Grow start later', +1, () => { s = clamp(s + 1, 0, e - 1); }),
  );

  openSheet(`${act ? act.name : 'Block'} · ${slotsToT(b.s)}–${slotsToT(b.e)}`, () => [
    el('p', { class: 'tiny', style: 'text-align:center;margin:0 0 10px' }, 'Changes save as you tap.'),
    row,
    actChips,
    el('button', {
      class: 'btn btn-danger btn-block', style: 'margin-top:14px',
      onclick: () => { Store.replaceRange(day, Store.blocks(day).filter((x) => x.id !== blockId)); closeSheet(); rerender(); },
    }, svg('trash', 16), 'Delete block'),
  ]);
}

/* ---------- copy day ---------- */

function openCopySheet() {
  const freshId = () => uid('blk');
  function copyTo(key) {
    const blocks = Store.blocks(day).map((b) => ({ ...b, id: freshId() }));
    const tasks = Store.tasksOn(day).map((t) => ({
      id: uid('tk'), date: key, title: t.title,
      stages: t.stages.map((g) => ({ label: g.label, done: false })),
      subjectId: t.subjectId, doneAt: null,
    }));
    Store.set((s) => {
      s.plans[key] = (s.plans[key] || []).concat(blocks);
      s.tasks.push(...tasks);
    });
    hint(`Copied to ${prettyDate(key)}`);
    closeSheet();
  }
  openSheet('Copy this day to…', () => [
    el('button', { class: 'btn btn-subtle btn-block', onclick: () => copyTo(addDays(day, 1)) }, 'Tomorrow'),
    el('button', {
      class: 'btn btn-subtle btn-block', style: 'margin-top:10px',
      onclick: () => { let d = addDays(day, 1); while (weekdayShort(d) !== weekdayShort(day)) d = addDays(d, 1); copyTo(d); },
    }, 'Same weekday next week'),
    el('div', { class: 'row', style: 'margin-top:10px' },
      el('input', {
        type: 'date', value: day,
        onchange: (ev) => copyTo(ev.target.value),
        style: 'flex:1;padding:11px 14px;border-radius:12px;border:1px solid var(--line);background:var(--panel-2);color:var(--tx)',
      })),
    el('p', { class: 'tiny', style: 'text-align:center;margin-top:10px' }, 'Blocks and tasks copy over; ticked stages are reset.'),
  ]);
}

/* ---------- tasks ---------- */

function tasksList(tasks) {
  const list = el('div', {});
  if (!tasks.length) list.append(el('div', { class: 'empty' }, 'No tasks for this date — add one, or copy them with the day.'));
  tasks.forEach((t) => list.append(taskRow(t)));

  const input = el('input', { type: 'text', placeholder: 'Add a task for this day…', maxlength: 120 });
  const add = el('form', {
    class: 'addtask',
    onsubmit: (ev) => {
      ev.preventDefault();
      const title = input.value.trim();
      if (!title) return;
      Store.set((s) => s.tasks.push({ id: uid('tk'), date: day, title, stages: [], subjectId: null, doneAt: null }));
      rerender();
      setTimeout(() => document.querySelector('.addtask input')?.focus(), 80);
    },
  }, input, el('button', { type: 'submit', class: 'btn btn-primary', 'aria-label': 'Add task', innerHTML: svg('plus', 17) }));
  list.append(add);
  return list;
}

function taskRow(t) {
  const body = el('div', { class: 'body' }, el('div', { class: 'label' }, t.title));

  if (t.stages.length) {
    const stages = el('div', { class: 'stages' });
    t.stages.forEach((g, gi) => {
      const box = el('input', {
        type: 'checkbox',
        checked: !!g.done,
        onchange: () => Store.set((s) => { s.tasks.find((y) => y.id === t.id).stages[gi].done = !g.done; }),
      });
      stages.append(el('label', { class: 'stage', style: g.done ? 'text-decoration:line-through;color:var(--tx-3)' : '' }, box, g.label));
    });
    body.append(stages);
  }

  const tick = el('button', {
    class: 'tick', innerHTML: svg('check', 13),
    'aria-label': t.doneAt ? 'Reopen task' : 'Complete task',
    onclick: () => Store.set((s) => { const x = s.tasks.find((y) => y.id === t.id); x.doneAt = x.doneAt ? null : Date.now(); }),
  });
  const del = el('button', {
    class: 'del', 'aria-label': 'Delete task', innerHTML: svg('trash', 15),
    onclick: () => Store.set((s) => { s.tasks = s.tasks.filter((y) => y.id !== t.id); }),
  });
  return el('div', { class: `taskrow ${t.doneAt ? 'done' : ''}` }, tick, body, del);
}

/* ---------- boot ---------- */

function rerender() {
  const host = document.getElementById('view');
  host.textContent = '';
  render(host);
}

function mount(host) {
  render(host);
  tickTimer = setInterval(() => {
    if (day !== todayKey()) return;
    const line = host.querySelector('.nowline');
    if (line) line.style.top = `${(new Date().getHours() * 60 + new Date().getMinutes()) / SLOT_MIN * slotPx()}px`;
  }, 30000);
}

function unmount() {
  clearInterval(tickTimer);
  anchor = null;
}
