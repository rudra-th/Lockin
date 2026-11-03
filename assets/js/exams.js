/* Lockin — the exam catalogue.
   Names, seeded subjects, and the month a typical session lands in. Dates are
   approximate by design: the film asks for a month and a year, and Home counts
   the days to that month's canonical exam day. */

import { dateKey, parseKey } from './util.js';

export const EXAMS = [
  { id: 'jee-both', name: 'JEE (Mains + Advanced)', short: 'JEE', month: 0, day: 24, window: 'Jan → May', subjects: ['Physics', 'Chemistry', 'Maths'] },
  { id: 'jee-main', name: 'JEE (Mains)', short: 'JEE Main', month: 0, day: 24, window: 'Jan', subjects: ['Physics', 'Chemistry', 'Maths'] },
  { id: 'neet', name: 'NEET', short: 'NEET', month: 4, day: 4, window: 'May', subjects: ['Physics', 'Chemistry', 'Biology'] },
  { id: 'boards', name: 'Boards', short: 'Boards', month: 1, day: 15, window: 'Feb → Mar', subjects: ['Maths', 'Science', 'English'] },
  { id: 'mhtcet', name: 'MHT-CET', short: 'MHT-CET', month: 3, day: 20, window: 'Apr', subjects: ['Physics', 'Chemistry', 'Maths'] },
  { id: 'cuet', name: 'CUET', short: 'CUET', month: 4, day: 15, window: 'May', subjects: ['English', 'General Test', 'Domain'] },
  { id: 'gate', name: 'GATE', short: 'GATE', month: 1, day: 1, window: 'Feb', subjects: ['Core Subject', 'Aptitude', 'Maths'] },
  { id: 'upsc', name: 'UPSC', short: 'UPSC', month: 4, day: 25, window: 'May', subjects: ['Polity', 'History', 'Current Affairs'] },
  { id: 'cat', name: 'CAT', short: 'CAT', month: 10, day: 30, window: 'Nov', subjects: ['Quant', 'DILR', 'English'] },
  { id: 'clat', name: 'CLAT', short: 'CLAT', month: 11, day: 1, window: 'Dec', subjects: ['Legal Reasoning', 'English', 'GK'] },
  { id: 'ssc', name: 'SSC', short: 'SSC', month: 8, day: 15, window: 'Sep', subjects: ['Quant', 'Reasoning', 'English'] },
];

/* the five that get a card; the rest live behind "More exams" */
export const PRIMARY_EXAMS = ['jee-both', 'jee-main', 'neet', 'boards', 'mhtcet'];
export const MORE_EXAMS = ['cuet', 'gate', 'upsc', 'cat', 'clat', 'ssc'];

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function examById(id) {
  return EXAMS.find((e) => e.id === id) || null;
}

export function examByName(name) {
  const n = String(name || '').trim().toLowerCase();
  if (!n) return null;
  return EXAMS.find((e) => e.name.toLowerCase() === n || e.short.toLowerCase() === n) || null;
}

/* Custom exams fall back to the same generic seeds the old questionnaire used. */
export function subjectsForExam(exam) {
  const e = String(exam || '');
  const hit = EXAMS.find((x) => x.name.toLowerCase() === e.trim().toLowerCase());
  if (hit) return hit.subjects;
  const table = [
    [/jee/i, ['Physics', 'Chemistry', 'Maths']],
    [/neet|aiims|medical/i, ['Physics', 'Chemistry', 'Biology']],
    [/upsc|civil service/i, ['Polity', 'History', 'Current Affairs']],
    [/cat|mba/i, ['Quant', 'DILR', 'English']],
    [/clat|law/i, ['Legal Reasoning', 'English', 'GK']],
    [/gate/i, ['Core Subject', 'Aptitude', 'Maths']],
    [/board|sslc|cbse|icse|class/i, ['Maths', 'Science', 'English']],
  ];
  const fallback = table.find(([re]) => re.test(e));
  return fallback ? fallback[1] : ['Subject 1', 'Subject 2', 'Subject 3'];
}

/** days in a month, leap years included */
export function daysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
}

/** the first sensible year for a month — this year if it is still ahead */
export function expectedYear(month, day = 1, now = new Date()) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const candidate = new Date(now.getFullYear(), month, Math.min(day, daysInMonth(now.getFullYear(), month)));
  return candidate < today ? now.getFullYear() + 1 : now.getFullYear();
}

/**
 * A canonical date for "≈ month year". The exam's usual day is kept when the
 * user leaves the month alone; picking another month means the 1st, because an
 * approximate date should not pretend to know the day.
 */
export function examDateFor(exam, month, year) {
  const day = exam && month === exam.month ? exam.day : 1;
  return dateKey(new Date(year, month, Math.min(day, daysInMonth(year, month))));
}

/** "≈ May 2027" — the one line Home and Settings show */
export function formatExamMonth(key, { short = false } = {}) {
  if (!key) return '';
  const d = parseKey(key);
  return `≈ ${d.toLocaleDateString(undefined, { month: short ? 'short' : 'long', year: 'numeric' })}`;
}
