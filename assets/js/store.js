import { todayKey, addDays } from './util.js';

const KEY = 'lockin.store.v1';
const VERSION = 1;

export const GENERIC_HUES = {
  sleep: 250,
  rest: 185,
  meal: 60,
  free: 285,
};

// Rotating hue assignment for study subjects — stays clear of the accent
// lime (82) and the generic kinds so chips/blocks are always distinguishable.
const SUBJECT_HUES = [200, 265, 330, 25, 150, 45, 220, 15, 100, 310];

function uid(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function blankState(subjects = []) {
  return {
    v: VERSION,
    createdAt: Date.now(),
    activities: [
      { id: 'sleep', name: 'Sleep', kind: 'sleep', hue: GENERIC_HUES.sleep },
      { id: 'rest',  name: 'Rest',  kind: 'rest',  hue: GENERIC_HUES.rest },
      { id: 'meal',  name: 'Meals', kind: 'meal',  hue: GENERIC_HUES.meal },
      { id: 'free',  name: 'Free',  kind: 'free',  hue: GENERIC_HUES.free },
      ...subjects.map((name, i) => ({ id: uid('act'), name, kind: 'study', hue: SUBJECT_HUES[i % SUBJECT_HUES.length] })),
    ],
    tasks: [],
    plans: {},
    sessions: [],
    slips: [],
    settings: {
      theme: 'system',
      strict: true,
      wakelock: true,
      sounds: true,
      volume: 0.6,
      soundKind: 'rain',
      notifs: false,
      goalMin: 120,
      minClean: 15,
      pomo: { focus: 25, short: 5, long: 15 },
    },
    session: null, // live-session runtime snapshot (see focus.js)
    flags: {
      onboarded: false,
      seeded: false,
    },
  };
}

function migrate(raw) {
  if (!raw || typeof raw !== 'object' || raw.v !== VERSION) return null;
  return raw;
}

const Store = {
  state: null,

  load() {
    let parsed = null;
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
    } catch (err) {
      console.warn('Lockin could not save data:', err);
    }
  },

  /* one mutator per change — every write hits storage immediately */
  set(fn) {
    fn(this.state);
    this.persist();
    document.dispatchEvent(new CustomEvent('lockin:changed'));
  },

  /* ---------- activities / subjects ---------- */
  activity(id) {
    return this.state.activities.find((a) => a.id === id) || null;
  },

  subjects() {
    return this.state.activities.filter((a) => a.kind === 'study');
  },

  addSubject(name) {
    const hue = SUBJECT_HUES[this.subjects().length % SUBJECT_HUES.length];
    const act = { id: uid('act'), name: name.trim().slice(0, 24), kind: 'study', hue };
    this.set((s) => s.activities.push(act));
    return act;
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
  focusMinutesOn(dateKey) {
    let mins = 0;
    for (const sess of this.state.sessions) {
      if (!sess.completed || sess.kind !== 'focus' || sess.demo) continue;
      if (sess.day === dateKey) {
        mins += Math.max(0, Math.round((sess.end - sess.start) / 60000));
      }
    }
    return mins;
  },

  slipCountsOn(dateKey) {
    const counts = { slip: 0, rescue: 0, abandon: 0 };
    for (const sl of this.state.slips) {
      if (sl.day === dateKey) counts[sl.kind] += 1;
    }
    return counts;
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

  subjectMinutes(dateKey, days = 7) {
    const map = new Map();
    const cutoff = addDays(dateKey, -(days - 1));
    for (const sess of this.state.sessions) {
      if (!sess.completed || sess.kind !== 'focus' || sess.demo) continue;
      if (sess.day < cutoff || sess.day > dateKey) continue;
      const key = sess.subjId || 'free';
      map.set(key, (map.get(key) || 0) + (sess.end - sess.start) / 60000);
    }
    return map;
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
    this.state = blankState(); // seeded=false → the walkthrough re-seeds its sample day
    this.persist();
    document.dispatchEvent(new CustomEvent('lockin:changed'));
  },
};

export { Store, KEY, VERSION, uid };
