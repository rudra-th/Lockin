import { todayKey, addDays, normalizeSchedule } from './util.js';

const KEY = 'lockin.store.v1';
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
    slips: [],
    profile: { name: '', exam: '', examId: '', examDate: '' }, // filled by the opening film
    settings: {
      theme: 'system',
      strict: true,
      wakelock: true,
      notifs: false,
      goalMin: 120,
      minClean: 15,
      exitGraceMin: 15,
      scheduleAlarms: true,
      alarmSound: true,
      alarmVibrate: true,
      remindDefault: 5,
      pomo: { focus: 25, short: 5, long: 15 },
    },
    session: null, // live-session runtime snapshot (see focus.js)
    flags: {
      onboarded: false,
    },
  };
}

function migrate(raw) {
  if (!raw || typeof raw !== 'object' || raw.v !== VERSION) return null;
  raw.profile = raw.profile || {}; // v1 stores predate the opening film
  if (typeof raw.profile.name !== 'string') raw.profile.name = '';
  if (typeof raw.profile.exam !== 'string') raw.profile.exam = '';
  if (typeof raw.profile.examId !== 'string') raw.profile.examId = '';
  if (typeof raw.profile.examDate !== 'string') raw.profile.examDate = '';

  /* Demo sessions are gone from the product. Old ones were explicitly
     excluded from every statistic, so drop them instead of letting the
     removed flag make them count as real focus. */
  raw.sessions = (raw.sessions || []).filter((s) => !s.demo);
  raw.sessions.forEach((s) => { delete s.demo; });
  raw.flags = raw.flags || {};
  delete raw.flags.seeded;

  /* v1.3: real work buys an honest exit. Default 15 min; 0 keeps the old rule. */
  raw.settings = raw.settings || {};
  if (typeof raw.settings.exitGraceMin !== 'number') raw.settings.exitGraceMin = 15;

  /* v1.4: recurring schedule blocks with per-block alarms. */
  raw.schedules = (Array.isArray(raw.schedules) ? raw.schedules : [])
    .map(normalizeSchedule)
    .filter(Boolean);
  raw.schedules.forEach((s) => { if (!s.id) s.id = uid('sch'); });
  if (typeof raw.settings.scheduleAlarms !== 'boolean') raw.settings.scheduleAlarms = true;
  if (typeof raw.settings.alarmSound !== 'boolean') raw.settings.alarmSound = true;
  if (typeof raw.settings.alarmVibrate !== 'boolean') raw.settings.alarmVibrate = true;
  if (typeof raw.settings.remindDefault !== 'number') raw.settings.remindDefault = 5;
  return raw;
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
    this.state = parsed || blankState();
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
    this.set((st) => { st.schedules = st.schedules.filter((s) => s.id !== id); });
  },

  toggleSchedule(id) {
    this.set((st) => {
      const s = st.schedules.find((x) => x.id === id);
      if (s) s.enabled = !s.enabled;
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
      // aborted sessions keep their minutes — time actually spent is honest —
      // they just never make the day clean (dayClean also demands zero slips)
      if (sess.day !== dateKey) continue;
      mins += this.sessionMins(sess);
    }
    return Math.round(mins);
  },

  slipCountsOn(dateKey) {
    const counts = { slip: 0, rescue: 0, abandon: 0 };
    for (const sl of this.state.slips) {
      if (sl.day === dateKey) counts[sl.kind] += 1;
    }
    return counts;
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

  /** A day is "clean" when real focus happened and nothing was broken. */
  dayClean(dateKey) {
    const c = this.slipCountsOn(dateKey);
    return this.focusMinutesOn(dateKey) >= this.state.settings.minClean &&
      c.slip === 0 && c.abandon === 0;
  },

  /** Consecutive clean days, ending today if today already qualifies. */
  streakUpTo(dateKey) {
    let streak = 0;
    let cursor = dateKey;
    if (!this.dayClean(cursor)) cursor = addDays(cursor, -1); // today still in progress
    while (this.dayClean(cursor)) {
      streak += 1;
      cursor = addDays(cursor, -1);
    }
    return streak;
  },

  logSlip(kind, sessId, awaySec, dayKey) {
    const entry = { id: uid('sl'), ts: Date.now(), day: dayKey || todayKey(),
      kind, sessId: sessId || null, awaySec: Math.round(awaySec || 0) };
    this.set((s) => s.slips.push(entry));
    return entry;
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
    this.state = blankState();
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
