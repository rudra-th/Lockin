/* Lockin — Study Mode: the session engine.
   The engine is module-level and survives navigation and reloads. Strict
   Mode is a per-session choice: the phone holds the line, the clock tells the
   truth, and the long-hold end is always there. */

import { Store, uid } from '../store.js';
import { Router } from '../router.js';
import {
  el, fmtClock, fmtWatch, fmtMin, todayKey, clockLabel, FREE_EXIT_SEC, END_HOLD_MS,
  blockSessionMin, spanMin, occurrenceOn, parseKey, sessionEnd,
} from '../util.js';
import { svg } from '../icons.js';
import { closeSheet, hint, goalMeter, updateGoalMeter } from '../ui.js';
import { openShareSheet } from '../share.js';
import {
  isNative, pushBlockingWindows, strictStatus, startStrictMode, stopStrictMode,
  refreshStrict, launchApp,
} from '../native.js';

let timer = null;
let wakeSentinel = null;
let currentSessId = null;
let lastPhase = null;           // last phase painted, for focus-on-change
let lastWasPainted = false;     // has renderHost drawn at least once?

/* Strict kiosk: armed per session, released on every way out. The flags are
   module-level so the dock and the visibility guard agree with native. */
let kioskArmed = false;
let kioskArming = false;
let kioskApps = [];
let kioskOwner = false;

const Session = {
  phase: 'idle',                 // idle | armed | running | paused | break | done | aborted
  cfg: null,                     // {min, taskIds, rounds, mode: 'timer'|'stop'}
  startedAt: 0,
  plannedEnd: 0,
  roundIdx: 1,
  breakKind: null,               // minutes of the current break
  lastDone: null,                // summary for the done screen
  watchStart: 0,                 // stopwatch: wall clock of the very first Start
  savedMs: 0,                    // stopwatch: banked ms across pauses
  pauseCount: 0,
  lastSnapAt: 0,                 // watchdog: written every ~15s so reloads keep the truth
};

/* ---------- persistence (reload-safe) ---------- */

function snapshot() {
  if (!['armed', 'running', 'paused', 'break'].includes(Session.phase)) return;
  Store.set((s) => {
    s.session = {
      phase: Session.phase, cfg: Session.cfg, startedAt: Session.startedAt,
      plannedEnd: Session.plannedEnd, roundIdx: Session.roundIdx, breakKind: Session.breakKind,
      watchStart: Session.watchStart, savedMs: Session.savedMs,
      pauseCount: Session.pauseCount, lastSnapAt: Date.now(),
    };
  });
  Session.lastSnapAt = Date.now();
  /* A running or paused session is a live blocking window; a break is not. */
  pushBlockingWindows();
  /* Keep the kiosk's fail-open deadline ahead of the live session. */
  refreshKioskDeadline();
}

function clearSnapshot() {
  Store.set((s) => { s.session = null; });
  pushBlockingWindows();
}

export function resumeFromSnapshot() {
  const snap = Store.state.session;
  if (!snap) return;
  if (!['armed', 'running', 'paused', 'break'].includes(snap.phase)) return;
  Session.phase = snap.phase;
  Session.cfg = snap.cfg;
  Session.startedAt = snap.startedAt;
  Session.plannedEnd = snap.plannedEnd;
  Session.roundIdx = snap.roundIdx || 1;
  Session.breakKind = snap.breakKind;
  Session.watchStart = snap.watchStart || snap.startedAt;
  Session.savedMs = snap.savedMs || 0;
  Session.pauseCount = snap.pauseCount || 0;
  Session.lastSnapAt = snap.lastSnapAt || Date.now();
  if (snap.phase === 'armed') Session.phase = 'idle'; // an intention doesn't survive a reload
  if (['running', 'break'].includes(Session.phase)) startTick(); // live phases tick again after reload
  if (['running', 'paused', 'break'].includes(Session.phase) && kioskOn()) armKiosk();
}

/* ---------- kiosk (Android opt-in) ---------- */

/* Session strict mode is the Focus toggle; the legacy Control kiosk switch
   still arms it for people who set it up there. */
const kioskOn = () => isNative && (!!Store.state.settings.strictMode || !!Store.state.settings.kiosk);

/** Keep the fail-open deadline at least two minutes ahead of the clock. */
function kioskUntil() {
  const now = Date.now();
  const planned = Number(Session.plannedEnd);
  const base = Number.isFinite(planned) && planned > now ? planned : now;
  return base + 2 * 60_000;
}

function refreshKioskDeadline() {
  if (!kioskArmed) return;
  refreshStrict(kioskUntil());
}

async function armKiosk() {
  if (!kioskOn() || kioskArming || kioskArmed) return;
  kioskArming = true;
  try {
    const st = await strictStatus();
    const packages = st?.packages || [];
    const res = await startStrictMode({ packages, until: kioskUntil() });
    if (!res) return;
    kioskArmed = true;
    kioskOwner = Boolean(res.deviceOwner);
    kioskApps = res.apps?.length
      ? res.apps
      : packages.map((pkg) => ({ package: pkg, label: pkg }));
    if (['running', 'paused', 'break'].includes(Session.phase)) renderHost();
  } finally {
    kioskArming = false;
  }
}

function releaseKiosk() {
  const wasArmed = kioskArmed;
  kioskArmed = false;
  kioskApps = [];
  kioskOwner = false;
  if (wasArmed) stopStrictMode();
}

async function openAllowed(app) {
  const ok = await launchApp(app.package);
  if (!ok) hint(`${app.label} could not open.`);
}

/** The allowlist dock inside a live kiosk session. */
function kioskDock() {
  if (!kioskArmed) return null;
  return el('div', { class: 'kiosk-dock' },
    el('div', { class: 'kiosk-dock-head' },
      el('span', {}, 'Kiosk session'),
      el('b', {}, kioskOwner ? 'Kiosk locked' : 'Screen pinned')),
    kioskApps.length
      ? el('div', { class: 'chips' },
        kioskApps.slice(0, 6).map((app) => el('button', {
          class: 'chip',
          onclick: () => openAllowed(app),
        }, svg('play', 11), app.label)))
      : el('p', { class: 'tiny', style: 'margin:0' },
        'Only Lockin is open right now. End the session below to release the phone.'));
}

/* ---------- session timing ---------- */

function sessionElapsedSec() {
  if (Session.cfg?.mode === 'stop') return stopSeconds();
  const banked = Math.max(0, Session.roundIdx - 1) * (Session.cfg?.min || 0) * 60;
  return banked + Math.max(0, (Date.now() - Session.startedAt) / 1000);
}

/* The first seconds are an accident window, not a decision. */
const freeNow = () => sessionElapsedSec() < FREE_EXIT_SEC;

function onVisibility() {
  /* Background tabs get their timers throttled — redraw the truth the
     instant the page is visible again. Leaving is not an event. */
  if (document.visibilityState === 'visible' && ['running', 'paused', 'break'].includes(Session.phase)) {
    drawClock();
    if (Session.cfg?.mode === 'stop') snapshot();
  }
}

document.addEventListener('visibilitychange', onVisibility);

/* ---------- take-over: wake lock + notifications ----------
   No forced OS fullscreen: the session is already a full-bleed app screen,
   and yanking the browser chrome away is what made the app "disappear".
   The chrome stays put; only the screen is kept awake. */

async function takeOver() {
  if ('wakeLock' in navigator && Store.state.settings.wakelock) {
    try { wakeSentinel = await navigator.wakeLock.request('screen'); } catch (_) { /* the wake lock is a bonus — losing it never interrupts the session */ }
  }
  if (Store.state.settings.notifs && 'Notification' in window && Notification.permission === 'default') {
    try { Notification.requestPermission(); } catch (_) { /* the prompt itself is the ask; a failure stays silent */ }
  }
}

function wakeAlive() {
  if (Session.phase === 'running' && 'wakeLock' in navigator && Store.state.settings.wakelock && !wakeSentinel) {
    navigator.wakeLock.request('screen').then((s) => { wakeSentinel = s; }).catch(() => {});
  }
}

async function releaseAll() {
  try { if (wakeSentinel) await wakeSentinel.release(); } catch (_) { /* an already-released sentinel is fine */ }
  wakeSentinel = null;
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && Session.phase === 'running') wakeAlive();
});

/* ---------- session lifecycle ---------- */

function begin() {
  currentSessId = uid('ss');
  Session.phase = 'running';
  Session.startedAt = Date.now();
  Session.watchStart = Session.startedAt;
  Session.savedMs = 0;
  Session.pauseCount = 0;
  Session.roundIdx = 1;
  if (Session.cfg.mode === 'stop') {
    Session.plannedEnd = Infinity; // the stopwatch has no planned end
  } else {
    Session.plannedEnd = Session.startedAt + Session.cfg.min * 60000;
  }
  snapshot();
  takeOver(); // no-op safety net when armed-hold already latched it
  startTick();
  renderHost();
  armKiosk();
}

/* ---------- stopwatch controls ---------- */

function pauseStop() {
  if (Session.cfg?.mode !== 'stop') return;
  Session.savedMs += Date.now() - Session.startedAt;
  Session.pauseCount += 1;
  Session.phase = 'paused';
  releaseAll();
  snapshot();
  renderHost();
}

function resumeStop() {
  if (Session.cfg?.mode !== 'stop') return;
  Session.startedAt = Date.now(); // elapsed continues from the bank
  Session.phase = 'running';
  snapshot();
  takeOver();
  startTick();
  renderHost();
  if (!kioskArmed) armKiosk();
}

function stopSeconds() {
  return Math.round(elapsedMs() / 1000);
}

function startTick() {
  clearInterval(timer);
  timer = setInterval(tick, 500);
}

function tick() {
  if (Session.phase !== 'running' && Session.phase !== 'break') return;
  if (Session.cfg?.mode === 'stop') {
    // stopwatch: no scheduled end — just keep the truth written every ~15s
    if (Date.now() - Session.lastSnapAt > 15000) snapshot();
  } else if (Date.now() >= Session.plannedEnd) {
    if (Session.phase === 'running') completeRound();
    else finishBreak();
  }
  drawClock();
}

function remaining() {
  return Math.max(0, (Session.plannedEnd - Date.now()) / 1000);
}

/** stopwatch ms banked right now (pauses excluded) */
function elapsedMs() {
  return Session.savedMs + (Session.phase === 'running' ? Date.now() - Session.startedAt : 0);
}

function completeRound() {
  const id = currentSessId;
  Store.set((s) => s.sessions.push({
    id,
    day: todayKey(),
    taskIds: Session.cfg.taskIds || [],
    start: Session.startedAt,
    end: Session.plannedEnd,
    kind: 'focus',
    completed: true,
  }));
  notify(`Round done — ${Session.cfg.min} min banked`);

  const rounds = Session.cfg.rounds;
  if (Session.roundIdx < rounds) {
    Session.roundIdx += 1;
    const long = Session.roundIdx > 1 && Session.roundIdx % 2 === 1; // long after even numbers of focus rounds
    startBreak(long ? Store.state.settings.pomo.long : Store.state.settings.pomo.short);
  } else {
    finish(true);
  }
}

/* An early end is not a punishment: the minutes before it stay banked. */
function recordEarlyEnd(taskIds, start) {
  const id = currentSessId;
  Store.set((s) => s.sessions.push({
    id,
    day: todayKey(),
    taskIds: taskIds || [],
    start,
    end: Date.now(),
    kind: 'focus',
    completed: false,
    aborted: true,
  }));
  return id;
}

function startBreak(min) {
  Session.phase = 'break';
  Session.breakKind = min;
  Session.startedAt = Date.now();
  Session.plannedEnd = Date.now() + min * 60000;
  snapshot();
  startTick();
  renderHost();
}

function finishBreak() {
  if (Session.roundIdx < Session.cfg.rounds) {
    Session.phase = 'running';
    Session.breakKind = null;
    Session.startedAt = Date.now();
    Session.plannedEnd = Session.startedAt + Session.cfg.min * 60000;
    currentSessId = uid('ss');
    snapshot();
    startTick();
    renderHost();
  } else {
    finish(true);
  }
}

function finish(finished, opts = {}) {
  const stopMode = Session.cfg?.mode === 'stop';
  const secs = stopMode ? stopSeconds() : null;
  const outcome = sessionEnd({
    mode: Session.cfg?.mode,
    finished,
    discard: !!opts.discard,
    forfeit: !!opts.forfeit,
    /* A break is not focus. Ending during one must never write the break's
       minutes as a focus record; completed rounds are already banked. */
    breakEnd: !!opts.skipSegment || Session.phase === 'break',
    seconds: secs || 0,
    elapsedMs: Session.startedAt ? Date.now() - Session.startedAt : 0,
    minPerRound: Session.cfg?.min,
    roundIdx: Session.roundIdx,
  });
  releaseKiosk();
  clearInterval(timer);
  timer = null;
  releaseAll();
  /* Stopwatch sessions write their record here — the engine never hits
     completeRound for them. An early end keeps every second, a discard does not. */
  if (outcome.writeRecord) {
    Store.set((s) => s.sessions.push({
      id: currentSessId,
      day: todayKey(),
      taskIds: Session.cfg.taskIds || [],
      start: Session.watchStart,
      end: Date.now(),
      secs: outcome.secs,
      kind: 'focus',
      completed: !!finished,
      aborted: !finished,
    }));
  }
  Session.lastDone = {
    done: !!finished,
    discarded: outcome.discarded,
    forfeited: outcome.forfeited,
    breakEnd: outcome.breakEnd,
    mins: outcome.minutes,
    secs: outcome.secs,
    today: Store.focusMinutesOn(todayKey()),
    goal: Store.goalToday(),
  };
  Session.phase = finished ? 'done' : 'aborted';
  clearSnapshot();
  if (finished) notify('Session done. Minutes banked.');
  renderHost();
}

function abandon() {
  /* The first seconds are an accident window: nothing is written, nothing
     counts. After that, stopping keeps every minute already studied. */
  closeSheet();
  if (freeNow()) {
    finish(false, { discard: true });
    return;
  }
  /* Ending a break is not ending focus; the rounds already banked stay. */
  if (Session.phase === 'break') {
    finish(false, { skipSegment: true });
    return;
  }
  /* Strict mode's cost is the round you leave: completed rounds stay banked,
     the current timed round is forfeited. A stopwatch has no round in progress
     — the run itself is the work — so it keeps every second. */
  if (Session.cfg?.strict && Session.cfg?.mode !== 'stop') {
    finish(false, { forfeit: true });
    return;
  }
  if (Session.cfg?.mode !== 'stop') recordEarlyEnd(Session.cfg.taskIds, Session.startedAt);
  finish(false);
}

function notify(body) {
  if (!body) return;
  if (Store.state.settings.notifs && 'Notification' in window && Notification.permission === 'granted') {
    try { new Notification('Lockin', { body }); } catch (_) { /* notifications never break a session */ }
  }
  try { navigator.vibrate && navigator.vibrate([120, 60, 120]); } catch (_) { /* vibration is best-effort */ }
}

/* ---------- registration ---------- */

export function initFocus(Router) {
  Router.register('/focus', { mount, unmount });
}

/**
 * Start a timed session for a schedule block, using the rest of the
 * occurrence. Called by the alarm's Start action, which is already the
 * user's decision, so it goes straight into the room.
 */
export function startSessionForBlock(schedule, day = todayKey()) {
  if (!schedule) return false;
  if (['running', 'paused', 'break'].includes(Session.phase)) {
    Router.go('/focus');
    return true;
  }
  const occ = occurrenceOn(schedule, parseKey(day));
  const min = occ
    ? blockSessionMin(Date.now(), occ.start.getTime(), occ.end.getTime())
    : Math.max(5, Math.min(180, spanMin(schedule) || 25));
  Store.set((s) => { s.settings.lastMode = 'timer'; s.settings.lastMin = min; });
  Session.cfg = {
    min,
    taskIds: [],
    rounds: 1,
    mode: 'timer',
    label: schedule.name,
    scheduleId: schedule.id,
  };
  begin();
  Router.go('/focus');
  return true;
}

/** Dismiss one occurrence; the next-block hero and the alarm respect it. */
export function skipBlockOccurrence(schedule, day = todayKey()) {
  if (!schedule?.id) return;
  Store.skipBlock(schedule.id, day);
}

function renderHost() {
  const host = document.getElementById('view');
  if (!host || Router.parse().path !== '/focus') return;
  const phaseChanged = Session.phase !== lastPhase;
  lastPhase = Session.phase;
  host.textContent = '';
  document.querySelectorAll('body > .session').forEach((n) => n.remove());
  const live = ['running', 'break', 'paused'].includes(Session.phase);
  document.body.dataset.mode = live ? 'focus' : '';

  let screen;
  if (Session.phase === 'running') screen = runningScreen();
  else if (Session.phase === 'break') screen = breakScreen();
  else if (Session.phase === 'paused') screen = pausedScreen();
  else if (Session.phase === 'armed') screen = armedScreen();
  else if (Session.phase === 'done' || Session.phase === 'aborted') screen = doneScreen();
  else screen = setupScreen();

  /* the live room lives on body: a fixed overlay must never be clipped by
     the scrolling view container, and it stays put while the router clears */
  if (live) document.body.append(screen);
  else host.append(el('div', { class: 'view-anim' }, screen));

  if (live) drawClock();

  /* Starting, pausing or ending a session replaces the button that had focus.
     Move focus to the new screen's heading so keyboard and screen-reader users
     do not land back on <body>. A resumed live room focuses its heading on
     mount; the plain setup screen leaves focus to the router. */
  if (phaseChanged && (lastWasPainted || live)) {
    const heading = screen.querySelector('h1') || screen.querySelector('h2');
    if (heading) {
      if (!heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1');
      heading.focus({ preventScroll: true });
    }
  }
  lastWasPainted = true;
}

/* ---------- setup screen ---------- */

function setupScreen() {
  const q = new URLSearchParams(location.hash.split('?')[1] || '');
  const pomoSettings = Store.state.settings.pomo || { focus: 25, short: 5, long: 15 };
  let min = Math.max(1, Math.min(180,
    Number(q.get('min')) || Number(Store.state.settings.lastMin) || pomoSettings.focus || 25));
  let mode = q.get('mode') === 'stop' || q.get('mode') === 'timer'
    ? q.get('mode')
    : (Store.state.settings.lastMode === 'stop' ? 'stop' : 'timer');
  let pomo = false;
  let strictOn = Boolean(Store.state.settings.strictMode);
  const pickedTasks = new Set();
  const tasksToday = Store.openTasks(todayKey());

  const todayMins = Store.focusMinutesOn(todayKey());
  const goal = Store.goalToday();

  /* ---------- header ---------- */

  const head = el('div', { class: 'app-head study-head' },
    el('div', { class: 'grow' },
      el('h1', {}, 'Focus'),
    ),
  );

  const meta = el('p', { class: 'focus-meta' },
    'Today ', el('b', {}, fmtMin(todayMins)),
    goal ? ` of ${fmtMin(goal)}` : '',
  );

  /* ---------- length hero ---------- */

  const heroNum = el('b', { class: 'focus-hero-num' }, String(min));
  const heroUnit = el('span', { class: 'focus-hero-unit' }, min === 1 ? 'minute' : 'minutes');
  const projection = el('span', { class: 'focus-hero-proj' });
  const stepBtn = (d, label) => el('button', {
    class: 'focus-step', type: 'button', 'aria-label': label,
    onclick: () => selectMin(Math.max(5, Math.min(180, min + d * 5))),
  }, svg(d > 0 ? 'plus' : 'minus', 18));
  const hero = el('div', { class: 'focus-hero' },
    stepBtn(-1, 'Five minutes less'),
    el('div', { class: 'focus-hero-mid' }, heroNum, heroUnit, projection),
    stepBtn(+1, 'Five minutes more'),
  );

  function totalMinutes() {
    let total = pomo ? min * 3 : min;
    if (pomo) total += pomoSettings.short + pomoSettings.long;
    return total;
  }

  function paintProjection() {
    const end = new Date(Date.now() + totalMinutes() * 60000);
    const sameDay = end.toDateString() === new Date().toDateString();
    const clock = clockLabel(end);
    projection.textContent = pomo
      ? `${min}m × 3 · ends ≈ ${clock}${sameDay ? '' : ' tomorrow'}`
      : `ends ≈ ${clock}${sameDay ? '' : ' tomorrow'}`;
  }

  /* Five lengths, one visible choice. The step buttons reach anything else;
     the one primary action is below. */
  const presets = [10, 25, 45, 60, 90];
  const lenBtns = [];
  const lenRow = el('div', { class: 'len-row' }, presets.map((m) => {
    const b = el('button', {
      class: 'len', type: 'button', dataset: { min: String(m) },
      'aria-pressed': 'false', 'aria-label': `${m} minute${m === 1 ? '' : 's'}`,
      onclick: () => { selectMin(m); },
    }, String(m));
    lenBtns.push(b);
    return b;
  }));

  function selectMin(m) {
    min = m;
    heroNum.textContent = String(min);
    heroUnit.textContent = min === 1 ? 'minute' : 'minutes';
    lenBtns.forEach((b) => {
      const on = Number(b.dataset.min) === min;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', String(on));
    });
    paintProjection();
  }

  /* ---------- strict ---------- */

  const strictNote = el('span', {}, isNative
    ? 'Blocks every app except the ones you allow.'
    : 'Android app only.');
  const strictSwitch = el('button', {
    class: 'switch', type: 'button', role: 'switch',
    'aria-checked': String(strictOn),
    'aria-disabled': String(!isNative),
    'aria-label': 'Strict mode',
    onclick: () => {
      if (!isNative) { hint('Strict mode runs in the Android app.'); return; }
      strictOn = !strictOn;
      strictSwitch.setAttribute('aria-checked', String(strictOn));
      strictRow.classList.toggle('is-on', strictOn);
      Store.set((s) => { s.settings.strictMode = strictOn; });
      if (strictOn) hint('Strict: distractions blocked for the session');
    },
  });
  const strictRow = el('div', { class: `strict-row${strictOn ? ' is-on' : ''}` },
    el('span', { class: 'strict-icon' }, svg('lock', 17)),
    el('span', { class: 'strict-txt' },
      el('b', {}, 'Strict mode'),
      strictNote,
    ),
    strictSwitch,
  );

  if (isNative) {
    /* The row states the truth about this phone: hard lock needs device owner. */
    strictStatus().then((st) => {
      if (!st) return;
      if (st.deviceOwner) {
        strictNote.textContent = 'Hard lock · no leaving, no uninstalling.';
      } else {
        strictNote.textContent = 'Blocks apps. Set up hard lock in Phone for no escape.';
      }
      if (strictOn && !st.deviceOwner) strictNote.classList.add('is-warn');
    }).catch(() => {});
  }

  /* ---------- tasks ---------- */

  const taskPanel = tasksToday.length
    ? el('div', { class: 'attach-panel', hidden: true },
        el('div', { class: 'chips' }, tasksToday.map((t) => {
          const chip = el('button', {
            class: 'chip', type: 'button', 'aria-pressed': 'false',
            onclick: () => {
              if (pickedTasks.has(t.id)) { pickedTasks.delete(t.id); chip.setAttribute('aria-pressed', 'false'); }
              else { pickedTasks.add(t.id); chip.setAttribute('aria-pressed', 'true'); }
            },
          }, t.title.length > 30 ? `${t.title.slice(0, 28)}…` : t.title);
          return chip;
        })),
      )
    : null;

  const attachLabel = el('span', {}, tasksToday.length
    ? `${tasksToday.length} task${tasksToday.length === 1 ? '' : 's'} today`
    : 'No tasks today');
  const attach = tasksToday.length
    ? el('button', {
        class: 'attach-row', type: 'button', 'aria-expanded': 'false',
        onclick: () => {
          const open = taskPanel.hidden;
          taskPanel.hidden = !open;
          attach.setAttribute('aria-expanded', String(open));
        },
      },
        attachLabel,
        el('span', { class: 'ar-act' }, 'Attach', el('i', { class: 'ar-caret', innerHTML: svg('caret', 14) })),
      )
    : null;

  /* ---------- mode + start ---------- */

  const modeBtns = [
    ['timer', 'Timer'],
    ['pomo', 'Pomodoro'],
    ['stop', 'Stopwatch'],
  ];
  const modeSeg = el('div', { class: 'mode-seg', role: 'group', 'aria-label': 'Session mode' },
    modeBtns.map(([id, label]) => el('button', {
      class: `mode-seg-btn${(mode === 'stop' ? id === 'stop' : id === (pomo ? 'pomo' : 'timer')) ? ' is-on' : ''}`,
      type: 'button',
      'aria-pressed': String(mode === 'stop' ? id === 'stop' : id === (pomo ? 'pomo' : 'timer')),
      onclick: () => {
        mode = id === 'stop' ? 'stop' : 'timer';
        pomo = id === 'pomo';
        if (pomo) selectMin(pomoSettings.focus || 25);
        paintMode();
        paintProjection();
      },
    }, label)));

  function startText() {
    return mode === 'stop' ? 'Start stopwatch' : `Start ${min} minute${min === 1 ? '' : 's'}`;
  }

  function paintMode() {
    [...modeSeg.children].forEach((b, i) => {
      const id = modeBtns[i][0];
      const on = mode === 'stop' ? id === 'stop' : id === (pomo ? 'pomo' : 'timer');
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', String(on));
    });
    /* A stopwatch has no length to choose; hide the hero instead of lying. */
    const stopped = mode === 'stop';
    hero.hidden = stopped;
    lenRow.hidden = stopped;
    startLabel.textContent = startText();
  }

  const startLabel = el('span', {}, startText());
  const startBtn = el('button', {
    class: 'btn btn-primary btn-block study-start', type: 'button',
    onclick: () => arm(),
  }, svg('lock', 18), startLabel);

  function arm() {
    Store.set((s) => {
      s.settings.lastMode = mode;
      if (mode === 'timer') s.settings.lastMin = min;
    });
    Session.cfg = mode === 'stop'
      ? { min: 0, taskIds: [...pickedTasks], rounds: 1, mode: 'stop', strict: strictOn }
      : { min, taskIds: [...pickedTasks], rounds: pomo ? 3 : 1, mode: 'timer', strict: strictOn };
    Session.phase = 'armed';
    renderHost();
  }

  selectMin(min);
  paintMode();
  paintProjection();

  return el('section', { class: 'study' },
    head,
    meta,
    modeSeg,
    hero,
    lenRow,
    ...(isNative ? [strictRow] : []),
    attach,
    taskPanel,
    el('div', { class: 'study-foot' }, startBtn),
  );
}

/* ---------- armed (intention) screen ---------- */

function armedScreen() {
  const btn = el('button', {
    class: 'holdbtn primary',
    'aria-label': 'Hold to start the session',
    onpointerdown: holdStart,
    onkeydown: (ev) => {
      if (ev.key !== ' ' && ev.key !== 'Enter') return;
      if (ev.repeat) return;
      ev.preventDefault();
      holdStart(ev);
    },
  },
    el('div', { class: 'fill' }), svg('lock'));

  const note = el('div', { class: 'muted' }, 'Hold until the ring closes');

  let raf = 0;
  let t0 = 0;
  const HOLD_MS = 1500;
  function progress(p) {
    btn.querySelector('.fill').style.setProperty('--p', `${Math.min(1, p) * 100}%`);
    btn.classList.toggle('holding', p > 0.02);
  }

  function holdStart(ev) {
    ev.preventDefault();
    takeOver(); // latch wake lock + notification permission while the gesture is live
    t0 = performance.now();
    const step = (now) => {
      const p = (now - t0) / HOLD_MS;
      progress(p);
      if (p >= 1) { begin(); return; }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);

    if (ev.pointerId != null) {
      try { btn.setPointerCapture(ev.pointerId); } catch (_) { /* the pointer may already be gone */ }
      btn.addEventListener('pointerup', holdCancel);
      btn.addEventListener('pointercancel', holdCancel);
    } else {
      /* Keyboard: the same hold, on Space or Enter. */
      btn.addEventListener('keyup', holdCancel, { once: true });
      btn.addEventListener('blur', holdCancel, { once: true });
    }
  }

  function holdCancel() {
    cancelAnimationFrame(raf);
    progress(0);
    btn.removeEventListener('pointerup', holdCancel);
    btn.removeEventListener('pointercancel', holdCancel);
  }

  const strictRules = Session.cfg.strict
    ? el('div', { class: 'strict-rules' },
        el('b', {}, 'Strict rules'),
        el('ul', {},
          el('li', {}, 'Other apps stay blocked until the session ends.'),
          Session.cfg.mode === 'stop'
            ? el('li', {}, 'The end hold is longer. Every second you ran is still banked.')
            : el('li', {}, 'The end hold is longer, and ending forfeits the round in progress.'),
          el('li', {}, 'The first twenty seconds are an accident window. After that, leaving is a decision.'),
        ),
      )
    : null;

  return el('div', { class: 'card armed-card' },
    el('h2', {}, 'One breath before you go in'),
    el('div', { class: 'armed-what' },
      Session.cfg.mode === 'stop' ? 'Stopwatch' : `${Session.cfg.min} min`),
    Session.cfg.label
      ? el('div', { class: 'armed-label' }, Session.cfg.label)
      : null,
    Session.cfg.taskIds.length
      ? el('div', { class: 'muted', style: 'margin-top:6px' },
          `${Session.cfg.taskIds.length} task${Session.cfg.taskIds.length === 1 ? '' : 's'} attached`)
      : null,
    strictRules,
    el('p', { class: 'tiny armed-copy' },
      'As you hold, Lockin wakes the screen and opens the room. When the ring closes, you are in.'),
    el('div', { class: 'holdwrap armed-hold' }, btn, note),
    el('button', {
      class: 'btn btn-ghost', style: 'margin-top:10px',
      onclick: () => { Session.phase = 'idle'; renderHost(); },
    }, 'Not yet'),
  );
}

/* ---------- running screen ---------- */

/* focused minutes today, including the live session — the honest denominator */
function dailyTarget() {
  const banked = Store.focusMinutesOn(todayKey());
  let live = 0;
  if (Session.phase === 'running') {
    live = Session.cfg?.mode === 'stop'
      ? elapsedMs() / 60000
      : (Date.now() - Session.startedAt) / 60000;
  } else if (Session.phase === 'paused' && Session.cfg?.mode === 'stop') {
    live = elapsedMs() / 60000;
  }
  live = Math.max(0, live);
  return { banked, live, total: banked + live, goal: Store.goalToday() };
}

/* the session keeps the app's identity and today's target on screen */
function sessionChrome(kind, tone = '') {
  return el('header', { class: 'sess-chrome' },
    el('div', { class: 'sess-bar' },
      el('div', { class: 'sess-brand' }, el('i', { class: 'brand-dot' }), 'Lockin'),
      el('span', { class: `sess-kind${tone ? ` ${tone}` : ''}` }, kind)
    ),
    goalMeter({ label: 'Daily target' })
  );
}

function pipsRow() {
  const rounds = Session.cfg?.rounds || 1;
  if (rounds < 2 || Session.cfg?.mode === 'stop') return null;
  const pips = el('div', { class: 'pips' });
  for (let i = 1; i <= rounds; i += 1) {
    pips.append(el('i', { class: `pip ${i < Session.roundIdx ? 'done' : i === Session.roundIdx ? 'cur' : ''}` }));
  }
  return pips;
}

function taskChips() {
  return (Session.cfg?.taskIds || [])
    .map((id) => Store.state.tasks.find((t) => t.id === id))
    .filter(Boolean)
    .map((t) => el('button', {
      class: `sess-task${t.doneAt ? ' is-done' : ''}`,
      'aria-pressed': String(!!t.doneAt),
      onclick: () => {
        Store.set((s) => { const x = s.tasks.find((y) => y.id === t.id); x.doneAt = x.doneAt ? null : Date.now(); });
        rerenderRunningChips();
      },
    },
      el('i', { class: 'sess-task-check', 'aria-hidden': 'true', innerHTML: t.doneAt ? svg('check', 11) : '' }),
      el('span', { class: 'sess-task-title' },
        t.title.length > 26 ? `${t.title.slice(0, 24)}…` : t.title)));
}

function sessionCore({ label, note, clockClass = '', breathe = false, tasks = true, pips = true }) {
  const chips = tasks ? taskChips() : [];
  return el('main', { class: 'sess-core' },
    /* The phase label is the screen's heading: renderHost moves focus here on
       a phase change, so a screen reader hears the new state once. The clock
       is role=timer so assistive tech decides when to read it instead of
       narrating every second. */
    el('h1', { class: 'sess-phase', tabindex: '-1' }, label),
    el('div', { class: `clock-wrap${breathe ? ' is-breathe' : ''}` },
      breathe ? null : el('svg', { class: 'clock-ring', viewBox: '0 0 240 240', 'aria-hidden': 'true' },
        el('circle', { class: 'ring-track', cx: 120, cy: 120, r: 108 }),
        el('circle', { class: 'ring-fill', cx: 120, cy: 120, r: 108 }),
      ),
      el('div', { class: `clock${clockClass ? ` ${clockClass}` : ''}`, role: 'timer' }, '—'),
    ),
    pips ? pipsRow() : null,
    note ? el('p', { class: 'sess-note' }, note) : null,
    chips.length ? el('div', { class: 'chips sess-tasks' }, chips) : null
  );
}

function quitButton() {
  const strict = Boolean(Session.cfg?.strict);
  const forfeits = strict && Session.cfg?.mode !== 'stop';
  const b = el('button', {
    class: 'btn btn-subtle btn-block btn-quit',
    'aria-label': forfeits
      ? 'End session — hold longer to confirm; the round in progress is forfeited'
      : 'End session — hold to confirm',
    onpointerdown: startQuitHold,
    onkeydown: (ev) => {
      if (ev.key !== ' ' && ev.key !== 'Enter') return;
      if (ev.repeat) return;
      ev.preventDefault();
      startQuitHold(ev);
    },
  }, svg('check', 15), el('span', {}, forfeits ? 'End — hold longer' : 'End — hold'));
  return b;
}

/* The first seconds of a chip-start are the accident window made visible:
   an Undo pill that discards the session cleanly — the same free stop the
   quit button offers, one tap closer to the mis-tap. */
function armUndoPill() {
  if (document.querySelector('.undo-toast')) return;
  const pill = el('div', { class: 'alarm-toast undo-toast', role: 'status' },
    el('div', { class: 'alarm-toast-txt' },
      el('b', {}, 'Started by accident?'),
      el('span', {}, 'Undo leaves nothing — no minutes, no session.')),
    el('button', {
      class: 'btn btn-subtle btn-sm',
      onclick: () => { pill.remove(); abandon(); },
    }, 'Undo'),
  );
  document.body.append(pill);
  requestAnimationFrame(() => pill.classList.add('show'));
  setTimeout(() => {
    if (!document.contains(pill)) return;
    pill.classList.remove('show');
    setTimeout(() => pill.remove(), 240);
  }, 8000);
}

function runningScreen() {
  if (Session.cfg.mode === 'stop') return stopRunningScreen();
  const rounds = Session.cfg.rounds || 1;
  const label = rounds > 1 ? `Focus · round ${Session.roundIdx} of ${rounds}` : 'Focus';
  const endsAt = clockLabel(Session.plannedEnd);
  if (Date.now() - Session.startedAt < 8000) armUndoPill();
  const note = Session.cfg.label
    ? `${Session.cfg.label} · ends at ${endsAt}`
    : `Ends at ${endsAt} · the minutes stay yours whenever you stop`;
  return el('div', { class: 'session' },
    sessionChrome(Session.cfg.label ? 'Block' : 'Focus'),
    sessionCore({
      label,
      note: Session.cfg.strict ? `${note} · strict: ending forfeits this round` : note,
    }),
    kioskDock(),
    el('footer', { class: 'sess-foot' }, quitButton())
  );
}

/* ---------- stopwatch screens ---------- */

function stopRunningScreen() {
  const strict = Boolean(Session.cfg?.strict);
  return el('div', { class: 'session' },
    sessionChrome('Focus', 'live'),
    sessionCore({
      label: 'Stopwatch',
      note: strict
        ? 'Strict: apps stay blocked until you end it, and there is no pause. Every second still counts.'
        : 'Every second in here is banked. Pause is honest rest — it stops the count.',
      clockClass: 'stopwatch',
      breathe: true,
    }),
    kioskDock(),
    el('footer', { class: 'sess-foot' },
      strict
        ? el('div', { class: 'sess-foot-split' }, quitButton())
        : el('div', { class: 'sess-foot-split' },
            el('button', { class: 'btn btn-primary', onclick: pauseStop }, svg('pause', 15), 'Pause'),
            quitButton()
          )
    )
  );
}

function pausedScreen() {
  return el('div', { class: 'session is-paused' },
    sessionChrome('Paused'),
    sessionCore({
      label: 'Paused',
      note: `Paused on the second. ${Session.pauseCount} pause${Session.pauseCount === 1 ? '' : 's'} so far.`,
      clockClass: 'stopwatch is-muted',
      breathe: true,
    }),
    kioskDock(),
    el('footer', { class: 'sess-foot sess-foot-split' },
      el('button', { class: 'btn btn-primary', onclick: resumeStop }, svg('play', 15), 'Resume'),
      el('button', { class: 'btn btn-subtle', onclick: () => finish(true) }, svg('check', 15), 'Finish')
    )
  );
}

function rerenderRunningChips() {
  if (Session.phase === 'running') renderHost();
}

function startQuitHold(ev) {
  ev.preventDefault();
  const btn = ev.currentTarget;
  if (btn.dataset.holding === '1') return;
  btn.dataset.holding = '1';
  const t0 = performance.now();
  const HOLD_MS = Session.cfg?.strict ? END_HOLD_MS * 2 : END_HOLD_MS;
  let raf = 0;

  /* One listener set per hold. A previous incomplete hold would otherwise
     leave its keyup/blur handlers latched onto the same button forever. */
  if (btn._cancelHold) btn._cancelHold();

  const cancel = () => {
    cancelAnimationFrame(raf);
    btn.style.filter = '';
    delete btn.dataset.holding;
    btn.removeEventListener('pointerup', cancel);
    btn.removeEventListener('pointercancel', cancel);
    btn.removeEventListener('keyup', cancel);
    btn.removeEventListener('blur', cancel);
    if (btn._cancelHold === cancel) btn._cancelHold = null;
  };
  btn._cancelHold = cancel;

  const step = (now) => {
    if (!document.contains(btn)) { cancel(); return; }
    const p = (now - t0) / HOLD_MS;
    btn.style.filter = `brightness(${1 + p * 0.35}) saturate(${1 + p * 0.8})`;
    if (p >= 1) { cancel(); abandon(); return; }
    raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);

  /* Pointer, keyboard and focus loss all cancel the same hold. */
  btn.addEventListener('pointerup', cancel);
  btn.addEventListener('pointercancel', cancel);
  btn.addEventListener('keyup', cancel);
  btn.addEventListener('blur', cancel);
}

/* ---------- break screen ---------- */

function breakScreen() {
  return el('div', { class: 'session is-break' },
    sessionChrome('Break', 'good'),
    sessionCore({
      label: Session.breakKind >= 10 ? 'Long break' : 'Short break',
      note: 'Water, stretch, window. Then back to focus. 🌿',
      clockClass: 'is-good',
      breathe: true,
      tasks: false,
      pips: false,
    }),
    kioskDock(),
    el('footer', { class: 'sess-foot sess-foot-split' },
      el('button', { class: 'btn btn-primary', onclick: () => { Session.plannedEnd = Date.now(); finishBreak(); } }, 'Back to focus'),
      el('button', { class: 'btn btn-ghost', onclick: () => finish(true) }, 'End here')
    )
  );
}

/* ---------- done screen ---------- */

/* A clean finish earns a little paper. Twenty-eight pieces, gone in under a
   second — the global reduced-motion rule turns it into nothing. */
function confettiBurst() {
  const colors = ['var(--acc)', 'var(--good)', 'var(--tx-2)'];
  const pieces = [];
  for (let i = 0; i < 28; i += 1) {
    const angle = (Math.PI * 2 * i) / 28 + Math.random() * 0.18;
    const dist = 55 + Math.random() * 100;
    pieces.push(el('i', {
      class: 'confetti',
      style: `--dx:${(Math.cos(angle) * dist).toFixed(1)}px;`
        + `--dy:${(Math.sin(angle) * dist).toFixed(1)}px;`
        + `--rot:${Math.round(Math.random() * 480 - 240)}deg;`
        + `--delay:${Math.round(Math.random() * 140)}ms;`
        + `--c:${colors[i % colors.length]}`,
    }));
  }
  return el('div', { class: 'confetti-field', 'aria-hidden': 'true' }, pieces);
}

function doneScreen() {
  const d = Session.lastDone || { done: false, mins: 0 };
  const bankedText = d.secs != null ? fmtWatch(d.secs) : fmtMin(d.mins);
  const meter = goalMeter({ label: 'Daily target' });
  updateGoalMeter(meter, dailyTarget());
  const good = !!d.done;
  const today = d.today ?? Store.focusMinutesOn(todayKey());
  const goal = d.goal ?? Store.goalToday();
  const canShare = goal > 0 && today >= goal;
  let line;
  if (d.breakEnd) line = 'Break ended. Every round you finished stays banked.';
  else if (d.forfeited) line = 'Current segment forfeited. Rounds you finished stay banked.';
  else if (d.discarded) line = 'Nothing banked. The clock reset clean.';
  else if (good) line = 'Minutes banked. The day got what you gave it.';
  else line = 'Stopped early — the minutes stay yours.';
  const heading = d.breakEnd
    ? 'Break ended'
    : good
      ? 'Session banked'
      : d.discarded
        ? 'Session discarded'
        : 'Session ended';
  return el('div', { class: 'done-wrap' },
    el('div', { class: 'done-card view-anim' },
      good ? confettiBurst() : null,
      el('h1', { class: `done-kicker ${good ? 'is-good' : 'is-warn'}`, tabindex: '-1' },
        heading,
        good ? ' 🎉' : ''),
      el('div', { class: `done-amount${good ? '' : ' is-warn'}` },
        d.discarded ? '—' : `+${bankedText}`),
      el('div', { class: 'done-today' }, `${fmtMin(today)} focused today`),
      el('p', { class: 'done-line' }, line),
      meter,
      el('div', { class: 'done-actions' },
        el('button', {
          class: 'btn btn-primary',
          onclick: () => { Session.phase = 'idle'; renderHost(); },
        }, 'Again'),
        el('button', { class: 'btn btn-subtle', onclick: () => { Session.phase = 'idle'; Router.go('/home'); } }, 'Home')
      ),
      canShare ? el('button', {
        class: 'btn btn-subtle btn-block', style: 'margin-top:10px',
        onclick: () => openShareSheet({ mins: today, goal }),
      }, svg('share', 15), 'Share today') : null,
      el('button', {
        class: 'done-more',
        onclick: () => { Session.phase = 'idle'; Router.go('/progress'); },
      }, 'See the week', svg('chevR', 14)),
    )
  );
}

/* ---------- clock ---------- */

const RING_CIRC = 2 * Math.PI * 108; // r=108 in the 240×240 viewBox

function drawClock() {
  const wrap = document.querySelector('.session .clock-wrap');
  const node = wrap?.querySelector('.clock') || document.querySelector('.session .clock');
  if (node) {
    if (Session.cfg?.mode === 'stop') {
      node.textContent = fmtWatch(stopSeconds());
    } else {
      node.textContent = fmtClock(remaining());
      if (Session.phase === 'running') node.classList.toggle('tensec', remaining() < 10);
    }
  }
  const fill = wrap?.querySelector('.ring-fill');
  if (fill && Session.cfg?.mode !== 'stop' && Session.phase === 'running') {
    /* Wall-clock truth: a reload mid-session draws the ring where it belongs. */
    const total = Math.max(1, (Session.cfg?.min || 0) * 60000);
    const elapsed = Math.max(0, Math.min(total, Date.now() - Session.startedAt));
    fill.style.strokeDashoffset = String(RING_CIRC * (elapsed / total));
    wrap.classList.toggle('is-tense', remaining() < 60);
  }
  const meter = document.querySelector('.session .goal-meter');
  if (meter) updateGoalMeter(meter, dailyTarget());
}

/* ---------- mounting ---------- */

/**
 * A second tab may own a live newer session (store.js adopts its writes).
 * This tab only adopts the engine when IT isn't the driver — one engine
 * per store, the fresher module view wins the screen.
 */
function adoptForeignSession() {
  if (['running', 'break', 'paused'].includes(Session.phase)) return; // driver already
  const snap = Store.state.session;
  if (!snap || !['running', 'break', 'paused'].includes(snap.phase)) return;
  Session.phase = snap.phase;
  Session.cfg = snap.cfg;
  Session.startedAt = snap.startedAt;
  Session.plannedEnd = snap.plannedEnd;
  Session.roundIdx = snap.roundIdx || 1;
  Session.breakKind = snap.breakKind;
  Session.watchStart = snap.watchStart || snap.startedAt;
  Session.savedMs = snap.savedMs || 0;
  Session.pauseCount = snap.pauseCount || 0;
  Session.lastSnapAt = snap.lastSnapAt || Date.now();
  if (Session.phase === 'running') startTick();
}

function mount() {
  resumeFromSnapshot();
  adoptForeignSession();
  renderHost();
}

function unmount() {
  document.body.dataset.mode = '';
  document.querySelectorAll('body > .session').forEach((n) => n.remove());
  document.getElementById('leftveil')?.remove();
}
