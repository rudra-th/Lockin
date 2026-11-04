/* Lockin — cloud sync engine.
   Mirrors the store's synced slices to Firestore: pull (full on first sync,
   incremental after), merge with the pure core, push what changed. A shadow
   snapshot + cursor live in their own localStorage key so the engine knows
   what the cloud already has and nothing ever loops.

   Local-first, always: the store is the truth, sync never blocks the app,
   and every failure is quiet until Settings asks. */

import { Store } from './store.js';
import {
  diffCollection, diffScalar, mergeDocs, mergeScalar, nextCursor,
} from '../core/sync.js';
import { loadFirebase } from './firebase.js';

const META_KEY = 'lockin.sync.v1';
const DEBOUNCE_MS = 1500;
const PAGE = 500; // Firestore query page and write-batch chunk

/* Array slices and how they merge; profile and settings are single docs. */
const COLLECTIONS = [
  { name: 'schedules', mode: 'lww' },
  { name: 'tasks', mode: 'lww' },
  { name: 'sessions', mode: 'append' },
  { name: 'slips', mode: 'append' },
];
const SCALARS = ['profile', 'settings'];

let mods = null;        // { auth, db, A, F } once the SDK is loaded
let user = null;        // the signed-in Firebase user
let uid = null;         // the account the shadow/cursor belong to
let shadow = null;      // what the cloud last looked like, per slice
let cursor = 0;         // newest updatedAt pulled — advances on pulls only
let started = false;
let busy = false;
let pending = false;    // a change arrived mid-cycle
let applying = false;   // the engine itself is writing the store
let timer = 0;
let status = 'idle';    // idle | syncing | offline | error
let lastSyncAt = 0;
let lastError = '';

/* ---------- sync metadata (never inside the store) ---------- */

function loadMeta(ownerUid) {
  try {
    const raw = JSON.parse(localStorage.getItem(META_KEY) || 'null');
    if (raw && typeof raw === 'object' && raw.uid === ownerUid) return raw;
  } catch (_) { /* corrupt meta is just a fresh start */ }
  /* A different account gets a clean slate: cursors and shadows are per-uid. */
  return { uid: ownerUid, cursor: 0, shadow: null };
}

function saveMeta() {
  try {
    localStorage.setItem(META_KEY, JSON.stringify({ uid, cursor, shadow }));
  } catch (_) { /* a full storage must never break the app */ }
}

/* ---------- status ---------- */

function setStatus(next, err = '') {
  status = next;
  lastError = err;
  if (next === 'idle') lastSyncAt = Date.now();
  document.dispatchEvent(new CustomEvent('lockin:sync', {
    detail: { status, lastSyncAt, error: lastError },
  }));
}

/** Current engine state for the Settings card. */
export function syncStatus() {
  return { status, lastSyncAt, error: lastError };
}

/* ---------- pull ---------- */

async function pullCollection(F, db, uid, name) {
  const col = F.collection(db, 'users', uid, name);
  if (cursor <= 0) {
    const snap = await F.getDocs(col);
    return snap.docs.map((d) => d.data());
  }
  const docs = [];
  let at = cursor;
  for (;;) {
    const q = F.query(
      col,
      F.where('updatedAt', '>', at),
      F.orderBy('updatedAt'),
      F.limit(PAGE),
    );
    const snap = await F.getDocs(q);
    const page = snap.docs.map((d) => d.data());
    docs.push(...page);
    if (page.length < PAGE) break;
    at = page[page.length - 1].updatedAt || at;
  }
  return docs;
}

/** Apply pulled docs to the store under the re-entrancy guard. */
function mergeRemote(pulled) {
  applying = true;
  try {
    Store.set((s) => {
      let touched = 0;
      for (const { name, mode } of COLLECTIONS) {
        const docs = pulled[name] || [];
        if (!docs.length) continue;
        const out = mergeDocs(s[name], docs, mode);
        s[name] = out.arr;
        touched += out.added + out.updated + out.deleted;
      }
      for (const name of SCALARS) {
        const doc = (pulled[name] || [])[0];
        if (!doc) continue;
        const before = s[name];
        s[name] = mergeScalar(s[name], doc);
        if (s[name] !== before) touched += 1;
      }
      /* Data just arrived on a device that never met the owner: skip the film. */
      if (touched > 0 && !s.flags.onboarded) s.flags.onboarded = true;
    });
  } finally {
    applying = false;
  }
}

/** Remember pulled docs in the shadow so they are never pushed back. */
function absorbPulled(pulled) {
  shadow = shadow || {};
  for (const name of SCALARS) {
    const doc = (pulled[name] || [])[0];
    if (doc) shadow[name] = { ...doc };
  }
  for (const { name } of COLLECTIONS) {
    shadow[name] = shadow[name] || {};
    for (const doc of pulled[name] || []) shadow[name][doc.id] = { ...doc };
  }
}

/* ---------- push ---------- */

function buildWrites(uid, db, F) {
  const s = Store.state;
  const now = Date.now();
  const scalarNames = SCALARS.filter((name) => diffScalar(s[name], shadow?.[name]));
  const plans = [];
  for (const { name } of COLLECTIONS) {
    const { upserts, removedIds } = diffCollection(s[name] || [], shadow?.[name] || {});
    if (upserts.length || removedIds.length) plans.push({ name, upserts, removedIds });
  }
  const total = scalarNames.length
    + plans.reduce((n, p) => n + p.upserts.length + p.removedIds.length, 0);
  if (!total) return [];

  /* Stamp the local copies so a later pull compares fairly against the cloud. */
  applying = true;
  try {
    Store.set((st) => {
      for (const name of scalarNames) st[name].updatedAt = now;
      for (const { name, upserts } of plans) {
        for (const e of upserts) {
          const target = (st[name] || []).find((x) => x.id === e.id);
          if (target) target.updatedAt = now;
        }
      }
    });
  } finally {
    applying = false;
  }

  const writes = [];
  for (const name of scalarNames) {
    writes.push({
      name, id: 'main',
      ref: F.doc(db, 'users', uid, name, 'main'),
      data: { ...s[name], updatedAt: now },
    });
  }
  for (const { name, upserts, removedIds } of plans) {
    for (const e of upserts) {
      writes.push({
        name, id: e.id,
        ref: F.doc(db, 'users', uid, name, e.id),
        data: { ...e, updatedAt: now },
      });
    }
    for (const id of removedIds) {
      writes.push({
        name, id,
        ref: F.doc(db, 'users', uid, name, id),
        data: { id, deleted: true, updatedAt: now },
      });
    }
  }
  return writes;
}

/** Remember written docs in the shadow so they are never written twice. */
function absorbPushed(writes) {
  shadow = shadow || {};
  for (const w of writes) {
    shadow[w.name] = shadow[w.name] || {};
    shadow[w.name][w.id] = { ...w.data };
  }
}

/* ---------- the cycle ---------- */

export async function syncNow(reason = 'manual') {
  if (!started || !user) return;
  if (busy) { pending = true; return; }
  busy = true;
  const owner = user;
  setStatus('syncing');
  try {
    if (!mods) mods = await loadFirebase();
    if (!started || user?.uid !== owner.uid) return; // signed out mid-load
    const { db, F } = mods;
    const ownerId = owner.uid;

    /* Pull first: the cloud wins nothing by surprise, the merge is fair. */
    const pulled = {};
    let maxAt = cursor;
    for (const { name } of COLLECTIONS) {
      const docs = await pullCollection(F, db, ownerId, name);
      pulled[name] = docs;
      maxAt = nextCursor(maxAt, docs);
    }
    for (const name of SCALARS) {
      const docs = (await pullCollection(F, db, ownerId, name))
        .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      pulled[name] = docs;
      maxAt = nextCursor(maxAt, docs);
    }
    mergeRemote(pulled);
    absorbPulled(pulled);
    cursor = maxAt; // pulled docs only — a push stamp must never hide remote work

    /* Then push whatever the pull left unknown to the shadow. */
    const writes = buildWrites(ownerId, db, F);
    for (let i = 0; i < writes.length; i += PAGE) {
      const batch = F.writeBatch(db);
      for (const w of writes.slice(i, i + PAGE)) batch.set(w.ref, w.data);
      await batch.commit();
    }
    absorbPushed(writes);

    saveMeta();
    setStatus('idle');
  } catch (err) {
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
    setStatus(offline ? 'offline' : 'error',
      offline ? '' : String(err?.code || err?.message || 'sync failed'));
  } finally {
    busy = false;
    if (pending && started) {
      pending = false;
      schedulePush();
    }
  }
}

/* ---------- triggers ---------- */

function schedulePush() {
  if (!started || applying) return;
  clearTimeout(timer);
  timer = setTimeout(() => { syncNow('change'); }, DEBOUNCE_MS);
}

function onChange() {
  if (!started || applying) return;
  if (busy) { pending = true; return; }
  schedulePush();
}

function onVisible() {
  if (!document.hidden) syncNow('visible');
}

function onOnline() {
  syncNow('online');
}

/* ---------- lifecycle ---------- */

/** Own the store's sync for this user. Called by account.js on sign-in. */
export function startSync(fbUser) {
  if (started && uid === fbUser.uid) { user = fbUser; return; }
  if (started) stopSync(); // a different account takes over cleanly
  uid = fbUser.uid;
  user = fbUser;
  const meta = loadMeta(uid);
  cursor = meta.cursor || 0;
  shadow = meta.shadow || null;
  started = true;
  document.addEventListener('lockin:changed', onChange);
  document.addEventListener('visibilitychange', onVisible);
  addEventListener('online', onOnline);
  syncNow('start');
}

/** Release the store. Local data is untouched; the cloud mirror just stops. */
export function stopSync() {
  if (!started && !user) return;
  started = false;
  user = null;
  clearTimeout(timer);
  pending = false;
  document.removeEventListener('lockin:changed', onChange);
  document.removeEventListener('visibilitychange', onVisible);
  removeEventListener('online', onOnline);
  saveMeta();
  status = 'idle';
  lastError = '';
  document.dispatchEvent(new CustomEvent('lockin:sync', {
    detail: { status, lastSyncAt, error: '' },
  }));
}

/** Wipe the engine's bookkeeping — used when the cloud copy is deleted. */
export function resetSyncMeta() {
  cursor = 0;
  shadow = null;
  saveMeta();
}
