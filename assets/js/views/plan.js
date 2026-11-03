/* Lockin — Plan: the daily task list for today and tomorrow, plus subjects.
   The 24-hour timetable is explicitly parked behind a "coming soon" card. */

import { Store } from '../store.js';
import { el, todayKey, addDays, prettyDate, parseKey } from '../util.js';
import { svg } from '../icons.js';
import { hint } from '../ui.js';
import { taskList } from '../tasks.js';

export function initPlan(Router) {
  Router.register('/plan', { mount, unmount: null });
}

function taskDayCard(day) {
  const tasks = Store.tasksOn(day);
  const done = tasks.filter((t) => t.doneAt).length;
  const long = parseKey(day).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

  return el('div', { class: 'card' },
    el('div', { class: 'taskdayhead' },
      el('div', {},
        el('h2', {}, prettyDate(day)),
        el('div', { class: 'taskday-date' }, long),
      ),
      el('span', { class: `pill${tasks.length && done === tasks.length ? ' acc' : ''}` },
        tasks.length ? `${done}/${tasks.length} done` : 'nothing yet'),
    ),
    taskList(day, tasks, {
      emptyText: day === todayKey()
        ? 'No tasks yet. Add the first thing you want to finish.'
        : 'Tomorrow is open. Add what you want waiting for you.',
      placeholder: day === todayKey() ? 'Add a task for today…' : 'Add a task for tomorrow…',
      onChange: rerender,
    }),
  );
}

function subjectCard() {
  const subjects = Store.subjects();
  const list = el('div', { class: 'subjectlist' });

  subjects.forEach((a) => {
    list.append(el('div', { class: 'subjectrow' },
      el('i', { class: 'dot', style: `background:hsl(${a.hue} 55% 52%)` }),
      el('span', { class: 'sname' }, a.name),
      el('button', {
        class: 'del', 'aria-label': `Remove ${a.name}`, innerHTML: svg('trash', 15),
        onclick: () => {
          Store.archiveSubject(a.id);
          hint(`${a.name} removed. Past stats keep it.`);
          rerender();
        },
      }),
    ));
  });

  if (!subjects.length) {
    list.append(el('div', { class: 'empty' }, 'No subjects yet. Add the first one — it will appear in Study Mode.'));
  }

  const input = el('input', {
    type: 'text', placeholder: 'Add a subject…', maxlength: 24,
    autocomplete: 'off', spellcheck: 'false', 'aria-label': 'New subject name',
  });
  const form = el('form', {
    class: 'addtask',
    dataset: { subject: 'new' },
    onsubmit: (ev) => {
      ev.preventDefault();
      const act = Store.addSubject(input.value);
      if (!act) { hint('Give the subject a name.'); return; }
      rerender();
      setTimeout(() => document.querySelector('.addtask[data-subject="new"] input')?.focus(), 60);
    },
  }, input, el('button', { type: 'submit', class: 'btn btn-primary', 'aria-label': 'Add subject' }, svg('plus', 17)));

  return el('div', { class: 'card' },
    el('h2', {}, 'Subjects'),
    el('p', { class: 'muted', style: 'margin:0 0 4px' },
      'Name what you study. Sessions pick from this list — nothing is preloaded.'),
    list,
    form,
    el('p', { class: 'tiny', style: 'margin-top:10px' },
      'Removing a subject hides it from new sessions. Old sessions keep their name in Stats.'),
  );
}

function render(host) {
  const t = todayKey();
  const tomorrow = addDays(t, 1);

  host.append(el('section', { class: 'view-anim stagger' },
    el('div', { class: 'app-head' },
      el('div', { class: 'grow' },
        el('h1', {}, 'Plan'),
        el('div', { class: 'sub' }, 'Tasks for today and tomorrow.'),
      ),
    ),

    el('div', { class: 'card soon-card' },
      el('div', { class: 'soon-top' },
        el('span', { class: 'soon-tag' }, 'Timetable'),
        el('span', { class: 'pill acc' }, 'Coming soon'),
      ),
      el('div', { class: 'soon-title' }, 'The 24-hour grid is ', el('em', {}, 'being rebuilt.')),
      el('p', { class: 'soon-copy' },
        'Painting sleep, meals and study blocks across the day returns in a later release. Until then, keep the day honest with tasks and Study Mode.'),
    ),

    taskDayCard(t),
    taskDayCard(tomorrow),
    subjectCard(),
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

function mount(host) {
  render(host);
}
