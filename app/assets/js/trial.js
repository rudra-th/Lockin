/* Lockin — the online trial.
   The trial is the whole app with a separate store, a local Test Account and a
   believable demo week. It never talks to Firebase: the account is a plain
   object, so nothing here can reach the cloud. Browser-only limits are shown as
   Android-only in Control and Settings, not hidden. */

import { dateKey, parseKey } from './util.js';
import { examById, examDateFor, expectedYear } from './exams.js';

export const TRIAL_KEY = 'lockin.trial.store.v1';
export const TRIAL_QUERY = 'trial';

export const TRIAL_ACCOUNT = {
  uid: 'trial-test-account',
  name: 'Test Account',
  email: 'test.account@lockin.app',
  photo: '',
};

function params() {
  try {
    return new URLSearchParams(globalThis.location?.search || '');
  } catch (_) {
    return new URLSearchParams();
  }
}

/** True only on /app/?trial=1 — a normal /app/ visit keeps the real store. */
export const isTrial = params().get(TRIAL_QUERY) === '1';

/** The demo profile. Safe to call repeatedly; it never reads storage. */
export function trialSeed(now = new Date()) {
  const exam = examById('jee-both');
  const year = expectedYear(exam.month, exam.day, now);
  const examDate = examDateFor(exam, exam.month, year);
  const today = dateKey(now);
  const dayStart = parseKey(today).getTime();
  const nowMs = now.getTime();

  const schedules = [
    {
      name: 'Morning maths',
      start: '06:30', end: '08:00',
      days: [1, 2, 3, 4, 5, 6],
      enabled: true, alarm: true, remind: 5,
    },
    {
      name: 'Physics deep work',
      start: '09:00', end: '11:00',
      days: [1, 2, 3, 4, 5],
      enabled: true, alarm: true, remind: 5,
    },
    {
      name: 'Revision & doubts',
      start: '16:30', end: '18:00',
      days: [1, 2, 3, 4, 5],
      enabled: true, alarm: true, remind: 0,
    },
    {
      name: 'Sleep',
      start: '23:00', end: '07:00',
      days: [0, 1, 2, 3, 4, 5, 6],
      enabled: true, alarm: false, remind: 0,
    },
  ];

  /* Thirteen finished days, oldest first. `mins` is what the day banked;
     `slip` is the honest mark that keeps that day from being clean. */
  const history = [
    { mins: 95, slip: null },
    { mins: 140, slip: null },
    { mins: 65, slip: 'slip' },
    { mins: 0, slip: null },
    { mins: 120, slip: null },
    { mins: 155, slip: null },
    { mins: 80, slip: null },
    { mins: 105, slip: 'rescue' },
    { mins: 0, slip: null },
    { mins: 130, slip: null },
    { mins: 145, slip: 'abandon' },
    { mins: 90, slip: null },
    { mins: 115, slip: null },
  ];

  const sessions = [];
  const slips = [];

  history.forEach((row, i) => {
    const day = dateKey(new Date(parseKey(today).getFullYear(), parseKey(today).getMonth(), parseKey(today).getDate() - (history.length - i)));
    if (row.mins > 0) addSessions(sessions, day, row.mins);
    if (row.slip) {
      slips.push({
        id: `sl_demo_${i}`,
        ts: parseKey(day).getTime() + 17 * 3600000,
        day,
        kind: row.slip,
        sessId: null,
        awaySec: row.slip === 'slip' ? 96 : row.slip === 'rescue' ? 7 : 0,
      });
    }
  });

  /* Today is a session in progress, not a finished day. At 2am there is no
     honest way to show today's work, so it stays at zero. */
  const minutesToday = Math.min(95, Math.max(0, Math.round(((nowMs - dayStart) / 60000 - 25) * 0.72)));
  if (minutesToday >= 20) {
    const first = Math.round(minutesToday * 0.62);
    const second = minutesToday - first;
    const end2 = nowMs - 6 * 60000;
    const start2 = end2 - second * 60000;
    const end1 = start2 - 9 * 60000;
    const start1 = Math.max(dayStart + 5 * 60000, end1 - first * 60000);
    if (end1 > start1) {
      sessions.push({
        id: 'ss_demo_today_1', day: today, taskIds: [], start: start1, end: end1,
        kind: 'focus', completed: true,
      });
    }
    if (end2 > start2) {
      sessions.push({
        id: 'ss_demo_today_2', day: today, taskIds: [], start: start2, end: end2,
        kind: 'focus', completed: true,
      });
    }
  }

  const tasks = [];
  const taskCopies = [
    ['Finish the current chapter', 'Redo the last ten mistakes'],
    ['Read one chapter', 'Write the formula sheet'],
    ['Solve a mixed problem set', 'Review yesterday’s notes'],
    ['One full mock section', 'Correct it the same day'],
    ['Revise the weak topic', 'Ask the doubt you skipped'],
    ['Read one chapter of Organic Chemistry', 'Twenty minutes of recall'],
  ];
  for (let age = 6; age >= 1; age -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - age);
    const day = dateKey(d);
    const pair = taskCopies[6 - age];
    pair.forEach((title, j) => {
      const done = !(age === 5 && j === 1) && !(age === 2 && j === 0);
      tasks.push({
        id: `tk_demo_${age}_${j}`,
        date: day,
        title,
        stages: [],
        doneAt: done ? parseKey(day).getTime() + (j ? 18 : 10) * 3600000 : null,
      });
    });
  }
  const todayTasks = [
    ['Revise thermodynamics — 2 chapters', true, 9],
    ['Solve 30 integration problems', true, 12],
    ['Mock test: Physics paper 2', false, 0],
  ];
  todayTasks.forEach(([title, done, hour], i) => {
    tasks.push({
      id: `tk_demo_today_${i}`,
      date: today,
      title,
      stages: [],
      doneAt: done ? Math.min(nowMs - 20 * 60000, dayStart + hour * 3600000) : null,
    });
  });
  ['Review today’s mistakes', 'Read one chapter of Organic Chemistry'].forEach((title, i) => {
    tasks.push({
      id: `tk_demo_tomorrow_${i}`,
      date: dateKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)),
      title,
      stages: [],
      doneAt: null,
    });
  });

  return {
    v: 1,
    createdAt: nowMs - 14 * 86400000,
    schedules,
    tasks,
    sessions,
    slips,
    profile: {
      name: TRIAL_ACCOUNT.name,
      exam: exam.name,
      examId: exam.id,
      examDate,
    },
    settings: {
      theme: 'dark',
      goalMin: 120,
      strict: true,
      scheduleAlarms: true,
      alarmSound: true,
      alarmVibrate: true,
      remindDefault: 5,
      kiosk: false,
      pomo: { focus: 50, short: 10, long: 25 },
    },
    flags: { onboarded: true },
  };
}

function addSessions(list, day, mins) {
  const base = parseKey(day).getTime();
  const first = Math.round(mins * 0.6);
  const second = mins - first;
  const chunks = second > 0
    ? [{ mins: first, hour: 7 }, { mins: second, hour: 16 }]
    : [{ mins: first, hour: 9 }];
  chunks.forEach((chunk, i) => {
    if (chunk.mins <= 0) return;
    const start = base + chunk.hour * 3600000 + (chunk.hour === 16 ? 30 * 60000 : 0);
    list.push({
      id: `ss_demo_${day}_${i}`,
      day,
      taskIds: [],
      start,
      end: start + chunk.mins * 60000,
      kind: 'focus',
      completed: true,
    });
  });
}

/** Demo screen time for the trial's Control screen. Generated, labelled as
    demo, and never read from the device or sent anywhere. */
export function trialScreenTime(now = new Date()) {
  const hours = [4.6, 3.2, 5.1, 3.8, 6.2, 4.4, 4.2];
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6);
  const week = hours.map((h, i) => {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    return { day: dateKey(d), ms: Math.round(h * 3600000) };
  });
  const apps = [
    ['YouTube', 1.62],
    ['Instagram', 0.86],
    ['WhatsApp', 0.68],
    ['Chrome', 0.52],
    ['Spotify', 0.34],
  ].map(([label, h]) => ({ label, ms: Math.round(h * 3600000) }));
  return { week, apps };
}

/** Restore the demo week. The real store is never touched. */
export function resetTrial() {
  try { localStorage.removeItem(TRIAL_KEY); } catch (_) { /* private mode */ }
  const url = new URL(globalThis.location.href);
  url.searchParams.set(TRIAL_QUERY, '1');
  globalThis.location.replace(url.toString());
}
