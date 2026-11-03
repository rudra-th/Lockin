/* Lockin — the opening film.
   First run is one continuous piece: the name, the exam, the rough date, the
   daily target, then the honest rules. Full-bleed scenes, one idea at a time.
   Rerunnable from Settings (personalization is skipped when the profile is
   already known). */

import { Store } from '../store.js';
import { Router } from '../router.js';
import { el, daysUntil } from '../util.js';
import { svg } from '../icons.js';
import { hint } from '../ui.js';
import { GRACE_SEC, RESCUE_CAP } from './focus.js';
import {
  PRIMARY_EXAMS, MORE_EXAMS, MONTHS, examById, examByName, examDateFor,
  expectedYear, formatExamMonth,
} from '../exams.js';

export function initWalkthrough(Router) {
  Router.register('/start', { mount, unmount });
}

/* ---------- first-run state ---------- */

const state = {
  name: '', exam: '', examId: '', examDate: '',
  month: 4, year: new Date().getFullYear(), hours: 2,
};

let scenes = [];
let idx = 0;

function readProfile() {
  const p = Store.state.profile || {};
  const cat = examById(p.examId) || examByName(p.exam);
  const baseMonth = cat ? cat.month : 4;
  let month = baseMonth;
  let year = expectedYear(baseMonth, cat ? cat.day : 1);

  if (p.examDate) {
    const d = new Date(`${p.examDate}T12:00:00`);
    if (!Number.isNaN(d.getTime())) { month = d.getMonth(); year = d.getFullYear(); }
  }
  state.name = p.name || '';
  state.exam = p.exam || '';
  state.examId = cat ? cat.id : (p.exam ? 'custom' : '');
  state.examDate = p.examDate || '';
  state.month = month;
  state.year = year;
  const goalHours = Math.round((Store.state.settings.goalMin || 120) / 60);
  state.hours = Math.max(1, Math.min(8, goalHours || 2));
}

function currentExam() {
  return examById(state.examId);
}

function chosenDate() {
  return examDateFor(currentExam(), state.month, state.year);
}

function syncProfile() {
  Store.setProfile(state.name, state.exam, state.examDate || '', state.examId);
}

/* ---------- navigation ---------- */

function go(n) {
  idx = Math.max(0, Math.min(scenes.length - 1, n));
  render();
  const host = document.getElementById('view');
  if (host) host.scrollTop = 0;
}

function finish() {
  Store.set((s) => { s.flags.onboarded = true; });
  document.body.dataset.mode = '';
  Router.go('/home');
  hint(state.name ? `Locked in, ${state.name}. Add a task, then start the clock.` : 'Locked in. Add a task, then start the clock.');
}

/* ---------- tiny building blocks ---------- */

function kicker(text) {
  return el('div', { class: 'film-kicker' }, text);
}

function title(...parts) {
  return el('h1', { class: 'film-title' }, ...parts);
}

function lede(text) {
  return el('p', { class: 'film-lede' }, text);
}

function primary(label, onclick) {
  return el('button', { class: 'btn btn-primary btn-block', onclick }, label);
}

function ghost(label, onclick) {
  return el('button', { class: 'film-ghost', onclick }, label);
}

function readout(main, sub) {
  return el('div', { class: 'film-readout' },
    el('span', { class: 'readout-main' }, main),
    sub ? el('span', { class: 'readout-sub' }, sub) : null,
  );
}

/* ---------- scenes ---------- */

function introScene() {
  return [
    kicker('A study clock, not a tracker'),
    title('Study has ', el('em', {}, 'a shape.')),
    lede('Set a daily target. Then run it in Study Mode — the clock stays awake, the target stays in front of you, and the app remembers when you leave.'),
    el('div', { class: 'film-meta' },
      el('span', {}, 'Focus'), el('i'), el('span', {}, 'Daily tasks'), el('i'), el('span', {}, 'Honest stats')),
  ];
}

function nameScene() {
  const input = el('input', {
    class: 'film-input', id: 'film-name', value: state.name,
    placeholder: 'Your name', maxlength: 24, autocomplete: 'off', spellcheck: 'false',
    'aria-label': 'Your name',
    oninput: (ev) => { state.name = ev.target.value; },
    onkeydown: (ev) => { if (ev.key === 'Enter') { syncProfile(); go(idx + 1); } },
  });
  return [
    kicker('First, the name'),
    title('What should we ', el('em', {}, 'call you?')),
    lede('It personalizes the greeting, the session screens and your stats. It stays on this device — no account, no cloud.'),
    el('label', { class: 'film-field' }, input),
  ];
}

function examScene() {
  const cards = new Map();
  const primaryWrap = el('div', { class: 'exam-grid' });
  const moreWrap = el('div', { class: 'exam-grid exam-more-grid' });
  moreWrap.hidden = !MORE_EXAMS.includes(state.examId);
  const moreBtn = el('button', {
    class: 'exam-more-toggle', 'aria-expanded': String(!moreWrap.hidden),
    onclick: () => {
      moreWrap.hidden = !moreWrap.hidden;
      moreBtn.setAttribute('aria-expanded', String(!moreWrap.hidden));
      moreBtn.querySelector('span').textContent = moreWrap.hidden ? 'More exams' : 'Fewer exams';
    },
  }, el('span', {}, 'More exams'), el('i', { innerHTML: svg('caret', 15) }));

  const customInput = el('input', {
    class: 'film-input', value: examById(state.examId) ? '' : state.exam,
    placeholder: 'Type the exam', maxlength: 28, autocomplete: 'off', spellcheck: 'false',
    'aria-label': 'Your exam',
    oninput: (ev) => {
      state.exam = ev.target.value;
      state.examDate = state.exam ? examDateFor(null, state.month, state.year) : '';
      syncContinue();
    },
    onkeydown: (ev) => { if (ev.key === 'Enter' && state.exam) { syncProfile(); go(idx + 1); } },
  });
  const customWrap = el('div', { class: 'exam-custom' }, customInput);
  customWrap.hidden = state.examId !== 'custom';

  const nextBtn = primary('Continue', () => {
    if (!state.exam.trim()) { hint('Pick an exam, or type your own.'); return; }
    state.exam = state.exam.trim();
    syncProfile();
    go(idx + 1);
  });
  nextBtn.disabled = !state.exam;

  function syncContinue() {
    nextBtn.disabled = !state.exam.trim();
  }

  function paint() {
    for (const [id, btn] of cards) {
      btn.classList.toggle('is-on', state.examId === id);
      btn.setAttribute('aria-pressed', String(state.examId === id));
    }
    customWrap.hidden = state.examId !== 'custom';
  }

  function card(id) {
    const ex = examById(id);
    const b = el('button', {
      class: 'exam-card', 'aria-pressed': 'false', dataset: { exam: id },
      onclick: () => {
        state.examId = id;
        state.exam = ex.name;
        state.month = ex.month;
        state.year = expectedYear(ex.month, ex.day);
        state.examDate = examDateFor(ex, state.month, state.year);
        paint();
        syncContinue();
        moreWrap.hidden = !MORE_EXAMS.includes(id);
        moreBtn.setAttribute('aria-expanded', String(!moreWrap.hidden));
        moreBtn.querySelector('span').textContent = moreWrap.hidden ? 'More exams' : 'Fewer exams';
      },
    }, el('b', {}, ex.name), el('span', {}, ex.window));
    cards.set(id, b);
    return b;
  }

  PRIMARY_EXAMS.forEach((id) => primaryWrap.append(card(id)));
  MORE_EXAMS.forEach((id) => moreWrap.append(card(id)));

  const other = el('button', {
    class: `exam-other${state.examId === 'custom' ? ' is-on' : ''}`,
    'aria-pressed': String(state.examId === 'custom'),
    onclick: () => {
      state.examId = 'custom';
      state.exam = customInput.value.trim();
      state.examDate = state.exam ? examDateFor(null, state.month, state.year) : '';
      [...cards.values()].forEach((b) => { b.classList.remove('is-on'); b.setAttribute('aria-pressed', 'false'); });
      other.classList.add('is-on');
      other.setAttribute('aria-pressed', 'true');
      customWrap.hidden = false;
      customInput.focus({ preventScroll: true });
      syncContinue();
    },
  }, el('span', {}, 'Something else'), el('span', { class: 'other-arrow' }, '↗'));

  paint();

  return [
    kicker('The target'),
    title('What are you ', el('em', {}, 'aiming at?')),
    lede('Pick the exam. Home keeps the countdown — no date knowledge beyond the rough month.'),
    primaryWrap,
    moreBtn,
    moreWrap,
    other,
    customWrap,
    el('div', { class: 'film-spacer' }),
    nextBtn,
  ];
}

function dateScene() {
  const monthRow = el('div', { class: 'month-grid' });
  const yearRow = el('div', { class: 'year-row' });
  const approx = el('div', { class: 'film-readout date-readout' });
  let monthBtns = [];
  let yearBtns = [];

  function examDay() {
    const ex = currentExam();
    return ex ? ex.day : 1;
  }

  function yearOptions() {
    const base = expectedYear(state.month, examDay());
    const set = new Set([base, base + 1, base + 2, base + 3, state.year]);
    return [...set].sort((a, b) => a - b).slice(0, 5);
  }

  function paint() {
    monthBtns.forEach((b, m) => {
      b.classList.toggle('is-on', m === state.month);
      b.setAttribute('aria-pressed', String(m === state.month));
    });
    yearBtns.forEach((b) => {
      const y = Number(b.dataset.year);
      b.classList.toggle('is-on', y === state.year);
      b.setAttribute('aria-pressed', String(y === state.year));
    });
    const key = chosenDate();
    const d = daysUntil(key);
    approx.textContent = '';
    approx.append(
      el('span', { class: 'readout-main' }, formatExamMonth(key)),
      el('span', { class: 'readout-sub' }, d === 0 ? 'today' : d === 1 ? '1 day away' : `${d} days away`),
    );
    state.examDate = key;
  }

  function rebuildYears() {
    yearRow.textContent = '';
    yearBtns = yearOptions().map((y) => {
      const b = el('button', {
        class: 'year', 'aria-pressed': 'false', dataset: { year: String(y) },
        onclick: () => { state.year = y; paint(); },
      }, String(y));
      yearRow.append(b);
      return b;
    });
    paint();
  }

  MONTHS.forEach((name, m) => {
    const b = el('button', {
      class: 'month', 'aria-pressed': 'false',
      onclick: () => {
        state.month = m;
        const base = expectedYear(m, examDay());
        if (state.year < base) state.year = base;
        rebuildYears();
      },
    }, name);
    monthBtns.push(b);
    monthRow.append(b);
  });

  rebuildYears();

  return [
    kicker(`The date · ${state.exam || 'your exam'}`),
    title('When is it, ', el('em', {}, 'roughly?')),
    lede('An approximate month is enough. Lockin counts whole days — no exact date needed.'),
    monthRow,
    el('div', { class: 'film-sublabel' }, 'Target year'),
    yearRow,
    approx,
    el('div', { class: 'film-spacer' }),
    primary('Continue', () => {
      state.examDate = chosenDate();
      syncProfile();
      go(idx + 1);
    }),
  ];
}

function hoursScene() {
  const row = el('div', { class: 'hour-grid' });
  const read = readout('', '');
  const btns = [];

  function paint() {
    btns.forEach((b) => {
      const h = Number(b.dataset.hours);
      b.classList.toggle('is-on', h === state.hours);
      b.setAttribute('aria-pressed', String(h === state.hours));
    });
    read.textContent = '';
    read.append(
      el('span', { class: 'readout-main' }, `${state.hours}h`),
      el('span', { class: 'readout-sub' }, state.hours === 1 ? 'a gentle bar' : 'a real bar, not a fantasy'),
    );
  }

  for (let h = 1; h <= 8; h += 1) {
    const b = el('button', {
      class: 'hour', 'aria-pressed': 'false', dataset: { hours: String(h) },
      onclick: () => { state.hours = h; paint(); },
    }, el('b', {}, String(h)), el('span', {}, 'h'));
    btns.push(b);
    row.append(b);
  }
  paint();

  return [
    kicker('The daily bar'),
    title('How much is ', el('em', {}, 'a good day?')),
    lede('Not the perfect day. The one you would actually repeat tomorrow. You can change this any time in Settings.'),
    row,
    read,
    el('div', { class: 'film-spacer' }),
    primary('Continue', () => {
      Store.set((s) => { s.settings.goalMin = state.hours * 60; });
      syncProfile();
      go(idx + 1);
    }),
  ];
}

function strictScene() {
  return [
    kicker('The honest part'),
    title('Strict, but ', el('em', {}, 'not a trap.')),
    el('div', { class: 'film-facts' },
      el('div', { class: 'fact' }, el('b', {}, `${GRACE_SEC}s`), el('span', {}, 'away is forgiven')),
      el('div', { class: 'fact' }, el('b', {}, `${RESCUE_CAP}×`), el('span', {}, 'rescues a day')),
      el('div', { class: 'fact' }, el('b', {}, '∞'), el('span', {}, 'slips in the log')),
    ),
    lede(`Leave a running session for longer than ${GRACE_SEC} seconds and it is a slip — recorded, not hidden. The screen stays awake while the clock runs. Strict is a switch in Settings, never a lock-in.`),
  ];
}

/* ---------- render ---------- */

const RENDERERS = {
  intro: introScene, name: nameScene, exam: examScene,
  date: dateScene, hours: hoursScene, strict: strictScene,
};

function buildScenes(replay) {
  const hasProfile = !!(state.name && state.exam && state.examDate);
  const full = ['intro', 'name', 'exam', 'date', 'hours', 'strict'];
  return replay && hasProfile ? ['intro', 'strict'] : full;
}

function sceneFooter(kind) {
  if (kind === 'intro') {
    return [
      primary('Begin', () => go(idx + 1)),
      ghost('Skip the tour', finish),
    ];
  }
  if (kind === 'name') {
    return [
      primary('Continue', () => { syncProfile(); go(idx + 1); }),
      ghost('Back', () => go(idx - 1)),
    ];
  }
  if (kind === 'strict') {
    return [
      primary('Start using Lockin', finish),
      ghost('Back', () => go(idx - 1)),
    ];
  }
  return [];
}

function render() {
  document.body.dataset.mode = 'onboard';
  const host = document.getElementById('view');
  host.textContent = '';

  const kind = scenes[idx];
  const bodyParts = RENDERERS[kind]();
  const footParts = sceneFooter(kind);

  const top = el('header', { class: 'film-top' },
    el('div', { class: 'film-bar' },
      idx > 0
        ? el('button', {
            class: 'film-back', 'aria-label': 'Back', innerHTML: svg('chevL', 18),
            onclick: () => go(idx - 1),
          })
        : el('div', { class: 'film-brand' }, el('i', { class: 'brand-dot' }), 'Lockin'),
      el('span', { class: 'film-step' }, `${String(idx + 1).padStart(2, '0')} / ${String(scenes.length).padStart(2, '0')}`),
    ),
    el('div', { class: 'film-track' }, el('i', { style: `width:${((idx + 1) / scenes.length) * 100}%` })),
  );

  const scene = el('div', { class: 'film-scene' }, ...bodyParts);
  const body = el('div', { class: 'film-body' }, scene);
  const foot = footParts.length ? el('footer', { class: 'film-foot' }, ...footParts) : null;

  host.append(el('section', { class: 'film' }, top, body, foot));
}

/* ---------- mounting ---------- */

function mount(host, params) {
  const replay = params?.replay === '1';
  if (Store.state.flags.onboarded && !replay) {
    Router.go('/home');
    return;
  }
  readProfile();
  scenes = buildScenes(replay);
  idx = 0;
  render();
}

function unmount() {
  document.body.dataset.mode = '';
}
