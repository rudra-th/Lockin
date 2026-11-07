import { todayKey, addDays, normalizeSchedule } from './util.js';
import { isTrial, TRIAL_KEY, trialSeed } from './trial.js';
import {
  DEFAULT_GOAL_MIN, normalizeGoalHistory, goalFor as goalAt, dayGoalMet,
  goalStreak, targetDays, setGoalOn, minutesLeft,
} from '../../core/goal.js';
import { DEFAULT_NUDGE_AT } from '../../core/notify.js';

const KEY = isTrial ? TRIAL_KEY : 'lockin.store.v1';
const VERSION = 1;

export const GENERIC_HUES = {
  sleep: 250,
  rest: 185,
  meal: 60,
  free: 285,
};

function uid(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function screenAppsKey(apps) {
  return (apps || []).map((a) => `${a.package}:${a.label}:${a.mins}`).join('|');
}

/* Lockin is the study surface, not part of the phone the student is
   measuring. Its own package never appears in usage rows. */
const SELF_PACKAGES = new Set(['com.lockin.app']);

function blankState() {
  return {
    v: VERSION,
    createdAt: Date.now(),
    activities: [
      { id: 'sleep', name: 'Sleep', kind: 'sleep', hue: GENERIC_HUES.sleep },
      { id: 'rest',  name: 'Rest',  kind: 'rest',  hue: GENERIC_HUES.rest },
      { id: 'meal',  name: 'Meals', kind: 'meal',  hue: GENERIC_HUES.meal },
      { id: 'free',  name: 'Free',  kind: 'free',  hue: GENERIC_HUES.free },
    ],
    tasks: [],
    plans: {},
    schedules: [],
    sessions: [],
    blockSkips: [], // { id, scheduleId, day, ts } — a dismissed occurrence
    screenTime: [], // daily phone usage: { id, day, mins, apps: [{package,label,mins}] }
    profile: { name: '', email: '', exam: '', examId: '', examDate: '' }, // filled by the opening film
    settings: {
      theme: 'dark',
      wakelock: true,
      notifs: false,
      goalMin: DEFAULT_GOAL_MIN,
      goalHistory: [{ day: todayKey(), min: DEFAULT_GOAL_MIN }],
      nudge: true,
      nudgeAt: DEFAULT_NUDGE_AT,
      scheduleAlarms: true,
      alarmSound: true,
      alarmVibrate: true,
      remindDefault: 5,
      pomo: { focus: 25, short: 5, long: 15 },
      kiosk: false,
    },
    session: null, // live-session runtime snapshot (see focus.js)
    flags: {
      onboarded: false,
    },
  };
}

function cleanBlockSkips(raw) {
  const cutoff = addDays(todayKey(), -14);
  const map = new Map();
  for (const row of Array.isArray(raw) ? raw : []) {
    if (!row || typeof row !== 'object') continue;
    const scheduleId = String(row.scheduleId || '').trim();
    const day = String(row.day || '');
    if (!scheduleId || !/^\d{4}-\d{2}-\d{2}$/.test(day) || day < cutoff) continue;
    map.set(`${scheduleId}_${day}`, {
      id: `${scheduleId}_${day}`,
      scheduleId,
      day,
      ts: Number(row.ts) || Date.now(),
    });
  }
  return [...map.values()].sort((a, b) => a.day.localeCompare(b.day));
}

function migrate(raw) {
  if (!raw || typeof raw !== 'object' || raw.v !== VERSION) return null;
  raw.profile = raw.profile || {}; // v1 stores predate the opening film
  if (typeof raw.profile.name !== 'string') raw.profile.name = '';
  if (typeof raw.profile.email !== 'string') raw.profile.email = '';
  if (typeof raw.profile.exam !== 'string') raw.profile.exam = '';
  if (typeof raw.profile.examId !== 'string') raw.profile.examId = '';
  if (typeof raw.profile.examDate !== 'string') raw.profile.examDate = '';

  /* Demo sessions are gone from the product. Old ones were explicitly
     excluded from every statistic, so drop them instead of letting the
     removed flag make them count as real focus. */
  raw.sessions = (raw.sessions || []).filter((s) => !s.demo);
  raw.sessions.forEach((s) => {
    delete s.demo;
    delete s.earned; // the old exit marker no longer means anything
    if (s.aborted) s.completed = false;
  });

  /* v1.14: the old honesty mechanic is gone. Remove the old slice
     outright — there is no archive and nothing reads it. */
  delete raw.slips;

  raw.settings = raw.settings || {};

  /* v1.13: daily phone screen time travels with the store so the browser
     extension can show the same week the phone measured. */
  raw.screenTime = Array.isArray(raw.screenTime)
    ? raw.screenTime
      .filter((row) => row && typeof row.day === 'string' && row.day)
      .map((row) => ({
        id: row.day,
        day: row.day,
        mins: Math.max(0, Math.round(Number(row.mins) || 0)),
        apps: Array.isArray(row.apps)
          ? row.apps
            .filter((a) => a && typeof a.label === 'string')
            .map((a) => ({
              package: String(a.package || ''),
              label: a.label,
              mins: Math.max(0, Math.round(Number(a.mins) || 0)),
            }))
            .filter((a) => a.mins > 0)
          : [],
      }))
    : [];
  raw.flags = raw.flags || {};
  delete raw.flags.seeded;

  /* v1.14: the target replaces the old minimum. The target is
     versioned, so a change today cannot rewrite yesterday's bar. */
  delete raw.settings.strict;
  delete raw.settings.minClean;
  delete raw.settings.exitGraceMin;
  const goalMin = Math.max(1, Math.min(1440, Math.round(Number(raw.settings.goalMin) || DEFAULT_GOAL_MIN)));
  raw.settings.goalMin = goalMin;
  const createdDay = (() => {
    const d = new Date(Number(raw.createdAt) || Date.now());
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  })();
  raw.settings.goalHistory = normalizeGoalHistory(raw.settings.goalHistory, createdDay, goalMin);

  /* v1.4: recurring schedule blocks with per-block alarms. */
  raw.schedules = (Array.isArray(raw.schedules) ? raw.schedules : [])
    .map(normalizeSchedule)
    .filter(Boolean);
  raw.schedules.forEach((s) => { if (!s.id) s.id = uid('sch'); });
  if (typeof raw.settings.scheduleAlarms !== 'boolean') raw.settings.scheduleAlarms = true;
  if (typeof raw.settings.alarmSound !== 'boolean') raw.settings.alarmSound = true;
  if (typeof raw.settings.alarmVibrate !== 'boolean') raw.settings.alarmVibrate = true;
  if (typeof raw.settings.remindDefault !== 'number') raw.settings.remindDefault = 5;

  /* v1.14: a daily target nudge and skip-today alarms. */
  if (typeof raw.settings.nudge !== 'boolean') raw.settings.nudge = true;
  if (typeof raw.settings.nudgeAt !== 'number') raw.settings.nudgeAt = DEFAULT_NUDGE_AT;
  raw.blockSkips = cleanBlockSkips(raw.blockSkips);

  /* v1.11: strict sessions can pin the phone into a kiosk (Android). */
  if (typeof raw.settings.kiosk !== 'boolean') raw.settings.kiosk = false;
  return raw;
}

/* The trial uses the same shape as a real store, but starts with a believable
   week so Progress, Home and the weekly card have something to show. It still
   goes through migrate() so schedule ids and defaults match the app. */
function seededState() {
  if (!isTrial) return blankState();
  const seed = trialSeed();
  const base = blankState();
  return migrate({
    ...base,
    ...seed,
    activities: [...base.activities, ...(seed.activities || [])],
    profile: { ...base.profile, ...(seed.profile || {}) },
    settings: { ...base.settings, ...(seed.settings || {}) },
    flags: { ...base.flags, ...(seed.flags || {}) },
  }) || base;
}

let storageWasFull = false;

const Store = {
  state: null,

  load() {
    let parsed;
    try {
      parsed = migrate(JSON.parse(localStorage.getItem(KEY) || 'null'));
    } catch (_) {
      parsed = null;
    }
    this.state = parsed || seededState();
    return this.state;
  },

  persist() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.state));
      storageWasFull = false;
    } catch (err) {
      /* The state stays live in memory, so the app keeps working; the UI
         hears about it once per episode and can ask for a backup. */
      if (!storageWasFull) {
        storageWasFull = true;
        document.dispatchEvent(new CustomEvent('lockin:storage-full'));
      }
      console.warn('Lockin could not save data:', err);
    }
  },

  /* one mutator per change — every write hits storage immediately */
  set(fn) {
    fn(this.state);
    this.persist();
    document.dispatchEvent(new CustomEvent('lockin:changed'));
  },

  /* ---------- activities ---------- */
  activity(id) {
    return this.state.activities.find((a) => a.id === id) || null;
  },

  /* ---------- schedules ---------- */

  /** Recurring blocks, earliest first. */
  schedules() {
    return this.state.schedules.slice().sort((a, b) => a.start.localeCompare(b.start));
  },

  schedule(id) {
    return this.state.schedules.find((s) => s.id === id) || null;
  },

  /** Create or update from a plain object; returns the schedule id. */
  saveSchedule(input) {
    const clean = normalizeSchedule(input);
    if (!clean) return null;
    if (clean.id && this.schedule(clean.id)) {
      this.set((st) => {
        const i = st.schedules.findIndex((s) => s.id === clean.id);
        if (i >= 0) st.schedules[i] = { ...st.schedules[i], ...clean };
      });
      return clean.id;
    }
    clean.id = uid('sch');
    this.set((st) => st.schedules.push(clean));
    return clean.id;
  },

  deleteSchedule(id) {
    this.set((st) => {
      st.schedules = st.schedules.filter((s) => s.id !== id);
      st.blockSkips = (st.blockSkips || []).filter((row) => row.scheduleId !== id);
    });
  },

  toggleSchedule(id) {
    this.set((st) => {
      const s = st.schedules.find((x) => x.id === id);
      if (s) s.enabled = !s.enabled;
    });
  },

  /* ---------- skipped occurrences ---------- */

  isBlockSkipped(scheduleId, day) {
    return (this.state.blockSkips || []).some((row) => row.scheduleId === scheduleId && row.day === day);
  },

  skipBlock(scheduleId, day) {
    if (!scheduleId || !day) return;
    this.set((st) => {
      if (!Array.isArray(st.blockSkips)) st.blockSkips = [];
      if (st.blockSkips.some((row) => row.scheduleId === scheduleId && row.day === day)) return;
      st.blockSkips.push({ id: `${scheduleId}_${day}`, scheduleId, day, ts: Date.now() });
    });
  },

  unskipBlock(scheduleId, day) {
    this.set((st) => {
      st.blockSkips = (st.blockSkips || []).filter((row) => !(row.scheduleId === scheduleId && row.day === day));
    });
  },

  /* ---------- day grid ---------- */
  blocks(dateKey) {
    return (this.state.plans[dateKey] || []).slice().sort((a, b) => a.s - b.s);
  },

  /**
   * Paint actId over slots [s, e): clears anything already there (splitting
   * neighbouring blocks cleanly), then merges same-activity neighbours.
   * Pure — callers run it inside Store.set.
   */
  paint(list, actId, s, e) {
    s = Math.max(0, Math.min(47, s));
    e = Math.max(s + 1, Math.min(48, e));
    const survivors = [];
    for (const b of list || []) {
      if (b.e <= s || b.s >= e) { survivors.push(b); continue; }
      // overlap: clip the block; keep fragments outside the painted range
      if (b.s < s) survivors.push({ ...b, e: s });
      if (b.e > e) survivors.push({ ...b, s: e });
    }
    survivors.push({ id: uid('blk'), actId, s, e });
    survivors.sort((a, b) => a.s - b.s);
    // merge neighbours with the same activity
    const merged = [];
    for (const b of survivors) {
      const prev = merged[merged.length - 1];
      if (prev && prev.actId === b.actId && prev.e === b.s) prev.e = b.e;
      else merged.push(b);
    }
    return merged;
  },

  erode(list, s, e) {
    s = Math.max(0, Math.min(47, s));
    e = Math.max(s + 1, Math.min(48, e));
    const next = [];
    for (const b of list || []) {
      if (b.e <= s || b.s >= e) { next.push(b); continue; }
      if (b.s < s) next.push({ ...b, e: s });
      if (b.e > e) next.push({ ...b, s: e });
    }
    return next;
  },

  replaceRange(dateKey, list) {
    this.set((st) => {
      if (list.length) st.plans[dateKey] = list;
      else delete st.plans[dateKey];
    });
  },

  dayStats(dateKey) {
    const tally = { study: 0, sleep: 0, rest: 0, meal: 0, free: 0, other: 0 };
    let covered = 0;
    for (const b of this.blocks(dateKey)) {
      const act = this.activity(b.actId);
      const mins = (b.e - b.s) * 30;
      tally[act ? act.kind : 'other'] += mins;
      covered += mins;
    }
    return { tally, covered, unplanned: 1440 - covered };
  },

  /* ---------- tasks ---------- */
  tasksOn(dateKey) {
    return this.state.tasks.filter((t) => t.date === dateKey);
  },

  openTasks(dateKey) {
    return this.state.tasks.filter((t) => t.date === dateKey && !t.doneAt);
  },

  /* ---------- sessions ---------- */

  /** minutes a session actually banked — stopwatch seconds win over wall clock */
  sessionMins(sess) {
    if (!sess) return 0;
    const mins = sess.secs != null
      ? sess.secs / 60
      : Math.max(0, (sess.end - sess.start) / 60000);
    return Number.isFinite(mins) ? Math.max(0, mins) : 0;
  },

  focusMinutesOn(dateKey) {
    let mins = 0;
    for (const sess of this.state.sessions) {
      if (sess.kind !== 'focus') continue;
      if (sess.day !== dateKey) continue;
      mins += this.sessionMins(sess);
    }
    return Math.round(mins);
  },

  setProfile(name, exam, examDate = '', examId = '') {
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(examDate || '')) ? examDate : '';
    this.set((s) => {
      s.profile.name = String(name || '').trim().slice(0, 24);
      s.profile.exam = String(exam || '').trim().slice(0, 28);
      s.profile.examDate = date;
      s.profile.examId = String(examId || '').trim().slice(0, 24);
    });
  },

  /* ---------- daily target ---------- */

  goalHistory() {
    return this.state.settings.goalHistory || [];
  },

  /** Target in force on a day (defaults to today). */
  goalFor(day = todayKey()) {
    return goalAt(this.goalHistory(), day, this.state.settings.goalMin || DEFAULT_GOAL_MIN);
  },

  /** Today's target — the number the ring and the nudge use. */
  goalToday() {
    return this.goalFor(todayKey());
  },

  goalLeft(day = todayKey()) {
    return minutesLeft(this.focusMinutesOn(day), this.goalFor(day));
  },

  dayGoalMet(day) {
    return dayGoalMet(this.focusMinutesOn(day), this.goalFor(day));
  },

  goalStreak(day = todayKey()) {
    return goalStreak(day, (d) => this.focusMinutesOn(d), this.goalHistory(), this.state.settings.goalMin || DEFAULT_GOAL_MIN);
  },

  targetDaysBetween(days) {
    return targetDays(days, (d) => this.focusMinutesOn(d), this.goalHistory(), this.state.settings.goalMin || DEFAULT_GOAL_MIN);
  },

  /** Change the target from today onward; past days keep their own bar. */
  setGoal(min) {
    const day = todayKey();
    this.set((s) => {
      s.settings.goalMin = Math.max(1, Math.min(1440, Math.round(Number(min) || DEFAULT_GOAL_MIN)));
      s.settings.goalHistory = setGoalOn(s.settings.goalHistory, day, s.settings.goalMin);
    });
  },

  /* ---------- screen time ---------- */

  /** One stored day, or null. */
  screenDay(dateKey) {
    return (this.state.screenTime || []).find((row) => row.day === dateKey) || null;
  },

  /**
   * Fold a native usage snapshot into the store: daily totals plus each day's
   * top apps. Identical snapshots write nothing, so a foreground app cannot
   * keep the sync engine awake. `todayApps` is the fallback for platforms or
   * older builds that only report today's per-app rows. Returns true when
   * something changed.
   */
  recordScreenTime(days, todayApps) {
    if (isTrial || !Array.isArray(days) || !days.length) return false;
    const today = todayKey();
    const now = Date.now();
    const normApps = (list) => (list || [])
      .map((a) => ({
        package: String(a.package || ''),
        label: String(a.label || a.package || '').slice(0, 48),
        mins: Math.max(0, Math.round((Number(a.ms) || 0) / 60000)),
      }))
      .filter((a) => a.label && a.mins > 0 && !SELF_PACKAGES.has(a.package))
      .sort((a, b) => b.mins - a.mins)
      .slice(0, 6);
    const fallback = normApps(todayApps);

    const byId = new Map((this.state.screenTime || []).map((row) => [row.day, row]));
    let changed = false;
    for (const row of days) {
      if (!row || typeof row.day !== 'string' || !row.day) continue;
      const prev = byId.get(row.day);
      const mins = Math.max(0, Math.round((Number(row.ms) || 0) / 60000));
      const nextApps = Array.isArray(row.apps)
        ? normApps(row.apps)
        : row.day === today
          ? fallback
          : (prev?.apps || []);
      const same = prev
        && prev.mins === mins
        && screenAppsKey(prev.apps) === screenAppsKey(nextApps);
      if (same) continue;
      byId.set(row.day, {
        id: row.day, day: row.day, mins, apps: nextApps, updatedAt: now,
      });
      changed = true;
    }
    if (!changed) return false;

    const cutoff = addDays(today, -31);
    for (const day of [...byId.keys()]) if (day < cutoff) byId.delete(day);
    const next = [...byId.values()].sort((a, b) => a.day.localeCompare(b.day));
    this.set((s) => { s.screenTime = next; });
    return true;
  },

  /* ---------- data hygiene ---------- */
  exportJSON() {
    return JSON.stringify(this.state, null, 2);
  },

  importJSON(text) {
    const parsed = migrate(JSON.parse(text));
    if (!parsed) throw new Error('Not a Lockin v1 backup');
    this.state = parsed;
    this.persist();
    document.dispatchEvent(new CustomEvent('lockin:changed'));
  },

  reset() {
    this.state = seededState();
    this.persist();
    document.dispatchEvent(new CustomEvent('lockin:changed'));
  },
};

Store.load();

/* Cross-tab convergence: another open tab may write the store (live-session
   snapshots, settings flips). Adopt newer writes wholesale so two tabs share
   one source of truth instead of blitting stale copies over each other. */
self.addEventListener('storage', (ev) => {
  if (ev.key !== null && ev.key !== KEY) return; // null key = clear()
  let next;
  try { next = migrate(JSON.parse(ev.newValue || 'null')); } catch (_) { return; }
  if (!next) return;
  if (JSON.stringify(next) === JSON.stringify(Store.state)) return; // no-op echo
  Store.state = next;
  document.dispatchEvent(new CustomEvent('lockin:changed'));
});

export { Store, KEY, VERSION, uid };
