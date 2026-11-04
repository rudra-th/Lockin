/* Lockin — the shared self-check suite.
   Pure-logic asserts for tasks, sessions, clean-day streaks, Strict Mode's
   accident window and schedule alarms, written once and run twice:

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
  decideAway, earnedExit, freeExit, neutralExit, parseHM, toHM, spanMin,
  occursOn, occurrenceOn, occurrencesBetween, nextOccurrence, eventsBetween, daysLabel,
  normalizeSchedule, el,
} from './util.js';
import { examById, examDateFor, expectedYear } from './exams.js';
import { svg } from './icons.js';
import {
  stableStringify, diffCollection, diffScalar, mergeDocs, mergeScalar, nextCursor,
} from '../../core/sync.js';
import {
  MAX_LIMIT_MIN, limitMinutes, usedSeconds, isSpent, spentSites, msUntilReset,
} from '../../core/limits.js';

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

  /* The clean-day tests rewrite sessions and slips directly, so they run
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

  group('Clean days & streaks');
  const T = todayKey();
  const Y = addDays(T, -1), Y2 = addDays(T, -2);
  const mkSession = (day, mins, { completed = true } = {}) => ({
    id: `t_${day}_${mins}`, day, start: Date.now() - mins * 60000, end: Date.now(),
    kind: 'focus', completed, taskIds: [],
  });
  test('no focus → not clean', () => {
    Store.set((s) => { s.sessions = []; s.slips = []; s.settings.minClean = 15; });
    eq(Store.dayClean(T), false);
  });
  test('focus ≥ minimum, no slips → clean', () => {
    Store.set((s) => { s.sessions = [mkSession(T, 30)]; s.slips = []; });
    eq(Store.dayClean(T), true);
    eq(Store.focusMinutesOn(T), 30);
  });
  test('a slip breaks the clean day', () => {
    Store.set((s) => { s.slips = [{ id: 'sl1', day: T, kind: 'slip', awaySec: 40, sessId: null, ts: Date.now() }]; });
    eq(Store.dayClean(T), false);
  });
  test('streak counts yesterday + day before', () => {
    Store.set((s) => {
      s.sessions = [mkSession(Y, 30), mkSession(Y2, 30)];
      s.slips = [];
    });
    eq(Store.dayClean(Y), true);
    eq(Store.streakUpTo(T), 2); // today is in progress, not yet counted
  });
  test('streak stops at the first broken day', () => {
    Store.set((s) => {
      s.sessions = [mkSession(Y, 30), mkSession(Y2, 30)];
      s.slips = [{ id: 'sl2', day: Y, kind: 'abandon', awaySec: 0, sessId: null, ts: Date.now() }];
    });
    eq(Store.streakUpTo(T), 0);
  });
  test('abort keeps minutes but breaks cleanliness', () => {
    Store.set((s) => {
      s.sessions = [{ ...mkSession(T, 20), completed: false }];
      s.slips = [{ id: 'sl3', day: T, kind: 'abandon', awaySec: 0, sessId: null, ts: Date.now() }];
    });
    eq(Store.focusMinutesOn(T), 20);
    eq(Store.dayClean(T), false);
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

  group('Strict Mode accident window');
  test('≤10s away is a rescue when rescues remain', () => {
    eq(decideAway({ awaySec: 3, usedRescues: 0 }), 'rescue');
    eq(decideAway({ awaySec: 10, usedRescues: 2, graceSec: 10, cap: 3 }), 'rescue'); // boundary
  });
  test('>10s away is a slip', () => {
    eq(decideAway({ awaySec: 10.5, usedRescues: 0 }), 'slip');
    eq(decideAway({ awaySec: 600, usedRescues: 0 }), 'slip');
  });
  test('rescue cap exhausted → even 1s away is a slip', () => {
    eq(decideAway({ awaySec: 2, usedRescues: 3 }), 'slip');
    eq(decideAway({ awaySec: 2, usedRescues: 4 }), 'slip');
  });
  test('grace/cap are configurable', () => {
    eq(decideAway({ awaySec: 20, usedRescues: 9, graceSec: 25, cap: 10 }), 'rescue');
  });

  group('Earned exit');
  test('under the 15m bar is not earned', () => {
    eq(earnedExit(899, 15), false);
  });
  test('exactly 15m is earned', () => {
    eq(earnedExit(900, 15), true);
  });
  test('hours of work are earned', () => {
    eq(earnedExit(3600, 15), true);
  });
  test('off (0) never earns an exit', () => {
    eq(earnedExit(3600, 0), false);
    eq(earnedExit(3600, null), false);
  });
  test('a custom bar moves both edges', () => {
    eq(earnedExit(1799, 30), false);
    eq(earnedExit(1800, 30), true);
  });
  test('under 20 seconds is a free stop', () => {
    eq(freeExit(0, 20), true);
    eq(freeExit(19.9, 20), true);
    eq(freeExit(20, 20), false);
  });
  test('the 20-second window works even with earned exit off', () => {
    eq(neutralExit(5, 0), true);
    eq(neutralExit(20, 0), false);
  });
  test('between 20 seconds and the bar is still a slip', () => {
    eq(neutralExit(20, 15), false);
    eq(neutralExit(899, 15), false);
    eq(neutralExit(900, 15), true);
  });
  test('exitGraceMin defaults to 15', () => {
    eq(Store.state.settings.exitGraceMin, 15);
  });
  test('an earned end keeps the day clean', () => {
    Store.set((s) => {
      s.sessions = [{ ...mkSession(T, 21), completed: false, earned: true }];
      s.slips = [];
      s.settings.minClean = 15;
    });
    eq(Store.focusMinutesOn(T), 21);
    eq(Store.dayClean(T), true);
  });
  test('earned exit does not fake a clean day below the minimum', () => {
    Store.set((s) => {
      s.sessions = [{ ...mkSession(T, 5), completed: false, earned: true }];
      s.slips = [];
      s.settings.minClean = 15;
    });
    eq(Store.dayClean(T), false);
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
