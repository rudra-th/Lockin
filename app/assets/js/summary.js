/* Lockin — the public summary the browser extension reads.
 *
 * The extension cannot borrow a Google session, so the app publishes a small,
 * read-only document under `public/{pairCode}`. The code is a long random
 * bearer token shown in Settings — anyone holding it can read today's screen
 * time and focus minutes, nothing else. The Google email stays in the private
 * `users/{uid}` tree and never reaches this document.
 */

import { Store } from './store.js';
import { todayKey, addDays } from './util.js';

const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'; // no 0/o/1/l/i
const SIG_KEY = 'lockin.summary.v1';
const WEEK = 7;

let lastSig = null;

export function makePairCode() {
  const bytes = new Uint8Array(20);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  return [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join('');
}

/** Return the saved pairing code, creating one on first use. */
export function ensurePairCode() {
  const settings = Store.state?.settings;
  if (!settings) return '';
  if (typeof settings.pairCode === 'string' && /^[a-z0-9]{16,40}$/.test(settings.pairCode)) {
    return settings.pairCode;
  }
  const code = makePairCode();
  Store.set((s) => { s.settings.pairCode = code; });
  return code;
}

function weekDays() {
  const out = [];
  for (let i = WEEK - 1; i >= 0; i -= 1) out.push(addDays(todayKey(), -i));
  return out;
}

export function buildSummary(uid) {
  const state = Store.state;
  const day = todayKey();
  const todayScreen = Store.screenDay(day);
  return {
    uid, // lets the rules pin every write to its owner
    day,
    updatedAt: Date.now(),
    goalMin: Math.max(0, Number(state.settings?.goalMin) || 0),
    focus: {
      today: Store.focusMinutesOn(day),
      week: weekDays().map((d) => ({ day: d, mins: Store.focusMinutesOn(d) })),
    },
    screen: {
      today: Math.max(0, Number(todayScreen?.mins) || 0),
      week: weekDays().map((d) => ({ day: d, mins: Math.max(0, Number(Store.screenDay(d)?.mins) || 0) })),
      apps: (todayScreen?.apps || []).slice(0, 6).map((a) => ({
        label: String(a.label || a.package || '').slice(0, 48),
        mins: Math.max(0, Math.round(Number(a.mins) || 0)),
      })),
    },
  };
}

function signatureOf(data) {
  const rest = { ...data };
  delete rest.updatedAt;
  return JSON.stringify(rest);
}

/**
 * Forget the last published signature. Call this when the public document may
 * be gone (cloud delete) so the next sync republishes instead of skipping.
 */
export function resetSummarySignature() {
  lastSig = null;
  try { localStorage.removeItem(SIG_KEY); } catch (_) { /* pairing still works */ }
}

/** Write the summary when its content actually changed. Best-effort only. */
export async function publishSummary({ db, F, uid }) {
  if (!db || !F || !uid) return false;
  try {
    const code = ensurePairCode();
    if (!code) return false;
    const data = buildSummary(uid);
    const sig = signatureOf(data);
    if (lastSig == null) {
      try { lastSig = localStorage.getItem(SIG_KEY) || ''; } catch (_) { lastSig = ''; }
    }
    if (sig === lastSig) return false;
    await F.setDoc(F.doc(db, 'public', code), data);
    lastSig = sig;
    try { localStorage.setItem(SIG_KEY, sig); } catch (_) { /* pairing still works */ }
    return true;
  } catch (_) {
    return false; // a stale extension card must never break sync
  }
}

/**
 * Replace the pairing code. The old public doc is removed so a shared code
 * stops working immediately; the app then publishes the new one.
 */
export async function rotatePairCode() {
  if (!Store.state?.settings) return '';
  const old = Store.state.settings.pairCode;
  const code = makePairCode();
  Store.set((s) => { s.settings.pairCode = code; });
  lastSig = null;
  try { localStorage.removeItem(SIG_KEY); } catch (_) { /* fine */ }
  try {
    const { db, F } = await import('./firebase.js').then((m) => m.loadFirebase());
    if (old) await F.deleteDoc(F.doc(db, 'public', old));
  } catch (_) { /* old code cleanup is a bonus; the new one still publishes */ }
  return code;
}
