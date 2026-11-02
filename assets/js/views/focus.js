/* Lockin — Study Mode: the session engine + strict enforcement.
   The engine is module-level and survives navigation and reloads. */

import { Store, uid } from '../store.js';
import { Router } from '../router.js';
import { el, fmtClock, fmtWatch, fmtMin, todayKey, decideAway } from '../util.js';
import { svg } from '../icons.js';
import { openSheet, closeSheet, hint } from '../ui.js';
import { Sounds } from '../audio.js';

export const GRACE_SEC = 10;    // accident window — an away this short is forgiven
export const RESCUE_CAP = 3;    // free rescues per day; beyond that it is a slip

let timer = null;
let wakeSentinel = null;
let currentSessId = null;

const Session = {
  phase: 'idle',                 // idle | armed | running | paused | break | done | aborted
  cfg: null,                     // {min, subjId, taskIds, rounds, demo, mode: 'timer'|'stop'}
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

function onVisibility() {
  if (document.visibilityState === 'hidden') {
    if (Session.phase === 'running' && strictOn() && !Session.cfg?.demo) {
      Store.set((s) => { if (s.session) s.session.goneAt = Date.now(); });
    }
  } else {
    /* background tabs get their timers throttled — redraw the truth the
       instant the page is visible again (elapsed comes from the wall clock) */
    if (['running', 'paused', 'break'].includes(Session.phase)) {
      drawClock();
      if (Session.cfg?.mode === 'stop') snapshot();
    }
    if (Session.phase === 'running' && strictOn() && !Session.cfg?.demo) processBack();
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

/* ---------- take-over: fullscreen + wake lock + notifications ---------- */

async function takeOver() {
  try {
    if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
      await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
    }
  } catch (_) { /* iOS Safari: no element fullscreen — standalone PWA is already full-bleed */ }
  if ('wakeLock' in navigator && Store.state.settings.wakelock) {
    try { wakeSentinel = await navigator.wakeLock.request('screen'); } catch (_) {}
  }
  if (Store.state.settings.notifs && 'Notification' in window && Notification.permission === 'default') {
    try { Notification.requestPermission(); } catch (_) {}
  }
}

function wakeAlive() {
  if (Session.phase === 'running' && 'wakeLock' in navigator && Store.state.settings.wakelock && !wakeSentinel) {
    navigator.wakeLock.request('screen').then((s) => { wakeSentinel = s; }).catch(() => {});
  }
}

async function releaseAll() {
  try { if (wakeSentinel) await wakeSentinel.release(); } catch (_) {}
  wakeSentinel = null;
  if (document.fullscreenElement) { try { await document.exitFullscreen(); } catch (_) {} }
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
  if (Store.state.settings.sounds) {
    Sounds.setVolume(Store.state.settings.volume ?? 0.6);
    Sounds.play(Store.state.settings.soundKind || 'rain');
  }
  startTick();
  renderHost();
}

/* ---------- stopwatch controls ---------- */

function pauseStop() {
  if (Session.cfg?.mode !== 'stop') return;
  Session.savedMs += Date.now() - Session.startedAt;
  Session.pauseCount += 1;
  Session.phase = 'paused';
  Sounds.stop();
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
  if (Store.state.settings.sounds) {
    Sounds.setVolume(Store.state.settings.volume ?? 0.6);
    Sounds.play(Store.state.settings.soundKind || 'rain');
  }
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
    subjectId: Session.cfg.subjId || null,
    taskIds: Session.cfg.taskIds || [],
    start: Session.startedAt,
    end: Session.plannedEnd,
    kind: 'focus',
    completed: true,
    demo: !!Session.cfg.demo,
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

function recordAborted(subjectId, taskIds, start) {
  if (Session.cfg?.mode === 'stop') return null; // stopwatch writes its record in finish()
  const id = currentSessId;
  const secs = Session.cfg?.mode === 'stop' ? stopSeconds() : null;
  Store.set((s) => s.sessions.push({
    id,
    day: todayKey(),
    subjectId: subjectId || null,
    taskIds: taskIds || [],
    start,
    end: Date.now(),
    kind: 'focus',
    completed: false,
    aborted: true,
    secs,
    demo: !!Session.cfg?.demo,
  }));
  return id;
}

function startBreak(min) {
  Session.phase = 'break';
  Session.breakKind = min;
  Session.startedAt = Date.now();
  Session.plannedEnd = Date.now() + min * 60000;
  Sounds.stop();
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
    if (Store.state.settings.sounds) Sounds.play(Store.state.settings.soundKind || 'rain');
    startTick();
    renderHost();
  } else {
    finish(true);
  }
}

function finish(finished) {
  clearInterval(timer);
  timer = null;
  Sounds.stop();
  releaseAll();
  const stopMode = Session.cfg?.mode === 'stop';
  const secs = stopMode ? stopSeconds() : null;
  /* stopwatch sessions write their record here — engine never hits completeRound
     (timer rounds record there); aborted or logged, the banked seconds count */
  if (stopMode) {
    Store.set((s) => s.sessions.push({
      id: currentSessId,
      day: todayKey(),
      subjectId: Session.cfg.subjId || null,
      taskIds: Session.cfg.taskIds || [],
      start: Session.watchStart,
      end: Date.now(),
      secs,
      kind: 'focus',
      completed: !!finished,
      aborted: !finished,
      demo: !!Session.cfg?.demo,
    }));
  }
  const minsStudied = finished
    ? (stopMode ? Math.round(secs / 60) : Session.cfg.min * Math.max(1, Session.roundIdx))
    : (stopMode ? Math.round(secs / 60) : Math.max(0, Math.round((Date.now() - Session.startedAt) / 60000)));
  Session.lastDone = {
    done: !!finished,
    subjName: nameOf(Session.cfg?.subjId),
    mins: minsStudied,
    secs, // stopwatch precision for the done screen
    demo: !!Session.cfg?.demo,
    today: Store.focusMinutesOn(todayKey()),
  };
  Session.phase = finished ? 'done' : 'aborted';
  clearSnapshot();
  if (finished) notify('Session done. Clean slate kept.');
  renderHost();
}

function abandon() {
  recordAborted(Session.cfg.subjId, Session.cfg.taskIds, Session.startedAt);
  if (!Session.cfg?.demo) Store.logSlip('abandon', currentSessId, 0); // the demo never logs
  closeSheet();
  finish(false);
}

/* Aborting keeps the minutes studied before the abort (real work) but the
   day stops being clean — the slip goes into the honesty log either way. */

function notify(body) {
  if (!body) return;
  if (Store.state.settings.notifs && 'Notification' in window && Notification.permission === 'granted') {
    try { new Notification('Lockin', { body }); } catch (_) {}
  }
  try { navigator.vibrate && navigator.vibrate([120, 60, 120]); } catch (_) {}
}

/* ---------- registration ---------- */

export function initFocus(Router) {
  Router.register('/focus', { mount, unmount });
}

/**
 * Walkthrough hook: a 2-minute demo session — real engine, safe rules.
 * Demo sessions never log slips and are excluded from all stats.
 */
export function startDemoSession(subjId) {
  Session.cfg = {
    min: 2,
    subjId: subjId || Store.subjects()[0]?.id || null,
    taskIds: [],
    rounds: 1,
    demo: true,
    mode: 'timer',
  };
  Store.set((s) => { s.flags.onboarded = true; }); // they've seen enough to not re-board next load
  Router.go('/focus');
  begin();
}

const nameOf = (subjId) => (Store.activity(subjId)?.name || 'Study');

function renderHost() {
  const host = document.getElementById('view');
  if (!host || Router.parse().path !== '/focus') return;
  host.textContent = '';
  document.body.dataset.mode =
    ['running', 'break', 'paused'].includes(Session.phase) ? 'focus' : '';

  if (Session.phase === 'running') host.append(el('div', { class: 'view-anim' }, runningScreen()));
  else if (Session.phase === 'break') host.append(el('div', { class: 'view-anim' }, breakScreen()));
  else if (Session.phase === 'paused') host.append(el('div', { class: 'view-anim' }, pausedScreen()));
  else if (Session.phase === 'armed') host.append(el('div', { class: 'view-anim' }, armedScreen()));
  else if (Session.phase === 'done' || Session.phase === 'aborted') host.append(el('div', { class: 'view-anim' }, doneScreen()));
  else host.append(el('div', { class: 'view-anim' }, setupScreen()));

  if (Session.phase === 'running' || Session.phase === 'break' || Session.phase === 'paused') drawClock();
}

/* ---------- setup screen ---------- */

function setupScreen() {
  const q = new URLSearchParams(location.hash.split('?')[1] || '');
  const subjects = Store.subjects();
  let min = Number(q.get('min')) || 25;
  let subjId = q.get('subj') || subjects[0]?.id || null;
  let rounds = 1;
  let pomo = false;
  let mode = q.get('mode') === 'stop' ? 'stop' : (Store.state.settings.lastMode === 'stop' ? 'stop' : 'timer');
  const pickedTasks = new Set();
  const tasksToday = Store.openTasks(todayKey());

  /* today counter — how many real sessions already banked today */
  const doneToday = Store.state.sessions.filter((x) =>
    x.day === todayKey() && x.kind === 'focus' && !x.demo).length;
  const todayMins = Store.focusMinutesOn(todayKey());

  const presetChips = el('div', { class: 'chips', style: 'margin-bottom:12px' });
  [10, 25, 45, 50, 90].forEach((m) => {
    const chip = el('button', {
      class: 'chip', 'aria-pressed': String(m === min),
      onclick: () => { min = m; syncPressed(presetChips, chip); },
    }, `${m}m`);
    presetChips.append(chip);
  });

  const pomoChip = el('button', {
    class: 'chip', 'aria-pressed': 'false',
    onclick: () => {
      pomo = !pomo;
      rounds = pomo ? 3 : 1;
      pomoChip.setAttribute('aria-pressed', String(pomo));
      hint(pomo ? `Pomodoro: ${Store.state.settings.pomo.focus}m focus + breaks, ×3` : 'One round, one finish');
    },
  }, svg('flame', 13), 'Pomodoro ×3');
  presetChips.append(pomoChip);

  const subjectRow = () => {
    const subjChips = el('div', { class: 'chips' });
    subjects.forEach((a) => {
      const chip = el('button', {
        class: 'chip', style: `--h:${a.hue}`,
        'aria-pressed': String(a.id === subjId),
        onclick: () => { subjId = a.id; syncPressed(subjChips, chip); },
      }, el('i', { class: 'dot' }), a.name);
      subjChips.append(chip);
    });
    return subjChips;
  };

  const stopExplain = el('p', { class: 'muted', style: 'margin:0 0 12px' },
    'Open-ended: start it, seconds count up, pause or lay it down whenever. The seconds you run are the seconds that count.');

  const startBtn = el('button', {
    class: 'btn btn-primary btn-block', style: 'margin-top:16px',
    onclick: () => {
      if (!subjId) { hint('Pick a subject first.'); return; }
      if (mode === 'stop') {
        Store.set((s) => { s.settings.lastMode = 'stop'; });
        Session.cfg = { min: 0, subjId, taskIds: [...pickedTasks], rounds: 1, demo: false, mode: 'stop' };
      } else {
        Store.set((s) => { s.settings.lastMode = 'timer'; });
        Session.cfg = { min, subjId, taskIds: [...pickedTasks], rounds, demo: false, mode: 'timer' };
      }
      if (strictOn()) { Session.phase = 'armed'; renderHost(); }
      else begin();
    },
  }, svg('lock', 18), strictOn() ? (mode === 'stop' ? 'Arm the stopwatch' : 'Set the intention') : (mode === 'stop' ? 'Start the stopwatch' : 'Start session'));

  const modeWrap = () => {
    const pillRow = el('div', { class: 'chips', style: 'margin-bottom:14px' },
      el('button', {
        class: 'chip', 'aria-pressed': String(mode === 'timer'),
        onclick: () => {
          if (mode === 'timer') return; // idempotent — no rebuild churn
          Store.set((s) => { s.settings.lastMode = 'timer'; });
          renderHost();
        },
      }, svg('caret', 13), 'Timer'),
      el('button', {
        class: 'chip', 'aria-pressed': String(mode === 'stop'),
        onclick: () => {
          if (mode === 'stop') return;
          Store.set((s) => { s.settings.lastMode = 'stop'; });
          renderHost();
        },
      }, svg('sound', 13), 'Stopwatch'),
    );
    return pillRow;
  };

  const errorNote = subjects.length ? null : el('p', { class: 'muted', style: 'margin:0 0 8px' },
    'No subjects yet — add them on the Plan tab, then come back.');

  return el('div', { class: 'card' },
    el('h2', {}, 'Study Mode setup'),
    doneToday ? el('p', { class: 'muted', style: 'margin:0 0 6px' }, `Session ${doneToday + 1} today · ${fmtMin(todayMins)} banked so far.`) : null,
    el('p', { class: 'muted', style: 'margin:0 0 12px' },
      strictOn()
        ? `Strict Mode is on. During focus, leaving for more than ${GRACE_SEC}s is a slip — under ${GRACE_SEC}s is forgiven, ${RESCUE_CAP} times a day.`
        : 'Strict Mode is off — sessions are tracked, not enforced.'),
    modeWrap(),
    mode === 'stop'
      ? [el('p', { class: 'muted', style: 'margin:0 0 8px' }, 'Subject'), subjectRow(), stopExplain]
      : [presetChips, el('p', { class: 'muted', style: 'margin:0 0 8px' }, 'Subject'), subjectRow()],
    errorNote,
    tasksToday.length ? el('p', { class: 'muted', style: 'margin:10px 0 2px' }, 'Attach tasks') : null,
    tasksToday.length
      ? el('div', { class: 'chips', style: 'margin-top:6px' }, tasksToday.map((t) => {
          const chip = el('button', {
            class: 'chip', style: 'max-width:300px',
            onclick: () => {
              if (pickedTasks.has(t.id)) { pickedTasks.delete(t.id); chip.setAttribute('aria-pressed', 'false'); }
              else { pickedTasks.add(t.id); chip.setAttribute('aria-pressed', 'true'); }
            },
          }, t.title.length > 30 ? `${t.title.slice(0, 28)}…` : t.title);
          return chip;
        }))
      : null,
    startBtn,
  );
}

function syncPressed(group, active) {
  for (const c of group.children) {
    if (c === active) c.setAttribute('aria-pressed', 'true');
    else c.setAttribute('aria-pressed', 'false');
  }
}

/* ---------- armed (intention) screen ---------- */

function armedScreen() {
  const act = Store.activity(Session.cfg.subjId);
  const hue = act?.hue ?? 100;

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
    takeOver(); // latch fullscreen + wake lock + n-permission while the gesture is live
    t0 = performance.now();
    const step = (now) => {
      const p = (now - t0) / HOLD_MS;
      progress(p);
      if (p >= 1) { begin(); return; }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    try { btn.setPointerCapture(ev.pointerId); } catch (_) {}
    btn.addEventListener('pointerup', holdCancel);
    btn.addEventListener('pointercancel', holdCancel);
  }

  function holdCancel() {
    cancelAnimationFrame(raf);
    progress(0);
    btn.removeEventListener('pointerup', holdCancel);
    btn.removeEventListener('pointercancel', holdCancel);
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  }

  return el('div', { class: 'card', style: 'text-align:center' },
    el('h2', {}, 'Before you go in'),
    el('div', { style: 'font:600 34px "JetBrains Mono",monospace;margin-bottom:4px' },
      Session.cfg.mode === 'stop' ? 'Stopwatch' : `${Session.cfg.min} min`),
    el('div', { style: `font:400 24px "Instrument Serif",serif;color:hsl(${hue} 45% 62%)` }, nameOf(Session.cfg.subjId)),
    Session.cfg.taskIds.length
      ? el('div', { class: 'muted', style: 'margin-top:6px' },
          `${Session.cfg.taskIds.length} task${Session.cfg.taskIds.length === 1 ? '' : 's'} attached`)
      : null,
    el('p', { class: 'tiny', style: 'margin-top:10px;padding:0 14px' },
      'As you hold, Lockin wakes the screen and goes full-screen. When the ring closes, you are in.'),
    el('div', { class: 'holdwrap', style: 'justify-content:center;flex-direction:column;gap:12px;margin-top:16px' }, btn, note),
    el('button', {
      class: 'btn btn-ghost', style: 'margin-top:10px',
      onclick: () => { Session.phase = 'idle'; renderHost(); },
    }, 'Not yet'),
  );
}

/* ---------- running screen ---------- */

/* how many real sessions + minutes banked today (drives the Regain-style counter) */
function todayTally() {
  const n = Store.state.sessions.filter((x) =>
    x.day === todayKey() && x.kind === 'focus' && !x.demo).length + 1; // this one
  return { n, mins: Store.focusMinutesOn(todayKey()) };
}

function aurora() {
  return el('div', { class: 'aurora', 'aria-hidden': 'true' });
}

function sessionHead(kindLabel, subjId) {
  const act = Store.activity(subjId);
  const tasks = (Session.cfg.taskIds || [])
    .map((id) => Store.state.tasks.find((t) => t.id === id))
    .filter(Boolean);
  const tally = todayTally();
  const pips = el('div', { class: 'pips' });
  for (let i = 1; i <= (Session.cfg.rounds || 1); i++) {
    pips.append(el('i', { class: `pip ${i < Session.roundIdx ? 'done' : i === Session.roundIdx ? 'cur' : ''}` }));
  }
  return el('div', { class: 'head' },
    el('div', { class: 'phase' }, `${kindLabel}${Session.cfg.rounds > 1 && Session.cfg.mode !== 'stop' ? ` · round ${Session.roundIdx} of ${Session.cfg.rounds}` : ''}`),
    el('div', { class: 'subj', style: `--h:${act?.hue ?? 100}` }, nameOf(subjId)),
    pips,
    el('div', { class: 'muted tiny', style: 'margin-top:2px' }, `Session ${tally.n} today · ${fmtMin(tally.mins)} banked`),
    tasks.length ? el('div', { class: 'muted tiny' }, tasks.map((t) => t.title).join(' · ')) : null,
  );
}

function runningScreen() {
  if (Session.cfg.mode === 'stop') return stopRunningScreen();

  const soundsBtn = el('button', {
    class: 'iconbtn', innerHTML: svg('sound'), 'aria-label': 'Change focus sound',
    onclick: () => {
      const kinds = Sounds.KINDS;
      const next = kinds[(kinds.indexOf(Store.state.settings.soundKind || 'rain') + 1) % kinds.length];
      Store.set((s) => { s.settings.soundKind = next; });
      if (Store.state.settings.sounds) { Sounds.setVolume(Store.state.settings.volume ?? 0.6); Sounds.play(next); }
      else Sounds.stop();
      hint(next === 'none' ? 'Sound off' : `Sound: ${next}`);
    },
  });

  const quitBtn = el('button', {
    class: 'btn btn-danger btn-sm', style: 'border-radius:999px;padding:11px 20px',
    onpointerdown: startQuitHold,
  }, svg('x', 15), 'Quit — hold');

  const taskZip = (Session.cfg.taskIds || [])
    .map((id) => Store.state.tasks.find((t) => t.id === id))
    .filter(Boolean)
    .map((t) => el('button', {
      class: 'chip', 'aria-pressed': String(!!t.doneAt),
      style: 'max-width:280px',
      onclick: () => {
        Store.set((s) => { const x = s.tasks.find((y) => y.id === t.id); x.doneAt = x.doneAt ? null : Date.now(); });
        rerenderRunningChips();
      },
    }, (t.doneAt ? '✓ ' : '') + (t.title.length > 26 ? `${t.title.slice(0, 24)}…` : t.title)));

  return el('div', { class: 'session aurora-stage' },
    aurora(),
    sessionHead('Focus', Session.cfg.subjId),
    el('div', { class: 'foot', style: 'flex-direction:column;gap:16px' },
      el('div', { class: 'clock' }, '—'),
      taskZip.length ? el('div', { class: 'chips', style: 'justify-content:center;max-width:100%' }, taskZip) : null,
      el('div', { class: 'row', style: 'gap:12px;justify-content:center' }, soundsBtn, quitBtn),
    )
  );
}

/* ---------- stopwatch screens ---------- */

function stopRunningScreen() {
  const quitBtn = el('button', {
    class: 'btn btn-danger btn-sm', style: 'border-radius:999px;padding:11px 20px',
    onpointerdown: startQuitHold,
  }, svg('x', 15), 'Quit — hold');

  return el('div', { class: 'session aurora-stage' },
    aurora(),
    sessionHead('Focus — stopwatch', Session.cfg.subjId),
    el('div', { class: 'foot', style: 'flex-direction:column;gap:16px' },
      el('div', { class: 'clock stopwatch' }, '00:00'),
      el('div', { class: 'muted tiny' }, 'Every second you are in here is banked. Pause is honest rest — it stops the count.'),
      el('div', { class: 'row', style: 'gap:12px;justify-content:center' },
        el('button', {
          class: 'btn btn-primary', style: 'border-radius:999px;padding:11px 22px',
          onclick: () => { pauseStop(); },
        }, svg('caret', 15), 'Pause'),
        quitBtn,
      ),
    )
  );
}

function pausedScreen() {
  return el('div', { class: 'session' },
    sessionHead('Paused', Session.cfg.subjId),
    el('div', { class: 'foot', style: 'flex-direction:column;gap:16px' },
      el('div', { class: 'clock stopwatch', style: 'color:var(--tx-2)' }, '00:00'),
      el('div', { class: 'muted tiny' }, `Paused on the second. ${Session.pauseCount} pause${Session.pauseCount === 1 ? '' : 's'} so far.`),
      el('div', { class: 'row', style: 'gap:12px;justify-content:center' },
        el('button', {
          class: 'btn btn-primary', style: 'border-radius:999px;padding:11px 22px',
          onclick: () => { resumeStop(); },
        }, svg('play', 15), 'Resume'),
        el('button', {
          class: 'btn btn-subtle', style: 'border-radius:999px;padding:11px 20px',
          onclick: stopEndSheet,
        }, svg('flame', 15), 'End'),
      ),
    )
  );
}

function stopEndSheet() {
  openSheet('End the stopwatch?', () => [
    el('p', { class: 'muted' }, `Time banked: ${fmtWatch(stopSeconds())}. Logging it wraps the session up properly.`),
    el('div', { class: 'actions' },
      el('button', { class: 'btn btn-primary', onclick: () => { closeSheet(); finish(true); } }, svg('check', 15), 'Log the session'),
      el('button', { class: 'btn btn-subtle', onclick: () => {
        closeSheet();
        finish(false); // stopwatch records its own (aborted, no slip)
      } }, svg('x', 15), 'Discard'),
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
  openSheet('Leaving already?', () => [
    el('p', { class: 'muted', style: 'margin:0 0 4px' },
      'Quitting mid-focus is a slip in the honesty log. Minutes you studied stay yours.'),
    el('div', { class: 'actions' },
      el('button', { class: 'btn btn-danger', onclick: () => abandon() }, svg('x', 15), 'Log the slip'),
      el('button', { class: 'btn btn-subtle', onclick: () => closeSheet() }, svg('flame', 15), 'Stay in it'),
    ),
  ]);
}

/* ---------- break screen ---------- */

function breakScreen() {
  const clock = el('div', { class: 'clock', style: 'color:var(--good)' }, '—');
  return el('div', { class: 'session' },
    el('div', { class: 'head' },
      el('div', { class: 'phase' }, (Session.breakKind >= 10 ? 'Long break' : 'Short break')),
      el('div', { class: 'subj' }, 'Water, stretch, window.'),
      el('div', { class: 'muted tiny' }, `Next round: ${nameOf(Session.cfg.subjId)}`),
    ),
    el('div', { class: 'foot', style: 'flex-direction:column;gap:16px' },
      clock,
      el('div', { class: 'row', style: 'gap:12px;justify-content:center' },
        el('button', { class: 'btn btn-subtle', onclick: () => { Session.plannedEnd = Date.now(); finishBreak(); } }, 'Back to focus'),
        el('button', { class: 'btn btn-ghost', onclick: confirmEndChain }, 'End here'),
      ),
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

function doneScreen() {
  const d = Session.lastDone || { done: false, subjName: 'Session', mins: 0 };
  const c = Store.slipCountsOn(todayKey());
  const clean = c.slip === 0 && c.abandon === 0 && d.done;
  const bankedText = d.secs != null ? fmtWatch(d.secs) : fmtMin(d.mins);
  return el('div', { class: 'card', style: 'text-align:center;margin-top:14vh' },
    el('h2', {}, d.done ? 'Banked' : 'It happens'),
    el('div', { style: 'font:600 46px "JetBrains Mono",monospace;color:var(--acc)' }, `+${bankedText}`),
    el('div', { style: 'font:400 24px "Instrument Serif",serif;margin-top:4px' }, d.subjName || 'Session'),
    el('p', { class: 'muted', style: 'margin-top:8px' },
      d.done
        ? clean ? 'Nothing broken. The streak stands.' : 'Rounds banked — but the honesty log still holds the slip.'
        : 'Cut short and logged. Tomorrow can still be clean.'),
    el('p', { class: 'tiny' }, `Focus today: ${fmtMin(d.today)}`),
    el('div', { class: 'row', style: 'justify-content:center;gap:10px;margin-top:16px' },
      el('button', {
        class: 'btn btn-primary',
        onclick: () => { Session.phase = 'idle'; renderHost(); },
      }, 'Again'),
      el('button', { class: 'btn btn-subtle', onclick: () => Router.go('/home') }, 'Home'),
    ),
    d.demo ? el('p', { class: 'tiny', style: 'margin-top:12px' }, 'Demo session — demo minutes are excluded from stats.') : null,
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

function drawClock() {
  const node = document.querySelector('.session .clock');
  if (!node) return;
  if (Session.cfg?.mode === 'stop') {
    node.textContent = fmtWatch(stopSeconds());
    return;
  }
  node.textContent = fmtClock(remaining());
  if (Session.phase === 'running') node.classList.toggle('tensec', remaining() < 10);
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
  document.getElementById('leftveil')?.remove();
}
