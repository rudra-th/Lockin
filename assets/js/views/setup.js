/* Lockin — first-run questionnaire: your name, the exam you're aiming at,
   and the hours a day you want to bank. Three screens, no account. */

import { Store } from '../store.js';
import { Router } from '../router.js';
import { el, fmtMin } from '../util.js';
import { svg } from '../icons.js';
import { hint } from '../ui.js';

export function initSetup(Router) {
  Router.register('/setup', { mount, unmount: null });
}

/* exam picks feed subject seeding + copy; anything else is typed free */
const EXAM_CHIPS = ['JEE', 'NEET', 'UPSC', 'GATE', 'CAT', 'CLAT', 'SSC', 'Boards'];
const HOUR_CHIPS = [1, 2, 3, 4, 5, 6];

const state = { step: 0, name: '', exam: '', hours: 2 };

function shell(title, body) {
  const dots = el('div', { class: 'dots' },
    [0, 1, 2].map((i) => el('i', { class: i === state.step ? 'on' : '' })));
  return el('section', { class: 'view-anim', style: 'margin:6vh auto 0;max-width:460px;padding:0 16px' },
    el('div', { class: 'card wt-card' },
      el('div', { class: 'tiny', style: 'color:var(--tx-3);margin-bottom:14px' }, `Question ${state.step + 1} of 3`),
      el('h2', {}, title),
      body,
      dots,
    ));
}

function slideName() {
  const inp = el('input', {
    class: 'inp', id: 'setup-name', maxlength: 24, placeholder: 'e.g. Rudra',
    value: state.name, autocomplete: 'off', spellcheck: 'false',
  }, {});
  const go = () => {
    const v = inp.value.trim();
    if (!v) { hint('Type a name — any name.'); inp.focus(); return; }
    state.name = v;
    state.step += 1;
    render();
  };
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  requestAnimationFrame(() => inp.focus());
  return shell('What should we call you?', el('div', {},
    el('p', {}, 'It personalizes your greeting and the demo. Stays on this device, like everything else here.'),
    inp,
    el('button', { class: 'btn btn-primary btn-block', style: 'margin-top:14px', onclick: go },
      svg('chevR', 16), 'Continue'),
  ));
}

function slideExam() {
  const inp = el('input', {
    class: 'inp', id: 'setup-exam', maxlength: 28,
    placeholder: 'Or type any exam…', value: state.exam,
    autocomplete: 'off', spellcheck: 'false',
  });
  const go = () => {
    const v = (inp.value.trim()) || state.exam;
    if (!v) { hint('Pick or type the exam you\'re preparing for.'); return; }
    state.exam = v;
    state.step += 1;
    render();
  };
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  const chips = el('div', { class: 'chips', style: 'justify-content:center;margin-top:14px' },
    EXAM_CHIPS.map(() => el('button', { class: 'chip' })));
  const sync = () => {
    for (const c of chips.children) {
      const label = c.textContent.trim();
      c.setAttribute('aria-pressed', String(state.exam === label));
    }
  };
  [...chips.children].forEach((c, i) => {
    c.textContent = EXAM_CHIPS[i];
    c.onclick = () => {
      state.exam = EXAM_CHIPS[i];
      inp.value = EXAM_CHIPS[i];
      sync();
    };
  });
  sync();
  return shell('What are you preparing for?', el('div', {},
    el('p', {}, 'Lockin seeds your plan and lenses with this — subjects, copy, everything.'),
    chips,
    inp,
    el('button', { class: 'btn btn-primary btn-block', style: 'margin-top:14px', onclick: go }, svg('chevR', 16), 'Continue'),
  ));
}

function slideHours() {
  const pick = (h) => {
    state.hours = h;
    render();
  };
  const chips = el('div', { class: 'chips', style: 'justify-content:center;margin-top:14px' },
    HOUR_CHIPS.map((h) => el('button', {
      class: 'chip', 'aria-pressed': String(state.hours === h),
      onclick: () => pick(h),
    }, `${h}h`)));
  return shell('Hours of real focus per day?', el('div', {},
    el('p', {}, 'Your daily ring fills against this. Be honest, not heroic — 2h held every day beats 5h in fantasy.'),
    chips,
    el('div', { class: 'row', style: 'justify-content:center;margin-top:10px' },
      el('span', { class: 'pill acc' }, `${fmtMin(state.hours * 60)} a day`),
      el('span', { class: 'pill' }, `${state.hours * 7}h a week`),
    ),
    el('button', {
      class: 'btn btn-primary btn-block', style: 'margin-top:16px',
      onclick: () => {
        Store.setProfile(state.name, state.exam);
        Store.set((s) => { s.settings.goalMin = state.hours * 60; });
        Router.go('/start');
      },
    }, svg('lock', 18), 'Set my target'),
  ));
}

const slides = [slideName, slideExam, slideHours];

function render() {
  const host = document.getElementById('view');
  host.textContent = '';
  host.append(slides[state.step]());
}

function mount() {
  if (Store.state.flags.onboarded) { Router.go('/home'); return; }
  state.step = 0;
  state.name = Store.state.profile?.name || '';
  state.exam = Store.state.profile?.exam || '';
  state.hours = Math.round((Store.state.settings.goalMin || 120) / 60) || 2;
  render();
}
