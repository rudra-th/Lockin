/* Lockin — the beginner walkthrough: first-run onboarding with a safe demo.
   Seeds a believable day, explains the honest limits, runs a 2-minute demo
   session, and hands off to Home. Rerunnable from Settings. */

import { Store, uid } from '../store.js';
import { Router } from '../router.js';
import { el } from '../util.js';
import { svg } from '../icons.js';
import { startDemoSession } from './focus.js';

export function initWalkthrough(Router) {
  Router.register('/start', { mount, unmount });
}

let step = 0;
const LAST = 4;

function seedDay() {
  const t = todayKey();
  const tmr = addDays(t, 1);
  const acts = ['Physics', 'Chemistry', 'Maths'].map((name, i) => ({
    id: uid('act'), name, kind: 'study', hue: [200, 265, 25][i],
  }));
  Store.set((s) => {
    s.activities.push(...acts);
    s.plans[t] = [
      { id: uid('blk'), actId: acts[0].id, s: 16, e: 20 },  // 08:00–10:00 Physics
      { id: uid('blk'), actId: 'rest',  s: 20, e: 21 },
      { id: uid('blk'), actId: acts[1].id, s: 21, e: 25 },  // 10:30–12:30 Chemistry
      { id: uid('blk'), actId: 'meal',  s: 25, e: 27 },
      { id: uid('blk'), actId: acts[2].id, s: 27, e: 33 },  // 13:30–16:30 Maths
      { id: uid('blk'), actId: 'free',  s: 33, e: 44 },
    ];
    s.plans[tmr] = [
      { id: uid('blk'), actId: acts[0].id, s: 16, e: 20 },
      { id: uid('blk'), actId: acts[1].id, s: 21, e: 25 },
    ];
    s.tasks.push(
      {
        id: uid('tk'), date: t, title: 'Solve 20 mechanics problems',
        stages: [{ label: 'Kinematics sheet', done: false }, { label: 'Newton laws — 8 problems', done: false }],
        subjectId: null, doneAt: null,
      },
      { id: uid('tk'), date: t, title: 'Revise organic reaction map', stages: [], subjectId: null, doneAt: null },
    );
    s.flags.seeded = true;
  });
}

/* ---------- tiny view helpers ---------- */

function bullets(items) {
  return el('ul', { style: 'text-align:left;margin:14px 0 0;padding-left:18px' },
    items.map((t) => el('li', { class: 'muted', style: 'font-size:14px;margin-bottom:8px' }, t)));
}

function footer(label) {
  return el('div', { class: 'actions' },
    el('button', { class: 'btn btn-primary btn-block', onclick: () => goStep(step + 1) }, label),
    el('button', { class: 'btn btn-ghost', onclick: finish }, 'Skip'),
  );
}

/* ---------- slides ---------- */

function slide0() {
  return el('div', {},
    el('h2', {}, 'This is Lockin'),
    el('p', {}, 'A day planner with a study clock that refuses to be casual about it. You plan the day once — Lockin runs it with you, block by block, and keeps the screen awake while you work.'),
    bullets([
      'Paint your day on a 24-hour grid',
      'Run wake-locked focus sessions a phone can’t casually interrupt',
      'Grow a streak of genuinely clean days',
    ]),
    footer('Next'),
  );
}

function slide1() {
  return el('div', {},
    el('h2', {}, 'What it can — and cannot'),
    el('p', {}, 'Lockin is a web app, so it cannot block other apps on your phone — nothing on the web can. Its deal is different: staying here becomes the easy path, and everything else gets remembered.'),
    bullets([
      'Study Mode takes over the whole screen — clock, task, sound',
      'Leaving mid-focus (over 10 seconds) is logged as a slip, honestly, forever',
      'Accidents under 10 seconds are forgiven — no punishment for mistakes',
      'Strict Mode is a toggle in Settings, not a trap',
    ]),
    footer('Fair enough — next'),
  );
}

function slide2() {
  const chips = el('div', { class: 'chips', style: 'justify-content:center;margin-top:14px' },
    Store.subjects().slice(0, 4).map((a) =>
      el('span', { class: 'chip', style: `--h:${a.hue}` }, el('i', { class: 'dot' }), a.name)));
  return el('div', {},
    el('h2', {}, 'Your week, seeded'),
    el('p', {}, 'We dropped a sample school day into the Plan tab — three subjects, meals, rest — plus a couple of tasks. It is yours to repaint; nothing here is precious.'),
    chips,
    el('p', { class: 'tiny', style: 'margin-top:12px' }, 'Rename, recolor, or discard any of it on the Plan tab.'),
    footer('What’s next'),
  );
}

function slide3() {
  return el('div', {},
    el('h2', {}, 'Try a 2-minute session'),
    el('p', {}, 'A real session at tiny size, with safe rules: hold the ring to start, the screen stays awake, and the demo never logs a slip — wander off if you want.'),
    el('div', { class: 'chips', style: 'justify-content:center;margin:16px 0' },
      el('span', { class: 'pill acc' }, '2 minutes · demo'),
      (() => {
        const a = Store.activity(Store.subjects()[0]?.id);
        return el('span', { class: 'chip', style: `--h:${a ? a.hue : 90}` },
          el('i', { class: 'dot' }), a ? a.name : 'Study');
      })()),
    el('button', {
      class: 'btn btn-primary btn-block',
      onclick: () => startDemoSession(Store.subjects()[0]?.id),
    }, svg('lock', 18), 'Start the demo'),
    el('button', { class: 'btn btn-ghost btn-block', onclick: () => goStep(step + 1), style: 'margin-top:8px' }, 'Skip the demo'),
  );
}

function slide4() {
  return el('div', {},
    el('h2', {}, 'The whole pitch'),
    el('p', {}, 'Plan on the Plan tab. Start sessions from Home — or straight from the current block. Stats keeps the honest score, slips included. Install Lockin from your browser menu so it opens like an app, offline.'),
    el('p', { class: 'tiny' }, 'You can rerun this walkthrough from Settings any time.'),
    footer('Enter Lockin'),
  );
}

const slides = [slide0, slide1, slide2, slide3, slide4];

/* ---------- navigation ---------- */

function goStep(n) {
  if (n > LAST) { finish(); return; }
  step = Math.max(0, n);
  render();
}

function finish() {
  Store.set((s) => { s.flags.onboarded = true; });
  document.body.dataset.mode = '';
  Router.go('/home');
  hint('Locked in. Paint the day, then run it.');
}

/* ---------- render ---------- */

function render() {
  document.body.dataset.mode = 'onboard';
  const host = document.getElementById('view');
  host.textContent = '';
  const dots = el('div', { class: 'dots' }, slides.map((_, i) => el('i', { class: i === step ? 'on' : '' })));
  host.append(el('section', { class: 'view-anim', style: 'margin:8vh auto 0;max-width:460px;padding:0 16px' },
    el('div', { class: 'card wt-card' },
      slides[step](),
      dots,
    )));
}

/* ---------- mounting ---------- */

function mount(host, params) {
  if (Store.state.flags.onboarded && params.replay !== '1') {
    Router.go('/home');
    return;
  }
  if (!Store.state.flags.seeded) seedDay();
  step = 0;
  render();
}

function unmount() {
  document.body.dataset.mode = '';
}
