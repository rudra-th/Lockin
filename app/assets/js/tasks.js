/* Lockin — shared task controls: add, tick, remove. Used by Plan and Home. */

import { Store, uid } from './store.js';
import { el } from './util.js';
import { svg } from './icons.js';

export function taskRow(t, onChange = () => {}) {
  const body = el('div', { class: 'body' }, el('div', { class: 'label' }, t.title));

  if ((t.stages || []).length) {
    const stages = el('div', { class: 'stages' });
    t.stages.forEach((g, gi) => {
      const box = el('input', {
        type: 'checkbox',
        checked: !!g.done,
        onchange: () => {
          Store.set((s) => {
            const task = s.tasks.find((y) => y.id === t.id);
            if (task?.stages?.[gi]) task.stages[gi].done = !g.done;
          });
          onChange();
        },
      });
      stages.append(el('label', {
        class: 'stage',
        style: g.done ? 'text-decoration:line-through;color:var(--tx-3)' : '',
      }, box, g.label));
    });
    body.append(stages);
  }

  const tick = el('button', {
    class: 'tick', innerHTML: svg('check', 13),
    'aria-label': t.doneAt ? 'Reopen task' : 'Complete task',
    onclick: () => {
      Store.set((s) => {
        const task = s.tasks.find((y) => y.id === t.id);
        if (task) task.doneAt = task.doneAt ? null : Date.now();
      });
      onChange();
    },
  });

  const del = el('button', {
    class: 'del', 'aria-label': `Delete “${t.title}”`, innerHTML: svg('trash', 15),
    onclick: () => {
      Store.set((s) => { s.tasks = s.tasks.filter((y) => y.id !== t.id); });
      onChange();
    },
  });

  return el('div', { class: `taskrow ${t.doneAt ? 'done' : ''}` }, tick, body, del);
}

export function taskAddForm(day, { placeholder = 'Add a task…', onChange = () => {} } = {}) {
  const input = el('input', {
    type: 'text', placeholder, maxlength: 120, 'aria-label': placeholder,
  });
  return el('form', {
    class: 'addtask',
    dataset: { day },
    onsubmit: (ev) => {
      ev.preventDefault();
      const title = input.value.trim();
      if (!title) return;
      Store.set((s) => s.tasks.push({
        id: uid('tk'), date: day, title, stages: [], doneAt: null,
      }));
      onChange();
      setTimeout(() => {
        document.querySelector(`.addtask[data-day="${day}"] input`)?.focus();
      }, 60);
    },
  },
    input,
    el('button', { type: 'submit', class: 'btn btn-primary', 'aria-label': 'Add task' }, svg('plus', 17)),
  );
}

export function taskList(day, tasks, { emptyText, placeholder, onChange } = {}) {
  const list = el('div', { class: 'tasklist' });
  if (!tasks.length) list.append(el('div', { class: 'empty task-empty' }, emptyText));
  tasks.forEach((t) => list.append(taskRow(t, onChange)));
  list.append(taskAddForm(day, { placeholder, onChange }));
  return list;
}
