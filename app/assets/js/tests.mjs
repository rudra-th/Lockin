/* Lockin — the shared self-check suite.
   Pure-logic asserts for tasks, sessions, daily-target streaks, target maths,
   the session rules and schedule alarms, written once and run twice:

   - `tools/run-tests.mjs` executes the logic groups under Node (CI, `npm test`)
     against stubbed browser globals;
   - `app/tests.html` renders the same groups in the browser and adds the
     DOM-factory group, which needs a real document.

   Nothing here writes real localStorage: in the browser every `lockin.*` key
   is shadowed by an in-memory sandbox, and under Node the runner already
   provides an isolated storage. */

import { Store } from './store.js';
import {
  slotsToT, tToSlots, fmtClock, fmtWatch, fmtMin, todayKey, addDays, daysUntil,
  freeExit, blockSessionMin, parseHM, toHM, spanMin,
  occursOn, occurrenceOn, occurrencesBetween, nextOccurrence, eventsBetween, daysLabel,
  normalizeSchedule, el,
  normalizeGoalHistory, goalFor, setGoalOn, dayGoalMet, minutesLeft, goalStreak, targetDays,
  parseNudgeAt, nudgeAtHM, nudgeDue, nudgeBody, reminderBody, weekSummary,
} from './util.js';
import { examById, examDateFor, expectedYear } from './exams.js';
import { svg } from './icons.js';
import {
  stableStringify, diffCollection, diffScalar, mergeDocs, mergeScalar, nextCursor,
} from '../../core/sync.js';
import {
  MAX_LIMIT_MIN, MAX_COMMIT_SEC, limitMinutes, usedSeconds, isSpent, spentSites, msUntilReset,
  matchSite, creditedSeconds,
} from '../../core/limits.js';
import {
  SHORTS_SURFACES, shortSurface, isShortsUrl, surfaceForDomain, shortsFilters,
} from '../../core/shorts.js';
import { authErrorMessage, errorCodeOf, isCancel } from '../../core/auth-errors.js';

/**
 * Run the suite against a reporter: { group(name), ok(name), bad(name, err) }.
 * `dom: true` adds the DOM-factory group (browser only).
 */
export async function runSelfCheck(reporter, { dom = false } = {}) {
  const { group, ok, bad } = reporter;
  const test = (name, fn) => { try { fn(); ok(name); } catch (e) { bad(name, e); } };
  const eq = (a, b, msg = 'eq') => {
    const sa = JSON.stringify(a), sb = JSON.stringify(b);
    if (sa !== sb) throw new Error(`${msg}: expected ${sb}, got ${sa}`);
  };

  /* The target-day tests rewrite sessions and settings directly, so they run
     against an in-memory copy of the visitor's lockin.* keys. Nothing here
     ever writes real localStorage: no test fixture can leak into the real
     planner, and an open app tab in another tab never hears a storage
     event, so it cannot adopt (and re-persist) test data either.
     Under Node there is no Storage to patch — the runner's stub is already
     isolated. */
  if (typeof Storage !== 'undefined') {
    const sandbox = new Map();
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i);
      if (k && k.startsWith('lockin.')) sandbox.set(k, localStorage.getItem(k));
    }
    const realGet = Storage.prototype.getItem;
    const realSet = Storage.prototype.setItem;
    const realDel = Storage.prototype.removeItem;
    const mine = (k) => typeof k === 'string' && k.startsWith('lockin.');
    Storage.prototype.getItem = function (k) {
      if (mine(k)) return sandbox.has(k) ? sandbox.get(k) : null;
      return realGet.call(this, k);
    };
    Storage.prototype.setItem = function (k, v) {
      if (mine(k)) { sandbox.set(k, String(v)); return; }
      return realSet.call(this, k, v);
    };
    Storage.prototype.removeItem = function (k) {
      if (mine(k)) { sandbox.delete(k); return; }
      return realDel.call(this, k);
    };
  }

  Store.load();

  group('Slot and time math');
  test('slotsToT anchors', () => {
    eq(slotsToT(0), '00:00');
    eq(slotsToT(1), '00:30');
    eq(slotsToT(16), '08:00');
    eq(slotsToT(47), '23:30');
    eq(slotsToT(48), '00:00'); // 24:00 wraps to midnight label
  });
  test('tToSlots roundtrip', () => {
    eq(tToSlots('08:00'), 16);
    eq(tToSlots('25:30'), 48);   // clamped
    eq(tToSlots('-4:00'), 0);    // clamped
    eq(slotsToT(tToSlots('14:30')), '14:30');
  });
  test('fmt helpers', () => {
    eq(fmtClock(125), '02:05');
    eq(fmtClock(3725), '1:02:05');
    eq(fmtMin(85), '1h 25m');
    eq(fmtMin(60), '1h');
    eq(fmtMin(7), '7m');
  });
  test('fmtWatch floors (stopwatch up-count)', () => {
    eq(fmtWatch(0), '00:00');
    eq(fmtWatch(62), '01:02');
    eq(fmtWatch(3721), '1:02:01'); // 3721s = 1h 2m 1s — ceil would be wrong here
  });
  test('addDays month/year rollover', () => {
    eq(addDays('2026-11-30', 1), '2026-12-01');
    eq(addDays('2024-02-28', 1), '2024-02-29'); // leap year
    eq(addDays('2026-03-01', -1), '2026-02-28');
  });

  group('Exam date math');
  test('daysUntil counts whole local days', () => {
    eq(daysUntil('2026-11-03', new Date(2026, 10, 3, 0, 1)), 0);
    eq(daysUntil('2026-11-04', new Date(2026, 10, 3, 23, 59)), 1);
    eq(daysUntil('2026-11-02', new Date(2026, 10, 3, 12, 0)), -1);
    eq(daysUntil('2027-05-04', new Date(2026, 10, 3)), 182);
  });
  test('examDateFor keeps the usual day, uses the 1st elsewhere', () => {
    eq(examDateFor(examById('neet'), 4, 2027), '2027-05-04');
    eq(examDateFor(examById('neet'), 5, 2027), '2027-06-01');
    eq(examDateFor(null, 4, 2027), '2027-05-01');
  });
  test('examDateFor clamps impossible days', () => {
    eq(examDateFor({ month: 1, day: 30 }, 1, 2027), '2027-02-28');
    eq(examDateFor({ month: 1, day: 30 }, 1, 2028), '2028-02-29');
  });
  test('expectedYear rolls an exam month forward, not backward', () => {
    const nov = new Date(2026, 10, 3); // Nov 3 2026
    eq(expectedYear(4, 4, nov), 2027);  // May already gone
    eq(expectedYear(11, 1, nov), 2026); // December still ahead
  });

  group('Tasks');
  const TD = todayKey();
  test('tasks are per-day, openable and removable', () => {
    Store.set((s) => { s.tasks = []; });
    Store.set((s) => s.tasks.push({
      id: 'tk1', date: TD, title: 'Read one chapter', stages: [], doneAt: null,
    }));
    eq(Store.tasksOn(TD).length, 1);
    eq(Store.openTasks(TD).length, 1);
    Store.set((s) => { s.tasks[0].doneAt = Date.now(); });
    eq(Store.openTasks(TD).length, 0);
    Store.set((s) => { s.tasks = s.tasks.filter((t) => t.id !== 'tk1'); });
    eq(Store.tasksOn(TD).length, 0);
  });

  group('Planner grid operations');
  test('paint fills empty range', () => {
    const list = Store.paint([], 'a', 4, 8);
    eq(list.length, 1);
    eq([list[0].s, list[0].e, list[0].actId], [4, 8, 'a']);
  });
  test('paint merges same-activity neighbours', () => {
    const list = Store.paint([{ id: 'x', actId: 'a', s: 4, e: 8 }], 'a', 8, 10);
    eq(list.length, 1);
    eq([list[0].s, list[0].e, list[0].actId], [4, 10, 'a']);
  });
  test('paint splits a different activity', () => {
    const list = Store.paint([{ id: 'x', actId: 'b', s: 0, e: 12 }], 'a', 4, 8);
    eq(list.map((b) => [b.actId, b.s, b.e]), [['b', 0, 4], ['a', 4, 8], ['b', 8, 12]]);
  });
  test('erode removes a middle span', () => {
    const list = Store.erode([{ id: 'x', actId: 'b', s: 0, e: 12 }], 4, 8);
    eq(list.map((b) => [b.s, b.e]), [[0, 4], [8, 12]]);
  });
  test('erode swallows whole blocks', () => {
    eq(Store.erode([{ id: 'x', actId: 'b', s: 2, e: 6 }], 0, 12), []);
  });

  group('Daily target & streak');
  const T = todayKey();
  const Y = addDays(T, -1), Y2 = addDays(T, -2);
  const mkSession = (day, mins, { completed = true } = {}) => ({
    id: `t_${day}_${mins}`, day, start: Date.now() - mins * 60000, end: Date.now(),
    kind: 'focus', completed, taskIds: [],
  });
  const seedGoal = (min = 120) => Store.set((s) => {
    s.settings.goalMin = min;
    s.settings.goalHistory = [{ day: '1970-01-01', min }];
  });

  test('no focus → target not met', () => {
    seedGoal(120);
    Store.set((s) => { s.sessions = []; });
    eq(Store.dayGoalMet(T), false);
    eq(Store.goalLeft(T), 120);
  });
  test('reaching the target marks the day', () => {
    seedGoal(120);
    Store.set((s) => { s.sessions = [mkSession(T, 120)]; });
    eq(Store.dayGoalMet(T), true);
    eq(Store.goalLeft(T), 0);
  });
  test('partial focus leaves the real minutes left', () => {
    seedGoal(120);
    Store.set((s) => { s.sessions = [mkSession(T, 30)]; });
    eq(Store.goalLeft(T), 90);
    eq(Store.dayGoalMet(T), false);
  });
  test('streak counts yesterday and the day before', () => {
    seedGoal(120);
    Store.set((s) => { s.sessions = [mkSession(Y, 130), mkSession(Y2, 125)]; });
    eq(Store.dayGoalMet(Y), true);
    eq(Store.goalStreak(T), 2); // today is still in progress
  });
  test('streak stops at the first short day', () => {
    seedGoal(120);
    Store.set((s) => { s.sessions = [mkSession(Y, 130), mkSession(Y2, 40)]; });
    eq(Store.goalStreak(T), 1);
  });
  test('a day is measured against the target in force that day', () => {
    Store.set((s) => {
      s.settings.goalMin = 120;
      s.settings.goalHistory = [{ day: '1970-01-01', min: 60 }, { day: Y, min: 120 }];
      s.sessions = [mkSession(Y2, 90)];
    });
    eq(Store.goalFor(Y2), 60);
    eq(Store.dayGoalMet(Y2), true); // 90 ≥ 60
    eq(Store.goalFor(Y), 120);
  });
  test('changing today’s target leaves past days alone', () => {
    Store.set((s) => {
      s.settings.goalMin = 60;
      s.settings.goalHistory = [{ day: '1970-01-01', min: 60 }];
      s.sessions = [];
    });
    Store.setGoal(150);
    eq(Store.goalFor(Y), 60);
    eq(Store.goalToday(), 150);
    eq(Store.state.settings.goalHistory.at(-1).day, T);
  });
  test('zero focus never counts, even with the smallest target', () => {
    Store.set((s) => {
      s.settings.goalMin = 15;
      s.settings.goalHistory = [{ day: '1970-01-01', min: 15 }];
      s.sessions = [];
    });
    eq(Store.dayGoalMet(T), false);
  });
  test('sessionMins prefers exact stopwatch seconds', () => {
    eq(Store.sessionMins({ secs: 1500, start: 0, end: 0 }), 25);
    eq(Store.sessionMins({ start: 0, end: 25 * 60000 }), 25);
    eq(Store.sessionMins(null), 0);
  });
  test('sessionMins never goes negative', () => {
    eq(Store.sessionMins({ secs: -30, start: 0, end: 0 }), 0);
    eq(Store.sessionMins({ start: 1000, end: 0 }), 0); // end before start
  });

  group('Goal history');
  test('normalizeGoalHistory sorts, dedupes and seeds an empty history', () => {
    const clean = normalizeGoalHistory(
      [{ day: '2026-11-02', min: 90 }, { day: '2026-11-01', min: 60 }, { day: '2026-11-02', min: 120 }],
      '2026-11-01',
    );
    eq(clean, [{ day: '2026-11-01', min: 60 }, { day: '2026-11-02', min: 120 }]);
    eq(normalizeGoalHistory([], '2026-11-01', 45), [{ day: '2026-11-01', min: 45 }]);
  });
  test('goalFor picks the latest entry on or before the day', () => {
    const history = [
      { day: '2026-01-01', min: 60 },
      { day: '2026-06-01', min: 120 },
    ];
    eq(goalFor(history, '2026-05-31'), 60);
    eq(goalFor(history, '2026-06-01'), 120);
    eq(goalFor(history, '2027-01-01'), 120);
  });
  test('setGoalOn appends without rewriting history', () => {
    const history = [{ day: '2026-01-01', min: 60 }];
    const next = setGoalOn(history, '2026-11-03', 150);
    eq(next, [{ day: '2026-01-01', min: 60 }, { day: '2026-11-03', min: 150 }]);
    eq(history.length, 1); // pure
  });
  test('minutesLeft and dayGoalMet handle zero and overshoot', () => {
    eq(minutesLeft(0, 120), 120);
    eq(minutesLeft(30, 120), 90);
    eq(minutesLeft(150, 120), 0);
    eq(dayGoalMet(0, 120), false);
    eq(dayGoalMet(120, 0), false);
    eq(dayGoalMet(120, 120), true);
    eq(dayGoalMet(121, 120), true);
  });
  test('goalStreak looks back from yesterday when today is short', () => {
    const history = [{ day: '1970-01-01', min: 60 }];
    const mins = { '2026-11-02': 60, '2026-11-03': 60, '2026-11-04': 0 };
    eq(goalStreak('2026-11-04', (d) => mins[d] || 0, history), 2);
  });
  test('targetDays counts only days that reached their own bar', () => {
    const history = [
      { day: '2026-01-01', min: 60 },
      { day: '2026-06-01', min: 120 },
    ];
    const mins = { '2026-05-31': 90, '2026-06-01': 90, '2026-06-02': 120 };
    eq(targetDays(Object.keys(mins), (d) => mins[d], history), 2);
  });

  group('Session rules');
  test('under 20 seconds is a free stop', () => {
    eq(freeExit(0, 20), true);
    eq(freeExit(19.9, 20), true);
    eq(freeExit(20, 20), false);
  });
  test('a block session uses the rest of its occurrence', () => {
    const start = new Date(2026, 10, 3, 6, 30).getTime();
    const end = start + 90 * 60000;
    eq(blockSessionMin(start, start, end), 90);
    eq(blockSessionMin(start + 30 * 60000, start, end), 60);
  });
  test('blockSessionMin clamps to a finishable range', () => {
    const start = new Date(2026, 10, 3, 6, 30).getTime();
    eq(blockSessionMin(start + 2 * 3600000, start, start + 90 * 60000), 5);
    eq(blockSessionMin(start - 5 * 3600000, start, start + 90 * 60000), 90);
    eq(blockSessionMin(start, start, start + 10 * 3600000), 180);
  });

  group('Daily target notifications');
  test('nudge times parse and format as HH:MM', () => {
    eq(parseNudgeAt('20:00'), 20 * 60);
    eq(parseNudgeAt('7:05'), 20 * 60); // bad input falls back to 20:00
    eq(parseNudgeAt('09:30'), 9 * 60 + 30);
    eq(nudgeAtHM(20 * 60), '20:00');
    eq(nudgeAtHM(9 * 60 + 30), '09:30');
  });
  test('nudge is due only after its time while the target remains', () => {
    eq(nudgeDue({ nowMin: 19 * 60, atMin: 20 * 60, focusMin: 0, goalMin: 120, today: '2026-11-03' }), false);
    eq(nudgeDue({ nowMin: 20 * 60, atMin: 20 * 60, focusMin: 30, goalMin: 120, today: '2026-11-03' }), true);
    eq(nudgeDue({ nowMin: 21 * 60, atMin: 20 * 60, focusMin: 120, goalMin: 120, today: '2026-11-03' }), false);
  });
  test('nudge fires once a day and never without a target', () => {
    eq(nudgeDue({ nowMin: 21 * 60, atMin: 20 * 60, focusMin: 0, goalMin: 120, lastNudgedDay: '2026-11-03', today: '2026-11-03' }), false);
    eq(nudgeDue({ nowMin: 21 * 60, atMin: 20 * 60, focusMin: 0, goalMin: 0, today: '2026-11-03' }), false);
  });
  test('nudge body reports the gap, then the win', () => {
    eq(nudgeBody(0, 120), '2h left of your 2h target. One session is enough to start.');
    eq(nudgeBody(30, 120), '30m banked · 1h 30m left of your 2h target.');
    eq(nudgeBody(120, 120), 'Target met — 2h banked today.');
  });
  test('reminder body carries the target left', () => {
    eq(reminderBody({ focusMin: 30, goalMin: 120, mins: 5 }), 'Starts in 5 min · 1h 30m left to hit today’s target.');
    eq(reminderBody({ focusMin: 120, goalMin: 120, mins: 5 }), 'Starts in 5 min · today’s target is already met.');
    eq(reminderBody({ mins: 0 }), 'Starts now.');
  });

  group('Weekly summary');
  test('weekSummary totals seven days and flags target days', () => {
    const mins = { '2026-10-28': 60, '2026-10-29': 120, '2026-10-30': 30, '2026-10-31': 0, '2026-11-01': 90, '2026-11-02': 120, '2026-11-03': 140 };
    const summary = weekSummary('2026-11-03', {
      minutesOn: (d) => mins[d] || 0,
      goalOn: () => 120,
      streak: 3,
      topTask: 'Read one chapter',
    });
    eq(summary.days.length, 7);
    eq(summary.total, 560);
    eq(summary.targetDays, 3);
    eq(summary.best.day, '2026-11-03');
    eq(summary.best.mins, 140);
    eq(summary.average, 80);
    eq(summary.streak, 3);
    eq(summary.topTask, 'Read one chapter');
  });
  test('weekSummary uses each day’s own target', () => {
    const summary = weekSummary('2026-11-03', {
      minutesOn: (d) => (d === '2026-11-02' ? 90 : 0),
      goalOn: (d) => (d === '2026-11-02' ? 60 : 120),
    });
    eq(summary.targetDays, 1);
    eq(summary.days.find((row) => row.day === '2026-11-02').met, true);
  });

  group('Screen time');
  test('records daily totals and today’s top apps', () => {
    Store.set((s) => { s.screenTime = []; });
    const day = todayKey();
    const wrote = Store.recordScreenTime(
      [{ day, ms: 90 * 60000 }, { day: addDays(day, -1), ms: 30 * 60000 }],
      [
        { package: 'com.google.android.youtube', label: 'YouTube', ms: 60 * 60000 },
        { package: 'com.android.chrome', label: 'Chrome', ms: 15 * 60000 },
      ],
    );
    eq(wrote, true);
    eq(Store.screenDay(day).mins, 90);
    eq(Store.screenDay(addDays(day, -1)).mins, 30);
    eq(Store.screenDay(day).apps.map((a) => a.label), ['YouTube', 'Chrome']);
  });
  test('an unchanged snapshot writes nothing', () => {
    const before = Store.state.screenTime;
    const day = todayKey();
    const wrote = Store.recordScreenTime(
      [{ day, ms: 90 * 60000 }],
      [
        { package: 'com.google.android.youtube', label: 'YouTube', ms: 60 * 60000 },
        { package: 'com.android.chrome', label: 'Chrome', ms: 15 * 60000 },
      ],
    );
    eq(wrote, false);
    eq(Store.state.screenTime, before); // identity: no Store.set, no sync trigger
  });
  test('Lockin never counts its own screen time', () => {
    Store.set((s) => { s.screenTime = []; });
    const day = todayKey();
    Store.recordScreenTime(
      [{ day, ms: 20 * 60000 }],
      [
        { package: 'com.lockin.app', label: 'Lockin', ms: 20 * 60000 },
        { package: 'com.android.chrome', label: 'Chrome', ms: 15 * 60000 },
      ],
    );
    eq(Store.screenDay(day).apps.map((a) => a.package), ['com.android.chrome']);
  });

  group('Schedule math');
  const TUE = new Date(2026, 10, 3, 5, 0); // Tue 3 Nov 2026, 05:00 local
  const DEEP = { id: 's1', name: 'Deep work', start: '06:30', end: '08:00', days: [2], enabled: true, alarm: true, remind: 5 };
  test('clock parsing and formatting', () => {
    eq(parseHM('06:30'), 390);
    eq(parseHM('6:30'), null);
    eq(parseHM('24:00'), null);
    eq(toHM(390), '06:30');
    eq(toHM(1439), '23:59');
  });
  test('span handles overnight and rejects zero-length', () => {
    eq(spanMin(DEEP), 90);
    eq(spanMin({ start: '23:00', end: '01:30' }), 150);
    eq(spanMin({ start: '09:00', end: '09:00' }), 0);
  });
  test('a schedule only occurs on its days and when enabled', () => {
    eq(occursOn(DEEP, TUE), true);
    eq(occursOn(DEEP, new Date(2026, 10, 4)), false);
    eq(occursOn({ ...DEEP, enabled: false }, TUE), false);
  });
  test('occurrenceOn builds local start and end dates', () => {
    const occ = occurrenceOn(DEEP, TUE);
    eq([occ.start.getHours(), occ.start.getMinutes()], [6, 30]);
    eq([occ.end.getHours(), occ.end.getMinutes()], [8, 0]);
    eq(occ.end - occ.start, 90 * 60000);
  });
  test('nextOccurrence finds the upcoming block, then the ongoing one', () => {
    const before = nextOccurrence([DEEP], TUE);
    eq([before.start.getHours(), before.start.getMinutes(), before.ongoing], [6, 30, false]);
    const during = nextOccurrence([DEEP], new Date(2026, 10, 3, 7, 0));
    eq(during.ongoing, true);
    eq(during.schedule.id, 's1');
    const after = nextOccurrence([DEEP], new Date(2026, 10, 3, 9, 0));
    eq(after.start > new Date(2026, 10, 3, 9, 0), true);
    eq(after.start.getDay(), 2); // next Tuesday
  });
  test('nextOccurrence can hide a skipped occurrence', () => {
    const skipped = nextOccurrence([DEEP], TUE, (occ) => occ.start.getDate() === 3);
    eq(skipped.ongoing, false);
    eq(skipped.start.getDate(), 10); // next Tuesday, not today's skipped one
  });
  test('eventsBetween emits the reminder and the start', () => {
    const evs = eventsBetween([DEEP], new Date(2026, 10, 3, 6, 24), new Date(2026, 10, 3, 6, 31));
    eq(evs.map((e) => e.kind), ['remind', 'start']);
    eq([evs[0].at.getHours(), evs[0].at.getMinutes()], [6, 25]);
    eq([evs[1].at.getHours(), evs[1].at.getMinutes()], [6, 30]);
  });
  test('a reminder of zero emits only the start', () => {
    const evs = eventsBetween([{ ...DEEP, remind: 0 }], new Date(2026, 10, 3, 6, 0), new Date(2026, 10, 3, 6, 31));
    eq(evs.map((e) => e.kind), ['start']);
  });
  test('occurrencesBetween keeps an overnight block after midnight', () => {
    const night = { id: 'n1', name: 'Night', start: '23:00', end: '01:30', days: [1], enabled: true };
    const from = new Date(2026, 10, 3, 0, 30); // Tuesday 00:30 — Monday's block still runs
    const to = new Date(2026, 10, 3, 2, 0);
    const occs = occurrencesBetween([night], from, to);
    eq(occs.length, 1);
    eq([occs[0].end.getHours(), occs[0].end.getMinutes()], [1, 30]);
  });
  test('occurrencesBetween excludes blocks already over and blocks beyond the horizon', () => {
    eq(occurrencesBetween([DEEP], new Date(2026, 10, 3, 9, 0), new Date(2026, 10, 3, 12, 0)).length, 0);
    const week = occurrencesBetween([DEEP], new Date(2026, 10, 3, 5, 0), new Date(2026, 10, 10, 5, 0));
    eq(week.length, 1);
    eq(week[0].start.getDay(), 2);
  });
  test('day labels read like a person wrote them', () => {
    eq(daysLabel([0, 1, 2, 3, 4, 5, 6]), 'Every day');
    eq(daysLabel([1, 2, 3, 4, 5]), 'Weekdays');
    eq(daysLabel([0, 6]), 'Weekends');
    eq(daysLabel([1, 3, 5]), 'Mon · Wed · Fri');
  });
  test('normalizeSchedule cleans untrusted input', () => {
    eq(normalizeSchedule({ start: '9:00', end: '10:00', days: [1] }), null);
    eq(normalizeSchedule({ start: '09:00', end: '09:00', days: [1] }), null);
    eq(normalizeSchedule({ start: '09:00', end: '10:00', days: [] }), null);
    const clean = normalizeSchedule({ start: '09:00', end: '10:00', days: [5, 1, 1], remind: 99 });
    eq(clean.days, [1, 5]);
    eq(clean.remind, 60);
    eq(clean.name, 'Untitled block');
    eq(normalizeSchedule({ start: '09:00', end: '10:00', days: [1] }).remind, 5);
  });

  group('Overnight blocks');
  const NIGHT = { id: 's2', name: 'Night', start: '23:00', end: '01:30', days: [1], enabled: true, alarm: true, remind: 0 };
  test('an overnight occurrence ends on the next calendar day', () => {
    const occ = occurrenceOn(NIGHT, new Date(2026, 10, 2)); // Mon 2 Nov 2026
    eq(occ.end.getDate(), 3); // ends Tuesday
    eq(occ.end - occ.start, 150 * 60000);
  });
  test('an overnight start emits its alarm inside the evening window', () => {
    const evs = eventsBetween([NIGHT], new Date(2026, 10, 2, 22, 50), new Date(2026, 10, 2, 23, 5));
    eq(evs.map((e) => e.kind), ['start']);
    eq([evs[0].at.getHours(), evs[0].at.getMinutes()], [23, 0]);
  });
  test('crossing midnight after an overnight start emits nothing twice', () => {
    const evs = eventsBetween([NIGHT], new Date(2026, 10, 2, 23, 55), new Date(2026, 10, 3, 0, 15));
    eq(evs.length, 0);
  });
  test('an overnight block is still ongoing just after midnight', () => {
    const during = nextOccurrence([NIGHT], new Date(2026, 10, 3, 0, 10)); // Tue 00:10
    eq(during.ongoing, true);
    eq(during.schedule.id, 's2');
  });
  test('normalizeSchedule keeps an overnight end as written', () => {
    eq(normalizeSchedule({ start: '23:00', end: '01:30', days: [1] }).end, '01:30');
  });

  group('Data in / out');
  test('importJSON rejects corrupted JSON and keeps the state', () => {
    const before = Store.state;
    let threw = false;
    try { Store.importJSON('{not json'); } catch (_) { threw = true; }
    eq(threw, true);
    eq(Store.state, before);
  });
  test('importJSON rejects a backup without the right version', () => {
    let threw = false;
    try { Store.importJSON(JSON.stringify({ v: 99, tasks: [] })); } catch (_) { threw = true; }
    eq(threw, true);
  });
  test('importJSON round-trips a real export', () => {
    Store.set((s) => { s.tasks = [{ id: 'tk9', date: T, title: 'Round trip', stages: [], doneAt: null }]; });
    const dump = Store.exportJSON();
    Store.reset();
    eq(Store.state.tasks.length, 0);
    Store.importJSON(dump);
    eq(Store.state.tasks.length, 1);
    eq(Store.state.tasks[0].title, 'Round trip');
  });

  group('Extension daily limits');
  test('limitMinutes defaults to zero and clamps to one day', () => {
    eq(limitMinutes({}, 'youtube.com'), 0);
    eq(limitMinutes({ 'youtube.com': 30 }, 'youtube.com'), 30);
    eq(limitMinutes({ 'youtube.com': 9999 }, 'youtube.com'), MAX_LIMIT_MIN);
    eq(limitMinutes({ 'youtube.com': -5 }, 'youtube.com'), 0);
  });
  test('usedSeconds only counts the local day', () => {
    const usage = {
      '2026-11-03': { 'youtube.com': 9999 },
      '2026-11-04': { 'youtube.com': 120 },
    };
    const now = new Date(2026, 10, 4, 12, 0, 0).getTime();
    eq(usedSeconds(usage, 'youtube.com', now), 120);
    eq(usedSeconds(usage, 'youtube.com', new Date(2026, 10, 5, 0, 1, 0).getTime()), 0);
  });
  test('isSpent is true exactly at the allowance, not before', () => {
    const limits = { 'youtube.com': 10 };
    const now = new Date(2026, 10, 4, 12, 0, 0).getTime();
    const at = (secs) => isSpent(limits, { '2026-11-04': { 'youtube.com': secs } }, 'youtube.com', now);
    eq(at(599), false);
    eq(at(600), true);
    eq(isSpent({}, { '2026-11-04': { 'youtube.com': 99999 } }, 'youtube.com', now), false);
  });
  test('spentSites skips unchecked sites and sites without a limit', () => {
    const now = new Date(2026, 10, 4, 12, 0, 0).getTime();
    const usage = { '2026-11-04': { a: 600, b: 600, c: 600 } };
    const limits = { a: 10, b: 10 };
    const off = { b: true };
    eq([...spentSites(['a', 'b', 'c'], off, limits, usage, now)], ['a']);
  });
  test('msUntilReset lands on the next local midnight', () => {
    const now = new Date(2026, 10, 4, 23, 50, 0);
    const next = new Date(now.getTime() + msUntilReset(now.getTime()));
    eq(
      [next.getFullYear(), next.getMonth(), next.getDate(), next.getHours(), next.getMinutes(), next.getSeconds()],
      [2026, 10, 5, 0, 0, 0],
    );
  });
  test('matchSite maps subdomains to the most specific configured site', () => {
    const sites = ['youtube.com', 'music.youtube.com', 'instagram.com'];
    eq(matchSite('m.youtube.com', sites), 'youtube.com');
    eq(matchSite('music.youtube.com', sites), 'music.youtube.com');
    eq(matchSite('www.instagram.com', sites), 'instagram.com');
    eq(matchSite('youtube.com.evil.test', sites), null);
    eq(matchSite('notyoutube.com', sites), null);
  });
  test('creditedSeconds clips a sleep-sized gap but keeps a normal minute', () => {
    eq(creditedSeconds(60_000), 60);
    eq(creditedSeconds(0), 0);
    eq(creditedSeconds(-5_000), 0);
    eq(creditedSeconds(8 * 60 * 60 * 1000), MAX_COMMIT_SEC);
    eq(creditedSeconds(89_400), 89);
  });

  group('Short-video matcher');
  test('matches the short feed on each supported surface', () => {
    eq(shortSurface('https://www.youtube.com/shorts/abc123')?.id, 'youtube-shorts');
    eq(shortSurface('https://m.youtube.com/shorts')?.id, 'youtube-shorts');
    eq(shortSurface('https://instagram.com/reels/')?.id, 'instagram-reels');
    eq(shortSurface('https://www.instagram.com/reel/CxYz/')?.id, 'instagram-reels');
    eq(shortSurface('https://facebook.com/reel/12345')?.id, 'facebook-reels');
    eq(shortSurface('https://www.facebook.com/reels')?.id, 'facebook-reels');
    eq(shortSurface('https://snapchat.com/spotlight/abc')?.id, 'snapchat-spotlight');
  });
  test('does not match normal pages, channel paths or lookalike hosts', () => {
    eq(shortSurface('https://www.youtube.com/watch?v=abc'), null);
    eq(shortSurface('https://youtube.com/@channel/shorts'), null);
    eq(shortSurface('https://instagram.com/p/abc'), null);
    eq(shortSurface('https://notyoutube.com/shorts/abc'), null);
    eq(shortSurface('https://youtube.com.evil.test/shorts'), null);
    eq(shortSurface('chrome://newtab'), null);
    eq(shortSurface('not a url'), null);
    eq(isShortsUrl(''), false);
  });
  test('path boundaries stop /shortsomething from matching', () => {
    eq(isShortsUrl('https://youtube.com/shortstack'), false);
    eq(isShortsUrl('https://instagram.com/reelsofsteel'), false);
    eq(isShortsUrl('https://youtube.com/shorts?feature=share'), true);
    eq(isShortsUrl('https://YOUTUBE.com/SHORTS/abc'), true);
  });
  test('surfaceForDomain finds the label shown on the blocked page', () => {
    eq(surfaceForDomain('www.youtube.com')?.label, 'YouTube Shorts');
    eq(surfaceForDomain('snapchat.com')?.label, 'Snapchat Spotlight');
    eq(surfaceForDomain('example.com'), null);
  });
  test('shortsFilters dedupes and names the surface', () => {
    const filters = shortsFilters();
    const values = filters.map((f) => f.filter);
    eq(new Set(values).size, values.length);
    eq(values.includes('||youtube.com/shorts'), true);
    eq(values.includes('||snapchat.com/spotlight'), true);
    eq(filters.find((f) => f.filter === '||instagram.com/reel')?.surface, 'instagram-reels');
    eq(SHORTS_SURFACES.length, 4);
  });

  group('Sync merge math');
  test('stableStringify is key-order insensitive', () => {
    eq(stableStringify({ a: 1, b: [2, 3] }), stableStringify({ b: [2, 3], a: 1 }));
    eq(stableStringify({ a: 1 }), '{"a":1}');
  });
  test('diffCollection finds add, change and remove', () => {
    const shadow = {
      t1: { id: 't1', title: 'A', updatedAt: 5 },
      t3: { id: 't3', title: 'C', updatedAt: 5 },
    };
    const current = [
      { id: 't1', title: 'A2', updatedAt: 5 },
      { id: 't2', title: 'B' },
    ];
    const d = diffCollection(current, shadow);
    eq(d.removedIds, ['t3']);
    eq(d.upserts.map((e) => e.id), ['t1', 't2']);
  });
  test('diffCollection is a no-op when content matches, ignoring updatedAt', () => {
    const shadow = { t1: { id: 't1', title: 'A', updatedAt: 5 } };
    const d = diffCollection([{ id: 't1', title: 'A', updatedAt: 9 }], shadow);
    eq(d.upserts, []);
    eq(d.removedIds, []);
  });
  test('diffCollection resurrects an entity the shadow holds as a tombstone', () => {
    const shadow = { t1: { id: 't1', deleted: true, updatedAt: 9 } };
    const d = diffCollection([{ id: 't1', title: 'Back' }], shadow);
    eq(d.upserts.map((e) => e.id), ['t1']);
    eq(d.removedIds, []);
  });
  test('diffScalar ignores updatedAt and flags real changes', () => {
    eq(diffScalar({ a: 1, updatedAt: 5 }, { a: 1, updatedAt: 9 }), false);
    eq(diffScalar({ a: 1 }, { a: 2 }), true);
  });
  test('mergeDocs append unions by id and never overwrites', () => {
    const local = [{ id: 's1', mins: 25 }];
    const out = mergeDocs(local, [
      { id: 's1', mins: 99, updatedAt: 9 },
      { id: 's2', mins: 45, updatedAt: 9 },
    ], 'append');
    eq(out.arr, [{ id: 's1', mins: 25 }, { id: 's2', mins: 45, updatedAt: 9 }]);
    eq([out.added, out.updated, out.deleted], [1, 0, 0]);
  });
  test('mergeDocs lww: a newer remote wins', () => {
    const out = mergeDocs(
      [{ id: 't1', title: 'old', updatedAt: 100 }],
      [{ id: 't1', title: 'new', updatedAt: 200 }],
      'lww');
    eq(out.arr[0].title, 'new');
    eq(out.updated, 1);
  });
  test('mergeDocs lww: identical content never counts as a change', () => {
    const local = [{ id: 't1', title: 'same', updatedAt: 100 }];
    const out = mergeDocs(
      local,
      [{ id: 't1', title: 'same', updatedAt: 900 }],
      'lww');
    eq(out.arr, local);       // keeps the exact object
    eq(out.updated, 0);       // so the sync engine never re-syncs it
  });
  test('mergeDocs lww: a newer local survives', () => {
    const local = [{ id: 't1', title: 'mine', updatedAt: 300 }];
    const out = mergeDocs(local, [{ id: 't1', title: 'theirs', updatedAt: 200 }], 'lww');
    eq(out.arr, local);
    eq(out.updated, 0);
  });
  test('mergeDocs lww: a tombstone removes an older local copy', () => {
    const out = mergeDocs(
      [{ id: 't1', title: 'doomed', updatedAt: 100 }],
      [{ id: 't1', deleted: true, updatedAt: 200 }],
      'lww');
    eq(out.arr, []);
    eq(out.deleted, 1);
  });
  test('mergeDocs lww: a local edit newer than the tombstone survives', () => {
    const local = [{ id: 't1', title: 'edited after', updatedAt: 300 }];
    const out = mergeDocs(local, [{ id: 't1', deleted: true, updatedAt: 200 }], 'lww');
    eq(out.arr, local);
  });
  test('mergeDocs lww: a local copy without updatedAt loses to any remote', () => {
    const out = mergeDocs(
      [{ id: 't1', title: 'fresh device' }],
      [{ id: 't1', title: 'cloud', updatedAt: 5 }],
      'lww');
    eq(out.arr[0].title, 'cloud');
  });
  test('mergeScalar keeps local when content matches, else newest wins', () => {
    const a = { name: 'Rudra', updatedAt: 5 };
    eq(mergeScalar(a, { name: 'Rudra', updatedAt: 9 }), a); // identical content, no churn
    eq(mergeScalar(a, { name: 'Other', updatedAt: 9 }).name, 'Other');
    eq(mergeScalar({ name: 'New', updatedAt: 50 }, { name: 'Old', updatedAt: 9 }).name, 'New');
    eq(mergeScalar({ name: 'A', updatedAt: 5 }, { name: 'B', updatedAt: 5 }).name, 'B'); // tie → remote
  });
  test('nextCursor advances to the largest updatedAt seen', () => {
    eq(nextCursor(10, [{ updatedAt: 3 }, { updatedAt: 42 }]), 42);
    eq(nextCursor(42, []), 42);
    eq(nextCursor(0, [{ id: 'x' }]), 0);
  });

  group('Google sign-in errors');
  test('cancellations stay silent', () => {
    eq(isCancel({ code: 'auth/popup-closed-by-user' }), true);
    eq(isCancel({ code: '12501' }), true);
    eq(isCancel(new Error('Activity cancelled.')), true);
    eq(authErrorMessage({ code: 'auth/popup-closed-by-user' }), '');
  });
  test('a disabled provider names the exact Firebase screen', () => {
    const msg = authErrorMessage({ code: 'auth/operation-not-allowed' });
    if (!msg.includes('Authentication')) throw new Error(msg);
  });
  test('an unauthorized domain is actionable', () => {
    const msg = authErrorMessage({ code: 'auth/unauthorized-domain' });
    if (!msg.includes('Authorized domains')) throw new Error(msg);
  });
  test('DEVELOPER_ERROR explains the signing certificate', () => {
    const native = authErrorMessage({ code: '10', message: '10: DEVELOPER_ERROR' }, { native: true });
    if (!native.includes('signing certificate')) throw new Error(native);
  });
  test('network failures are recognised from code or message', () => {
    eq(authErrorMessage({ code: 'auth/network-request-failed' }), authErrorMessage(new Error('Failed to fetch')));
    if (!authErrorMessage(new Error('Failed to fetch')).includes('connection')) throw new Error('no hint');
  });
  test('missing id token gets its own code', () => {
    eq(errorCodeOf({ code: 'lockin/no-id-token' }), 'lockin/no-id-token');
    if (!authErrorMessage({ code: 'lockin/no-id-token' }).includes('ID token')) throw new Error('no hint');
  });

  if (dom) {
    group('DOM factory');
    test('el() builds nodes with class, attrs, children', () => {
      const node = el('button', { class: 'chip', 'aria-label': 'go' }, 'hi', el('i', { class: 'dot' }));
      eq(node.className, 'chip');
      eq(node.getAttribute('aria-label'), 'go');
      eq(node.textContent, 'hi');
      eq(node.children.length, 1); // the <i>
    });
    test('el() wires onclick through a listener', () => {
      let fired = 0;
      const node = el('button', { class: 'chip', onclick: () => { fired += 1; } }, 'go');
      node.click();
      eq(fired, 1); // handler runs
      eq(node.onclick, null); // attached via addEventListener, never prop-assigned
    });
    test('el() parses our svg() markup strings into real SVG', () => {
      const node = el('button', { class: 'btn' }, 'Start', svg('play'));
      eq(node.children.length, 1);
      const kid = node.firstElementChild;
      eq(kid.nodeType, 1);
      eq(kid.namespaceURI, 'http://www.w3.org/2000/svg');
      eq(kid.getAttribute('viewBox'), '0 0 24 24');
      eq(kid.getAttribute('width'), '20');
    });
    test('el() keeps text that merely mentions svg as text', () => {
      const node = el('span', {}, 'says <svg><path d="x"/></svg> out loud');
      eq(node.children.length, 0); // nothing template-parsed its way into the DOM
      eq(node.textContent, 'says <svg><path d="x"/></svg> out loud');
    });
    test('el() accepts plain svg strings too (any markup is inert in a template)', () => {
      const node = el('i', {}, '<svg viewBox="0 0 8 8"></svg>');
      eq(node.children.length, 1);
      eq(node.firstElementChild.getAttribute('viewBox'), '0 0 8 8');
    });
  }
}
