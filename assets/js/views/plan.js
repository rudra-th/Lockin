/* Lockin — Plan: the daily task list for today and tomorrow.
   The 24-hour timetable is explicitly parked behind a "coming soon" card. */

import { Store } from '../store.js';
import { el, todayKey, addDays, prettyDate, parseKey } from '../util.js';
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
