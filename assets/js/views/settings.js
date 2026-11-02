/* Lockin — Settings: enforcement, sounds, theme, goals, data in/out, walkthrough. */

import { Store } from '../store.js';
import { Router } from '../router.js';
import { el, fmtMin } from '../util.js';
import { svg } from '../icons.js';
import { openSheet, hint } from '../ui.js';
import { tryInstall } from '../install.js';
import { Sounds } from '../audio.js';

export function initSettings(Router) {
  Router.register('/settings', { mount, unmount: null });
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
  const wrap = el('div', { class: 'row', style: 'gap:6px' });
  const val = el('span', { class: 'mono', style: 'min-width:64px;text-align:center;font-size:14px' }, show(get()));
  const redraw = () => { val.textContent = show(get()); };
  const mk = (d, label) => el('button', {
    class: 'iconbtn', style: 'width:34px;height:34px', 'aria-label': label, innerHTML: svg(d > 0 ? 'plus' : 'minus', 15),
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
      `Focus sessions lock the app full-screen and flame the clock. Leaving >10s mid-focus = slip (logged). Under 10s = forgiven, 3 free a day.`,
      toggle(() => s.strict, () => Store.set((st) => { st.settings.strict = !st.settings.strict; }))),
    setrow('Keep screen awake',
      'Screen Wake Lock during focus sessions — the phone stays awake while you study.',
      toggle(() => s.wakelock, () => Store.set((st) => { st.settings.wakelock = !st.settings.wakelock; }))),
    setrow('Notifications',
      'A ping and a buzz when a round completes (asks your browser for permission first time).',
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

function soundCard() {
  const s = Store.state.settings;
  const kinds = Sounds.KINDS;
  const chips = el('div', { class: 'chips', style: 'margin-left:auto' },
    kinds.map((k) => {
      const c = el('button', {
        class: 'chip', style: 'padding:6px 11px;font-size:12px',
        'aria-pressed': String(s.soundKind === k),
        onclick: () => {
          Store.set((st) => { st.settings.soundKind = k; });
          if (s.sounds) { Sounds.setVolume(s.volume ?? 0.6); Sounds.play(k); }
          else Sounds.stop();
          sync();
        },
      }, k);
      return c;
    }));
  function sync() {
    [...chips.children].forEach((c) => c.setAttribute('aria-pressed', String(c.textContent === Store.state.settings.soundKind)));
  }
  return el('div', { class: 'card' },
    el('h2', {}, 'Focus sounds'),
    setrow('Ambient sound', 'Rain, brown noise, a lo-fi pad, or silence. Also swappable from inside a session.', chips),
    setrow('Sounds on', 'Plays automatically when a session starts.',
      toggle(() => s.sounds, () => {
        Store.set((st) => { st.settings.sounds = !st.settings.sounds; });
        if (!s.sounds) Sounds.stop();
      })),
    setrow('Volume', 'Applies to all Lockin sounds.', stepper(
      () => Math.round((s.volume ?? 0.6) * 100),
      (v) => { Store.set((st) => { st.settings.volume = v / 100; }); Sounds.setVolume(v / 100); },
      { lo: 0, hi: 100, step: 5, suffix: '%' })),
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
  const seg = el('div', { class: 'chips', style: 'margin-left:auto' },
    ['system', 'dark', 'light'].map((t) => el('button', {
      class: 'chip', style: 'padding:6px 11px;font-size:12px',
      'aria-pressed': String(s.theme === t),
      onclick: () => { Store.set((st) => { st.settings.theme = t; }); sync(); },
    }, t)));
  function sync() {
    [...seg.children].forEach((c) => c.setAttribute('aria-pressed', String(c.textContent === Store.state.settings.theme)));
  }
  return el('div', { class: 'card' },
    el('h2', {}, 'Look'),
    setrow('Theme', 'Locked to your OS by default.', seg),
  );
}

/* ---------- profile (name + exam from the /setup questionnaire) ---------- */

function profileCard() {
  const p = Store.state.profile || { name: '', exam: '' };
  const nameInp = el('input', { class: 'inp', maxlength: 24, value: p.name, autocomplete: 'off', spellcheck: 'false' });
  const examInp = el('input', { class: 'inp', maxlength: 28, value: p.exam, autocomplete: 'off', spellcheck: 'false' });
  const save = el('button', {
    class: 'btn btn-subtle btn-block', style: 'margin-top:8px',
    onclick: () => {
      Store.setProfile(nameInp.value, examInp.value);
      hint('Profile saved.');
    },
  }, svg('check', 16), 'Save profile');
  return el('div', { class: 'card' },
    el('h2', {}, 'Profile'),
    el('p', { class: 'muted', style: 'margin:0 0 10px' }, 'Your name and exam personalize Home, the session screens and the seeds.'),
    el('div', { style: `display:grid;grid-template-columns:1fr;gap:8px` },
      el('div',{}, el('div', { class: 'tiny', style: 'color:var(--tx-3);margin-bottom:3px' }, 'Name'), nameInp),
      el('div',{}, el('div', { class: 'tiny', style: 'color:var(--tx-3);margin-bottom:3px' }, 'Target exam'), examInp),
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
    class: 'btn btn-subtle btn-block', innerHTML: '', onclick: () => {
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
          onclick: () => { Store.reset(); close(); Router.go('/setup'); hint('Cleared.'); },
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
    el('p', { class: 'muted', style: 'margin:0 0 12px' },
      'Everything lives in this browser’s localStorage. No account, no analytics, no network calls beyond this page.'),
    exportBtn, installBtn, replayBtn,
    el('div', { style: 'height:10px' }),
    importBtn, wipeBtn, input,
  );
}

const Storetoday = () => new Date().toISOString().slice(0, 10);

function aboutCard() {
  return el('div', { class: 'card' },
    el('h2', {}, 'About'),
    el('div', { style: 'font:400 30px "Instrument Serif",serif;text-align:center;margin:4px 0 2px' }, 'Lockin'),
    el('div', { class: 'tiny', style: 'text-align:center' }, `v1.0 · focus, strictly`),
    el('div', { class: 'row', style: 'justify-content:center;gap:8px;margin-top:10px' },
      el('a', { class: 'chip', href: 'tests.html', style: 'text-decoration:none' }, 'Run the self-check'),
    ),
  );
}

function render(host) {
  host.append(el('section', { class: 'view-anim stagger' },
    el('div', { class: 'app-head' },
      el('div', { class: 'grow' },
        el('h1', {}, 'Settings'),
        el('div', { class: 'sub' }, 'Pull any lever; nothing is dark-pattern-locked.'),
      ),
    ),
    enforcementCard(),
    profileCard(),
    soundCard(),
    pomoCard(),
    lookCard(),
    dataCard(),
    aboutCard(),
  ));
}

function mount(host) {
  render(host);
}
