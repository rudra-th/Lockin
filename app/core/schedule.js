/* Lockin core — pure schedule math.
   A schedule is a recurring local-time block:

     { id, name, start: '06:30', end: '08:00', days: [1,2,3,4,5],
       enabled: true, alarm: true, remind: 5 }

   days are 0=Sunday … 6=Saturday. end < start crosses midnight.
   No DOM, no storage, no timezone library: this file is shared by the web
   app, the browser extension and the Android shell. */

import { fmtMin } from './time.js';

export const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const WEEKDAYS = [1, 2, 3, 4, 5];
export const WEEKEND = [0, 6];

/** "HH:MM" → minutes after midnight, or null when malformed. */
export function parseHM(value) {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(value || '').trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** minutes after midnight → "HH:MM" (clamped to a day). */
export function toHM(minutes) {
  const m = Math.max(0, Math.min(1439, Math.round(minutes || 0)));
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** Length of one occurrence in minutes; 0 when the times are unusable. */
export function spanMin(schedule) {
  const start = parseHM(schedule?.start);
  const end = parseHM(schedule?.end);
  if (start == null || end == null || start === end) return 0;
  return end > start ? end - start : end + 1440 - start;
}

/** Does the block begin on this local calendar day? */
export function occursOn(schedule, date) {
  if (!schedule || schedule.enabled === false) return false;
  if (spanMin(schedule) <= 0) return false;
  return Array.isArray(schedule.days) && schedule.days.includes(date.getDay());
}

/** Concrete start/end Dates for the occurrence that begins on `date`. */
export function occurrenceOn(schedule, date) {
  if (!occursOn(schedule, date)) return null;
  const startMin = parseHM(schedule.start);
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate(),
    Math.floor(startMin / 60), startMin % 60, 0, 0);
  const end = new Date(start.getTime() + spanMin(schedule) * 60000);
  return { schedule, start, end };
}

/** All occurrences that begin on `date`, earliest first. */
export function occurrencesOn(schedules, date) {
  return (schedules || [])
    .map((s) => occurrenceOn(s, date))
    .filter(Boolean)
    .sort((a, b) => a.start - b.start);
}

/**
 * The next block to care about: an ongoing one wins, otherwise the nearest
 * future start within the next eight days.
 */
export function nextOccurrence(schedules, now = new Date()) {
  let ongoing = null;
  let upcoming = null;

  for (const schedule of schedules || []) {
    if (!schedule || schedule.enabled === false) continue;

    for (const offset of [-1, 0]) {
      const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
      const occ = occurrenceOn(schedule, day);
      if (!occ) continue;
      if (occ.start <= now && now < occ.end) {
        if (!ongoing || occ.start > ongoing.start) ongoing = { ...occ, ongoing: true };
      }
    }

    for (let offset = 0; offset <= 8; offset += 1) {
      const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
      const occ = occurrenceOn(schedule, day);
      if (!occ || occ.start <= now) continue;
      if (!upcoming || occ.start < upcoming.start) upcoming = { ...occ, ongoing: false };
    }
  }

  return ongoing || upcoming;
}

/** When the "five minutes before" reminder should fire; null when off. */
export function reminderAt(occ, minutes) {
  if (!occ || !minutes) return null;
  return new Date(occ.start.getTime() - minutes * 60000);
}

/**
 * Alarm events between two instants, inclusive of `from`, exclusive of `to`.
 * Used by the web alarm loop and by the Android bridge to seed its alarms.
 * Returns [{ kind: 'remind' | 'start', at: Date, occ }].
 */
export function eventsBetween(schedules, from, to) {
  const events = [];
  const cursor = new Date(from.getFullYear(), from.getMonth(), from.getDate() - 1);
  const last = new Date(to.getFullYear(), to.getMonth(), to.getDate() + 1);

  for (; cursor <= last; cursor.setDate(cursor.getDate() + 1)) {
    for (const schedule of schedules || []) {
      const occ = occurrenceOn(schedule, cursor);
      if (!occ) continue;

      const remind = reminderAt(occ, schedule.remind);
      if (remind && remind >= from && remind < to) {
        events.push({ kind: 'remind', at: remind, occ });
      }
      if (occ.start >= from && occ.start < to) {
        events.push({ kind: 'start', at: occ.start, occ });
      }
    }
  }

  return events.sort((a, b) => a.at - b.at);
}

/** Human label for a day set: "Every day", "Weekdays", "Mon · Wed · Fri". */
export function daysLabel(days) {
  const set = [...new Set((days || []).filter((d) => d >= 0 && d <= 6))].sort();
  if (!set.length) return 'No days';
  if (set.length === 7) return 'Every day';
  if (set.length === 5 && WEEKDAYS.every((d) => set.includes(d))) return 'Weekdays';
  if (set.length === 2 && WEEKEND.every((d) => set.includes(d))) return 'Weekends';
  return set.map((d) => DAYS[d]).join(' · ');
}

/** "06:30 – 08:00 · 1h 30m" for rows and sheets. */
export function spanLabel(schedule) {
  const span = spanMin(schedule);
  return `${schedule.start} – ${schedule.end}${span ? ` · ${fmtMin(span)}` : ''}`;
}

/** Is `date` one of the schedule's days? (enabled state ignored) */
export function dayOn(schedule, date) {
  return Array.isArray(schedule?.days) && schedule.days.includes(date.getDay());
}

/**
 * Clean untrusted input (old backups, hand-edited JSON) into a schedule.
 * Returns null when the times or days cannot work. An empty id is left for
 * the store to fill, so this stays free of storage concerns.
 */
export function normalizeSchedule(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const start = parseHM(raw.start);
  const end = parseHM(raw.end);
  if (start == null || end == null || start === end) return null;

  const days = [...new Set((Array.isArray(raw.days) ? raw.days : [])
    .map(Number)
    .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))]
    .sort();
  if (!days.length) return null;

  const remind = Math.round(Number(raw.remind));
  return {
    id: typeof raw.id === 'string' ? raw.id : '',
    name: String(raw.name || '').trim().slice(0, 40) || 'Untitled block',
    start: toHM(start),
    end: toHM(end),
    days,
    enabled: raw.enabled !== false,
    alarm: raw.alarm !== false,
    remind: Number.isFinite(remind) ? Math.max(0, Math.min(60, remind)) : 5,
    createdAt: Number(raw.createdAt) || Date.now(),
  };
}
