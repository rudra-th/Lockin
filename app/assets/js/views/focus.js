/* Lockin — Study Mode: the session engine + strict enforcement.
   The engine is module-level and survives navigation and reloads. */

import { Store, uid } from '../store.js';
import { Router } from '../router.js';
import { el, fmtClock, fmtWatch, fmtMin, todayKey, decideAway, earnedExit, FREE_EXIT_SEC } from '../util.js';
import { svg } from '../icons.js';
import { openSheet, closeSheet, hint, goalMeter, updateGoalMeter } from '../ui.js';

export const GRACE_SEC = 10;    // accident window — an away this short is forgiven
export const RESCUE_CAP = 3;    // free rescues per day; beyond that it is a slip

let timer = null;
let wakeSentinel = null;
let currentSessId = null;

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
}

function clearSnapshot() {
  Store.set((s) => { s.session = null; });
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
}

/* ---------- strict enforcement ---------- */

const strictOn = () => !!Store.state.settings.strict;

/* ---------- earned exit ----------
   Real work buys the right to stop. At `exitGraceMin` the quit control stops
   being a punishment: no slip, no broken day. 0 turns the rule off. */

const exitGraceMin = () => Number(Store.state.settings.exitGraceMin) || 0;
const graceOn = () => exitGraceMin() > 0;

function sessionElapsedSec() {
  if (Session.cfg?.mode === 'stop') return stopSeconds();
  const banked = Math.max(0, Session.roundIdx - 1) * (Session.cfg?.min || 0) * 60;
  return banked + Math.max(0, (Date.now() - Session.startedAt) / 1000);
}

const earnedNow = () => earnedExit(sessionElapsedSec(), exitGraceMin());

/* The first seconds are an accident window, not a decision. */
const freeNow = () => sessionElapsedSec() < FREE_EXIT_SEC;

function exitHintText() {
  if (freeNow()) return `Free to stop — under ${FREE_EXIT_SEC}s`;
  if (!graceOn()) return '';
  if (earnedNow()) return 'Earned exit — stopping now breaks nothing';
  const left = Math.max(1, Math.ceil((exitGraceMin() * 60 - sessionElapsedSec()) / 60));
  return `Earned exit in ${left}m`;
}

function exitHint() {
  /* With Strict off nothing is enforced, so there is nothing to earn. */
  if (!strictOn()) return null;
  if (!graceOn() && !freeNow()) return null;
  const cls = `sess-exit${freeNow() ? ' is-free' : ''}${earnedNow() ? ' is-earned' : ''}`;
  return el('div', { class: cls }, exitHintText());
}

function updateExitUi() {
  const note = document.querySelector('.sess-exit');
  if (note) {
    note.textContent = exitHintText();
    note.classList.toggle('is-free', freeNow());
    note.classList.toggle('is-earned', earnedNow());
  }
  const btn = document.querySelector('.btn-quit');
  if (btn) paintQuit(btn);
}

function onVisibility() {
  if (document.visibilityState === 'hidden') {
    if (Session.phase === 'running' && strictOn()) {
      Store.set((s) => { if (s.session) s.session.goneAt = Date.now(); });
    }
  } else {
    /* background tabs get their timers throttled — redraw the truth the
       instant the page is visible again (elapsed comes from the wall clock) */
    if (['running', 'paused', 'break'].includes(Session.phase)) {
      drawClock();
      if (Session.cfg?.mode === 'stop') snapshot();
    }
    if (Session.phase === 'running' && strictOn()) processBack();
  }
}

function processBack() {
  const goneAt = Store.state.session?.goneAt || 0;
  Store.set((s) => { if (s.session) s.session.goneAt = null; });
  if (!goneAt) return;
  const awaySec = (Date.now() - goneAt) / 1000;
  const usedRescues = Store.slipCountsOn(todayKey()).rescue;
  const verdict = decideAway({ awaySec, usedRescues, graceSec: GRACE_SEC, cap: RESCUE_CAP });
  if (verdict === 'rescue') {
    Store.logSlip('rescue', currentSessId, awaySec);
    hint(`Accident forgiven — away ${awaySec.toFixed(0)}s (${Math.min(usedRescues + 1, RESCUE_CAP)}/${RESCUE_CAP}).`);
  } else {
    Store.logSlip('slip', currentSessId, awaySec);
    showLeftVeil(awaySec);
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
  updateExitUi();
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

function recordAborted(taskIds, start) {
  if (Session.cfg?.mode === 'stop') return null; // stopwatch writes its record in finish()
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

/* An earned end is not an abort: the minutes count, the day can stay clean. */
function recordEarned(taskIds, start) {
  const id = currentSessId;
  Store.set((s) => s.sessions.push({
    id,
    day: todayKey(),
    taskIds: taskIds || [],
    start,
    end: Date.now(),
    kind: 'focus',
    completed: false,
    earned: true,
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
  const earned = !!opts.earned;
  const discard = !!opts.discard;
  clearInterval(timer);
  timer = null;
  releaseAll();
  const stopMode = Session.cfg?.mode === 'stop';
  const secs = stopMode ? stopSeconds() : null;
  /* stopwatch sessions write their record here — engine never hits completeRound
     (timer rounds record there); earned ends count, discards do not */
  if (stopMode && !discard) {
    Store.set((s) => s.sessions.push({
      id: currentSessId,
      day: todayKey(),
      taskIds: Session.cfg.taskIds || [],
      start: Session.watchStart,
      end: Date.now(),
      secs,
      kind: 'focus',
      completed: !!(finished || earned),
      aborted: !finished && !earned,
      ...(earned ? { earned: true } : {}),
    }));
  }
  const minsStudied = discard
    ? 0
    : finished
      ? (stopMode ? Math.round(secs / 60) : Session.cfg.min * Math.max(1, Session.roundIdx))
      : (stopMode ? Math.round(secs / 60) : Math.max(0, Math.round((Date.now() - Session.startedAt) / 60000)));
  Session.lastDone = {
    done: !!finished,
    earned,
    discarded: discard,
    mins: minsStudied,
    secs, // stopwatch precision for the done screen
    today: Store.focusMinutesOn(todayKey()),
  };
  Session.phase = (finished || earned) ? 'done' : 'aborted';
  clearSnapshot();
  if (finished) notify('Session done. Clean slate kept.');
  else if (earned) notify('Session banked. Nothing broken.');
  renderHost();
}

function abandon() {
  /* The first seconds are an accident window: nothing is written, nothing breaks. */
  if (freeNow()) {
    closeSheet();
    finish(false, { discard: true });
    return;
  }
  /* Earned exit: enough real work means stopping is a decision, not a slip. */
  if (earnedNow()) {
    if (Session.cfg?.mode === 'stop') {
      finish(true, { earned: true });
    } else {
      recordEarned(Session.cfg.taskIds, Session.startedAt);
      finish(false, { earned: true });
    }
    closeSheet();
    return;
  }
  recordAborted(Session.cfg.taskIds, Session.startedAt);
  if (strictOn()) Store.logSlip('abandon', currentSessId, 0);
  closeSheet();
  finish(false);
}

/* Aborting keeps the minutes studied before the abort (real work) but the
   day stops being clean — the slip goes into the honesty log either way. */

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

function renderHost() {
  const host = document.getElementById('view');
  if (!host || Router.parse().path !== '/focus') return;
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
}

/* ---------- setup screen ---------- */

function setupScreen() {
  const q = new URLSearchParams(location.hash.split('?')[1] || '');
  const pomoSettings = Store.state.settings.pomo || { focus: 25, short: 5, long: 15 };
  let min = Math.max(1, Math.min(180,
    Number(q.get('min')) || Number(Store.state.settings.lastMin) || pomoSettings.focus || 25));
  let rounds = 1;
  let pomo = false;
  let mode = q.get('mode') === 'stop' ? 'stop' : (Store.state.settings.lastMode === 'stop' ? 'stop' : 'timer');
  const pickedTasks = new Set();
  const tasksToday = Store.openTasks(todayKey());

  /* today counter — how many real sessions already banked today */
  const doneToday = Store.state.sessions.filter((x) =>
    x.day === todayKey() && x.kind === 'focus').length;
  const todayMins = Store.focusMinutesOn(todayKey());
  const goal = Store.state.settings.goalMin || 120;
  const pct = Math.min(100, Math.round((todayMins / Math.max(1, goal)) * 100));

  /* one quiet line, not another card */
  const goalLine = el('div', {
    class: `study-goal${pct >= 100 ? ' is-met' : ''}`,
    role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(pct),
    'aria-label': `Daily target: ${fmtMin(todayMins)} of ${fmtMin(goal)}`,
  },
    el('span', { class: 'sg-label' }, 'Today'),
    el('div', { class: 'sg-track' }, el('i', { style: `width:${pct}%` })),
    el('span', { class: 'sg-num' }, el('b', {}, fmtMin(todayMins)), el('span', {}, ` / ${fmtMin(goal)}`)),
  );

  /* mode is a quiet segmented switch — the length dial is the decision */
  const modeSeg = el('div', { class: 'mode-seg', role: 'group', 'aria-label': 'Session mode' },
    ['timer', 'stop'].map((m) => el('button', {
      class: `mode-seg-btn${mode === m ? ' is-on' : ''}`,
      'aria-pressed': String(mode === m),
      onclick: () => {
        if (mode === m) return;
        Store.set((s) => { s.settings.lastMode = m; });
        renderHost();
      },
    }, m === 'timer' ? 'Timer' : 'Stopwatch')));

  const lenBtns = [];
  const dialNum = el('span', { class: 'dial-num' }, String(min));
  const dialUnit = el('span', { class: 'dial-unit' }, min === 1 ? 'minute' : 'minutes');
  const dialGo = el('span', { class: 'dial-go' }, svg('play', 12), el('span', {}, 'Start'));
  const dial = el('button', { class: 'dial', onclick: () => startWith(min) },
    el('span', { class: 'dial-ticks', 'aria-hidden': 'true' }),
    dialNum, dialUnit, dialGo);
  const dialProj = el('div', { class: 'dial-proj' });
  const pomoChip = el('button', {
    class: 'pomo-chip', 'aria-pressed': 'false',
    'aria-label': `Pomodoro: ${pomoSettings.focus || 25} minute focus rounds with breaks, three rounds`,
    onclick: () => {
      pomo = !pomo;
      rounds = pomo ? 3 : 1;
      if (pomo) selectMin(pomoSettings.focus || 25);
      paintLen();
      hint(pomo ? `Pomodoro: ${min}m focus + breaks, ×3` : 'One round, one finish');
    },
  }, svg('flame', 13), `Pomodoro · ${pomoSettings.focus || 25}m ×3`);

  function selectMin(m) {
    min = m;
    paintLen();
  }

  /* A length chip is a start, not a selection. The 20-second accident
     window is the undo: ending inside it logs nothing and keeps the day
     clean. The armed hold remains for the stopwatch — an open-ended run
     deserves the ritual. */
  function startWith(m) {
    Store.set((s) => { s.settings.lastMode = 'timer'; s.settings.lastMin = m; });
    Session.cfg = { min: m, taskIds: [...pickedTasks], rounds, mode: 'timer' };
    begin();
  }

  function projectedEnd() {
    const now = new Date();
    let total = pomo ? min * rounds : min;
    if (pomo) {
      for (let i = 1; i < rounds; i += 1) total += i % 2 ? pomoSettings.short : pomoSettings.long;
    }
    const end = new Date(now.getTime() + total * 60000);
    const sameDay = end.toDateString() === now.toDateString();
    return `ends ≈ ${end.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}${sameDay ? '' : ' tomorrow'}`;
  }

  function paintLen() {
    lenBtns.forEach((b) => {
      const on = Number(b.dataset.min) === min;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', String(on));
    });
    pomoChip.classList.toggle('is-on', pomo);
    pomoChip.setAttribute('aria-pressed', String(pomo));
    dialNum.textContent = String(min);
    dialUnit.textContent = min === 1 ? 'minute' : 'minutes';
    dial.setAttribute('aria-label',
      `Start ${min} minute${min === 1 ? '' : 's'}${pomo ? `, Pomodoro ×${rounds}` : ''}`);
    dialProj.textContent = pomo ? `${min}m × ${rounds} · ${projectedEnd()}` : projectedEnd();
  }

  /* A session launched from an alarm carries the block's remaining length.
     Show it as its own chip so the choice is visible, not just implicit. */
  const presetMins = [10, 25, 45, 50, 90];
  if (!presetMins.includes(min)) presetMins.push(min);
  presetMins.sort((a, b) => a - b).forEach((m) => {
    const b = el('button', {
      class: 'len', dataset: { min: String(m) }, 'aria-pressed': 'false',
      onclick: () => startWith(m),
    }, el('b', {}, String(m)), el('span', {}, 'm'));
    lenBtns.push(b);
  });
  paintLen();

  function startLabel() {
    return 'Arm the stopwatch';
  }

  const startBtnLabel = el('span', {}, startLabel());
  const startBtn = el('button', {
    class: 'btn btn-primary btn-block study-start',
    onclick: () => {
      if (mode === 'stop') {
        Store.set((s) => { s.settings.lastMode = 'stop'; });
        Session.cfg = { min: 0, taskIds: [...pickedTasks], rounds: 1, mode: 'stop' };
      } else {
        Store.set((s) => { s.settings.lastMode = 'timer'; });
        Session.cfg = { min, taskIds: [...pickedTasks], rounds, mode: 'timer' };
      }
      if (strictOn()) { Session.phase = 'armed'; renderHost(); }
      else begin();
    },
  }, svg('lock', 18), startBtnLabel);

  const taskChipRow = tasksToday.length
    ? el('div', { class: 'chips' }, tasksToday.map((t) => {
        const chip = el('button', {
          class: 'chip', style: 'max-width:300px', 'aria-pressed': 'false',
          onclick: () => {
            if (pickedTasks.has(t.id)) { pickedTasks.delete(t.id); chip.setAttribute('aria-pressed', 'false'); }
            else { pickedTasks.add(t.id); chip.setAttribute('aria-pressed', 'true'); }
          },
        }, t.title.length > 30 ? `${t.title.slice(0, 28)}…` : t.title);
        return chip;
      }))
    : null;

  const taskPanel = taskChipRow
    ? el('div', { class: 'attach-panel', hidden: true }, taskChipRow)
    : null;

  const attach = tasksToday.length
    ? el('button', {
        class: 'attach-row', 'aria-expanded': 'false',
        onclick: () => {
          const open = taskPanel.hidden;
          taskPanel.hidden = !open;
          attach.setAttribute('aria-expanded', String(open));
          attach.classList.toggle('is-open', open);
        },
      },
        el('span', { class: 'ar-left' }, `${tasksToday.length} task${tasksToday.length === 1 ? '' : 's'} today`),
        el('span', { class: 'ar-act' }, 'Attach', el('i', { class: 'ar-caret', innerHTML: svg('caret', 14) })),
      )
    : null;

  const footNote = doneToday
    ? `Session ${doneToday + 1} today · ${fmtMin(todayMins)} banked`
    : 'First session today';

  const openCentre = el('div', { class: 'open-centre' },
    el('div', { class: 'open-glyph' }, svg('clock', 42)),
    el('p', { class: 'open-copy' },
      'No length. Start it, work, pause or lay it down whenever. The seconds you run are the seconds that count.'),
  );

  return el('section', { class: `study${mode === 'stop' ? ' is-open' : ''}` },
    el('div', { class: 'app-head study-head' },
      el('div', { class: 'grow' },
        el('h1', {}, 'Study Mode'),
        el('div', { class: 'sub' },
          strictOn()
            ? `Strict · leaving for over ${GRACE_SEC}s is a slip.`
            : 'Strict off · tracked, not enforced.'),
      ),
    ),
    goalLine,
    modeSeg,
    mode === 'stop'
      ? openCentre
      : el('div', { class: 'study-len' },
          el('div', { class: 'dial-wrap' }, dial, dialProj),
          el('div', { class: 'len-row' }, lenBtns),
          el('div', { class: 'len-meta' },
            pomoChip,
            el('span', { class: 'len-hint' }, 'Tap a length to start'))),
    attach,
    taskPanel,
    mode === 'stop'
      ? el('div', { class: 'study-foot' },
          el('p', { class: 'study-note' }, footNote),
          startBtn)
      : el('p', { class: 'study-note study-note-flow' }, footNote),
  );
}

/* ---------- armed (intention) screen ---------- */

function armedScreen() {
  const btn = el('button', { class: 'holdbtn primary', onpointerdown: holdStart },
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
    try { btn.setPointerCapture(ev.pointerId); } catch (_) { /* the pointer may already be gone */ }
    btn.addEventListener('pointerup', holdCancel);
    btn.addEventListener('pointercancel', holdCancel);
  }

  function holdCancel() {
    cancelAnimationFrame(raf);
    progress(0);
    btn.removeEventListener('pointerup', holdCancel);
    btn.removeEventListener('pointercancel', holdCancel);
  }

  return el('div', { class: 'card armed-card' },
    el('h2', {}, 'One breath before you go in'),
    el('div', { class: 'armed-what' },
      Session.cfg.mode === 'stop' ? 'Stopwatch' : `${Session.cfg.min} min`),
    Session.cfg.taskIds.length
      ? el('div', { class: 'muted', style: 'margin-top:6px' },
          `${Session.cfg.taskIds.length} task${Session.cfg.taskIds.length === 1 ? '' : 's'} attached`)
      : null,
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
  return { banked, live, total: banked + live, goal: Store.state.settings.goalMin || 120 };
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
    /* phase changes are the announcement; the clock itself is role=timer so
       assistive tech decides when to read it instead of narrating every second */
    el('div', { class: 'sess-phase', 'aria-live': 'polite' }, label),
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
  const b = el('button', { class: 'btn btn-danger btn-block btn-quit' });
  paintQuit(b);
  return b;
}

/* The control changes shape when stopping is neutral: inside the 20-second
   accident window, after the earned bar, or with Strict off. Same button,
   different promise. */
function paintQuit(b) {
  const state = freeNow() ? 'free' : earnedNow() ? 'earned' : strictOn() ? 'strict' : 'off';
  if (b.dataset.state === state) return;
  b.dataset.state = state;
  const soft = state !== 'strict';
  b.dataset.soft = String(soft);
  if (soft) {
    b.className = `btn btn-subtle btn-block btn-quit${state === 'earned' ? ' is-earned' : ''}${state === 'free' ? ' is-free' : ''}`;
    b.innerHTML = `${svg('check', 15)}<span>End session</span>`;
    b.onpointerdown = null;
    b.onclick = confirmQuit;
    const why = state === 'free'
      ? 'End session — under 20 seconds, nothing logged'
      : state === 'earned'
        ? 'End session — nothing breaks'
        : 'End session — strict is off';
    b.setAttribute('aria-label', why);
  } else {
    b.className = 'btn btn-danger btn-block btn-quit';
    b.innerHTML = `${svg('x', 15)}<span>Quit — hold</span>`;
    b.onclick = null;
    b.onpointerdown = startQuitHold;
    b.setAttribute('aria-label', 'Quit — hold to confirm');
  }
}

/* The first seconds of a chip-start are the accident window made visible:
   an Undo pill that discards the session cleanly — the same free stop the
   quit button offers, one tap closer to the mis-tap. */
function armUndoPill() {
  if (document.querySelector('.undo-toast')) return;
  const pill = el('div', { class: 'alarm-toast undo-toast', role: 'status' },
    el('div', { class: 'alarm-toast-txt' },
      el('b', {}, 'Started by accident?'),
      el('span', {}, 'Undo leaves nothing — no minutes, no slip.')),
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
  const endsAt = new Date(Session.plannedEnd).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (Date.now() - Session.startedAt < 8000) armUndoPill();
  return el('div', { class: 'session' },
    sessionChrome('Focus'),
    sessionCore({
      label,
      note: strictOn()
        ? `Ends at ${endsAt} · leaving for over ${GRACE_SEC}s is a slip`
        : `Ends at ${endsAt}`,
    }),
    el('footer', { class: 'sess-foot' }, exitHint(), quitButton())
  );
}

/* ---------- stopwatch screens ---------- */

function stopRunningScreen() {
  return el('div', { class: 'session' },
    sessionChrome('Focus', 'live'),
    sessionCore({
      label: 'Stopwatch',
      note: 'Every second in here is banked. Pause is honest rest — it stops the count.',
      clockClass: 'stopwatch',
      breathe: true,
    }),
    el('footer', { class: 'sess-foot' },
      exitHint(),
      el('div', { class: 'sess-foot-split' },
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
    el('footer', { class: 'sess-foot sess-foot-split' },
      el('button', { class: 'btn btn-primary', onclick: resumeStop }, svg('play', 15), 'Resume'),
      el('button', { class: 'btn btn-subtle', onclick: stopEndSheet }, svg('flame', 15), 'End')
    )
  );
}

function stopEndSheet() {
  const earned = earnedNow();
  openSheet('End the stopwatch?', () => [
    el('p', { class: 'muted' },
      `Time banked: ${fmtWatch(stopSeconds())}. ${earned ? 'Ending now breaks nothing.' : 'Logging it keeps the minutes.'}`),
    el('div', { class: 'actions' },
      el('button', { class: 'btn btn-primary', onclick: () => { closeSheet(); finish(true); } }, svg('check', 15), 'Log the session'),
      el('button', { class: 'btn btn-subtle', onclick: () => {
        closeSheet();
        finish(false, { discard: true }); // a real discard: nothing is written
      } }, svg('x', 15), 'End and discard'),
    ),
  ]);
}

function rerenderRunningChips() {
  if (Session.phase === 'running') renderHost();
}

function startQuitHold(ev) {
  ev.preventDefault();
  const btn = ev.currentTarget;
  const t0 = performance.now();
  const HOLD_MS = 2400;
  let raf = 0;
  const step = (now) => {
    const p = (now - t0) / HOLD_MS;
    btn.style.filter = `brightness(${1 + p * 0.6}) saturate(${1 + p * 1.5})`;
    if (p >= 1) { confirmQuit(); return; }
    raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
  const cancel = () => { cancelAnimationFrame(raf); btn.style.filter = ''; };
  btn.addEventListener('pointerup', cancel, { once: true });
  btn.addEventListener('pointercancel', cancel, { once: true });
}

function confirmQuit() {
  const mins = Math.max(0, Math.round(sessionElapsedSec() / 60));
  if (freeNow()) {
    openSheet('End the session?', () => [
      el('p', { class: 'muted', style: 'margin:0 0 4px' },
        `Under ${FREE_EXIT_SEC} seconds in. Ending now logs nothing — no slip, no session.`),
      el('div', { class: 'actions' },
        el('button', { class: 'btn btn-primary', onclick: () => { closeSheet(); abandon(); } }, svg('check', 15), 'End session'),
        el('button', { class: 'btn btn-subtle', onclick: () => closeSheet() }, svg('flame', 15), 'Keep going'),
      ),
    ]);
    return;
  }
  if (earnedNow()) {
    openSheet('End the session?', () => [
      el('p', { class: 'muted', style: 'margin:0 0 4px' },
        `${fmtMin(mins)} banked. Ending now breaks nothing — no slip, no broken streak.`),
      el('div', { class: 'actions' },
        el('button', { class: 'btn btn-primary', onclick: () => { closeSheet(); abandon(); } }, svg('check', 15), 'End session'),
        el('button', { class: 'btn btn-subtle', onclick: () => closeSheet() }, svg('flame', 15), 'Keep going'),
      ),
    ]);
    return;
  }
  if (!strictOn()) {
    openSheet('End the session?', () => [
      el('p', { class: 'muted', style: 'margin:0 0 4px' },
        `${fmtMin(mins)} banked. Strict is off — ending is tracked, not punished.`),
      el('div', { class: 'actions' },
        el('button', { class: 'btn btn-primary', onclick: () => { closeSheet(); abandon(); } }, svg('check', 15), 'End session'),
        el('button', { class: 'btn btn-subtle', onclick: () => closeSheet() }, svg('flame', 15), 'Keep going'),
      ),
    ]);
    return;
  }
  const bar = exitGraceMin();
  const copy = bar > 0
    ? `${fmtMin(mins)} banked. Under your ${fmtMin(bar)} bar, leaving now is a slip — the minutes stay yours.`
    : 'Quitting mid-focus is a slip in the honesty log. Minutes you studied stay yours.';
  openSheet('Leaving already?', () => [
    el('p', { class: 'muted', style: 'margin:0 0 4px' }, copy),
    el('div', { class: 'actions' },
      el('button', { class: 'btn btn-danger', onclick: () => abandon() }, svg('x', 15), 'Log the slip'),
      el('button', { class: 'btn btn-subtle', onclick: () => closeSheet() }, svg('flame', 15), 'Stay in it'),
    ),
  ]);
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
    el('footer', { class: 'sess-foot sess-foot-split' },
      el('button', { class: 'btn btn-primary', onclick: () => { Session.plannedEnd = Date.now(); finishBreak(); } }, 'Back to focus'),
      el('button', { class: 'btn btn-ghost', onclick: confirmEndChain }, 'End here')
    )
  );
}

function confirmEndChain() {
  openSheet('Finish the session?', () => [
    el('p', { class: 'muted' }, 'Rounds already completed stay banked. This just stops the chain — no slip.'),
    el('div', { class: 'actions' },
      el('button', { class: 'btn btn-primary', onclick: () => { closeSheet(); finish(true); } }, 'End session'),
      el('button', { class: 'btn btn-subtle', onclick: () => closeSheet() }, 'Keep going'),
    ),
  ]);
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
  const c = Store.slipCountsOn(todayKey());
  const clean = c.slip === 0 && c.abandon === 0 && (d.done || d.earned);
  const bankedText = d.secs != null ? fmtWatch(d.secs) : fmtMin(d.mins);
  const meter = goalMeter({ label: 'Daily target' });
  updateGoalMeter(meter, dailyTarget());
  const good = d.done || d.earned;
  const celebrate = d.done && clean;
  const today = d.today ?? Store.focusMinutesOn(todayKey());
  let line;
  if (d.earned) line = 'Ended on your terms. Nothing broken.';
  else if (d.discarded) line = 'Nothing banked. The clock reset clean.';
  else if (d.done) line = clean ? 'Nothing broken. The streak stands.' : 'Rounds banked — but the honesty log still holds the slip.';
  else line = strictOn() ? 'Cut short and logged. Tomorrow can still be clean.' : 'Cut short — tracked, not enforced.';
  return el('div', { class: 'done-wrap' },
    el('div', { class: 'done-card view-anim' },
      celebrate ? confettiBurst() : null,
      el('div', { class: `done-kicker ${good ? 'is-good' : 'is-warn'}` },
        good ? 'Session banked' : d.discarded ? 'Session discarded' : 'Session ended',
        celebrate ? ' 🎉' : ''),
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
      el('button', {
        class: 'done-more',
        onclick: () => { Session.phase = 'idle'; Router.go('/stats'); },
      }, 'See the week', svg('chevR', 14)),
    )
  );
}

/* ---------- left veil ---------- */

function showLeftVeil(awaySec) {
  document.getElementById('leftveil')?.remove();
  const veil = el('div', { class: 'leftveil show', id: 'leftveil' },
    el('div', { class: 'veil' },
      el('h3', {}, 'You left.'),
      el('p', {}, `Away ${fmtMin(awaySec / 60)} during focus. Logged — it doesn't erase the round, but the day stops being clean.`),
      el('div', { class: 'count warn' }, '—'),
      el('button', {
        class: 'btn btn-primary btn-block', style: 'margin-top:14px',
        onclick: () => { veil.remove(); },
      }, svg('lock', 17), 'Back in — keep going'),
    )
  );
  document.body.append(veil);
  const counter = veil.querySelector('.count');
  const iv = setInterval(() => {
    if (!document.body.contains(veil)) { clearInterval(iv); return; }
    counter.textContent = Session.cfg?.mode === 'stop'
      ? fmtWatch(stopSeconds())
      : fmtClock(remaining());
  }, 500);
}

/* draw the stopwatch on the paused screen too (clock is static, but keep it truthful) */

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
