/* Lockin — Settings: enforcement, theme, goals, profile, data in/out. */

import { Store } from '../store.js';
import { Router } from '../router.js';
import { el, fmtMin } from '../util.js';
import { svg } from '../icons.js';
import { openSheet, hint } from '../ui.js';
import { tryInstall } from '../install.js';
import { examByName } from '../exams.js';

export function initSettings(Router) {
  Router.register('/settings', { mount, unmount: null });
}

function group(label, ...cards) {
  return el('section', { class: 'setgroup' },
    el('div', { class: 'setgroup-label' }, label),
    ...cards
  );
}

function setrow(title, desc, control) {
  return el('div', { class: 'setrow' },
    el('div', { class: 'txt' }, el('b', {}, title), el('span', {}, desc)),
    control
  );
}

function toggle(get, setfn) {
  const b = el('button', {
    class: 'switch', role: 'switch', 'aria-checked': String(get()),
    onclick: () => {
      setfn();
      b.setAttribute('aria-checked', String(get()));
    },
  });
  return b;
}

function stepper(get, setfn, opts) {
  const { def, lo, hi, step = 1, suffix = '', fmt = null } = opts;
  const show = (v) => (fmt ? fmt(v) : `${v}${suffix}`);
  const wrap = el('div', { class: 'stepper' });
  const val = el('span', { class: 'stepper-val' }, show(get()));
  const redraw = () => { val.textContent = show(get()); };
  const mk = (d, label) => el('button', {
    class: 'iconbtn stepper-btn', 'aria-label': label, innerHTML: svg(d > 0 ? 'plus' : 'minus', 15),
    onclick: () => { setfn(Math.max(lo, Math.min(hi, get() + d * step))); redraw(); },
  });
  wrap.append(mk(-1, 'Decrease'), val, mk(+1, 'Increase'));
  return wrap;
}

function enforcementCard() {
  const s = Store.state.settings;
  return el('div', { class: 'card' },
    el('h2', {}, 'Enforcement'),
    setrow('Strict Mode',
      `Leaving a focus session for more than ${10}s is a slip in the honesty log. Under ${10}s is forgiven — 3 free rescues a day.`,
      toggle(() => s.strict, () => Store.set((st) => { st.settings.strict = !st.settings.strict; }))),
    setrow('Keep screen awake',
      'Screen Wake Lock during focus sessions — the phone stays awake while you study.',
      toggle(() => s.wakelock, () => Store.set((st) => { st.settings.wakelock = !st.settings.wakelock; }))),
    setrow('Notifications',
      'A system notification and a buzz when a round completes (asks your browser for permission first time).',
      toggle(() => s.notifs, () => {
        Store.set((st) => { st.settings.notifs = !st.settings.notifs; });
        if (Store.state.settings.notifs && 'Notification' in window && Notification.permission === 'default') {
          Notification.requestPermission();
        }
      })),
    setrow('Daily focus goal', 'The ring you fill each day. Set it in hours and minutes.', stepper(
      () => Store.state.settings.goalMin,
      (v) => Store.set((st) => { st.settings.goalMin = v; }),
      { lo: 15, hi: 600, step: 15, fmt: fmtMin })),
    setrow('Minimum for a clean day', 'Days with less real focus than this never count as clean, even without slips.',
      stepper(() => Store.state.settings.minClean,
        (v) => Store.set((st) => { st.settings.minClean = v; }),
        { lo: 5, hi: 120, step: 5, fmt: fmtMin })),
  );
}

function pomoCard() {
  return el('div', { class: 'card' },
    el('h2', {}, 'Pomodoro'),
    setrow('Focus round length', 'Used by the ×3 Pomodoro chain.', stepper(
      () => Store.state.settings.pomo.focus,
      (v) => Store.set((st) => { st.settings.pomo.focus = v; }),
      { lo: 15, hi: 90, step: 5, suffix: 'm' })),
    setrow('Short break', 'After odd rounds.', stepper(
      () => Store.state.settings.pomo.short,
      (v) => Store.set((st) => { st.settings.pomo.short = v; }),
      { lo: 3, hi: 15, step: 1, suffix: 'm' })),
    setrow('Long break', 'After even rounds.', stepper(
      () => Store.state.settings.pomo.long,
      (v) => Store.set((st) => { st.settings.pomo.long = v; }),
      { lo: 10, hi: 45, step: 5, suffix: 'm' })),
  );
}

function lookCard() {
  const s = Store.state.settings;
  const seg = el('div', { class: 'segmented' },
    ['system', 'dark', 'light'].map((t) => el('button', {
      class: 'seg-btn', dataset: { theme: t },
      'aria-pressed': String(s.theme === t),
      onclick: () => { Store.set((st) => { st.settings.theme = t; }); sync(); },
    }, t)));
  function sync() {
    [...seg.children].forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.theme === Store.state.settings.theme)));
  }
  return el('div', { class: 'card' },
    el('h2', {}, 'Appearance'),
    setrow('Theme', 'Follows your OS by default.', seg),
  );
}

/* ---------- profile (name, exam and date from the opening film) ---------- */

function profileCard() {
  const p = Store.state.profile || { name: '', exam: '', examDate: '' };
  const nameInp = el('input', { class: 'inp', maxlength: 24, value: p.name, autocomplete: 'off', spellcheck: 'false' });
  const examInp = el('input', { class: 'inp', maxlength: 28, value: p.exam, autocomplete: 'off', spellcheck: 'false' });
  const dateInp = el('input', { class: 'inp', type: 'date', value: p.examDate || '' });
  const save = el('button', {
    class: 'btn btn-subtle btn-block', style: 'margin-top:8px',
    onclick: () => {
      const exam = examInp.value.trim();
      const cat = examByName(exam);
      Store.setProfile(nameInp.value, exam, dateInp.value,
        cat ? cat.id : (exam ? 'custom' : ''));
      hint('Profile saved.');
    },
  }, svg('check', 16), 'Save profile');
  return el('div', { class: 'card' },
    el('h2', {}, 'Profile'),
    el('p', { class: 'muted', style: 'margin:0 0 12px' }, 'Your name, exam and rough date personalize Home, the session screens and the seeds.'),
    el('div', { class: 'fields' },
      el('label', { class: 'field' }, el('span', {}, 'Name'), nameInp),
      el('label', { class: 'field' }, el('span', {}, 'Target exam'), examInp),
      el('label', { class: 'field' }, el('span', {}, 'Approx. exam date'), dateInp),
    ),
    save,
  );
}

function dataCard() {
  const input = el('input', {
    type: 'file', accept: 'application/json,.json',
    style: 'display:none',
    onchange: (ev) => {
      const file = ev.target.files[0];
      if (!file) return;
      file.text()
        .then((txt) => Store.importJSON(txt))
        .then(() => hint('Backup restored.'))
        .catch(() => hint('That file is not a Lockin backup.'));
      ev.target.value = '';
    },
  });

  const exportBtn = el('button', {
    class: 'btn btn-subtle btn-block', onclick: () => {
      const blob = new Blob([Store.exportJSON()], { type: 'application/json' });
      const a = el('a', { href: URL.createObjectURL(blob), download: `lockin-backup-${Storetoday()}.json` });
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      hint('Backup downloaded.');
    },
  }, svg('copy', 16), 'Export backup (JSON)');

  const importBtn = el('button', { class: 'btn btn-subtle btn-block', onclick: () => input.click() }, svg('book', 16), 'Restore backup');
  const replayBtn = el('button', {
    class: 'btn btn-subtle btn-block',
    onclick: () => { Router.go('/start?replay=1'); },
  }, svg('play', 16), 'Rerun the beginner walkthrough');

  const wipeBtn = el('button', {
    class: 'btn btn-danger btn-block',
    onclick: () => openSheet('Delete everything?', (close) => [
      el('p', { class: 'muted' }, 'Plans, sessions, streaks — gone for good. Export a backup first if any of it matters.'),
      el('div', { class: 'actions' },
        el('button', {
          class: 'btn btn-primary',
          onclick: () => { Store.reset(); close(); Router.go('/start'); hint('Cleared.'); },
        }, 'Wipe it'),
        el('button', { class: 'btn btn-subtle', onclick: () => close() }, 'Keep'),
      ),
    ]),
  }, svg('trash', 16), 'Erase all data');

  const installBtn = el('button', {
    class: 'btn btn-subtle btn-block', style: 'display:none',
    id: 'install-btn',
    onclick: () => { tryInstall(); },
  }, svg('copy', 16), 'Install Lockin');
  document.addEventListener('lockin:installable', () => { installBtn.style.display = ''; }, { once: true });
  if (window.matchMedia('(display-mode: standalone)').matches) installBtn.style.display = 'none';

  return el('div', { class: 'card' },
    el('h2', {}, 'Data & privacy'),
    el('p', { class: 'muted', style: 'margin:0 0 4px' },
      'Everything lives in this browser’s localStorage. No account, no analytics, no network calls beyond this page.'),
    el('div', { class: 'btn-stack' }, exportBtn, installBtn, replayBtn),
    el('div', { class: 'btn-stack' }, importBtn, wipeBtn),
    input,
  );
}

const Storetoday = () => new Date().toISOString().slice(0, 10);

function aboutCard() {
  return el('div', { class: 'card aboutcard' },
    el('div', { class: 'about-mark' }, el('i', { class: 'brand-dot' })),
    el('div', { class: 'about-name' }, 'Lockin'),
    el('div', { class: 'tiny' }, 'Focus, strictly. Built for one thing — study.'),
    el('div', { class: 'row', style: 'justify-content:center;gap:8px;margin-top:12px' },
      el('a', { class: 'chip', href: 'tests.html', style: 'text-decoration:none' }, 'Run the self-check'),
    ),
  );
}

function render(host) {
  host.append(el('section', { class: 'view-anim stagger' },
    el('div', { class: 'app-head' },
      el('div', { class: 'grow' },
        el('h1', {}, 'Settings'),
        el('div', { class: 'sub' }, 'Every lever, in the open.'),
      ),
    ),
    group('Focus', enforcementCard(), pomoCard()),
    group('You', profileCard(), lookCard()),
    group('Your data', dataCard()),
    group('About', aboutCard()),
  ));
}

function mount(host) {
  render(host);
}
