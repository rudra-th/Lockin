/* Lockin — Google account.
   Signs in with Google (a popup on the web, the native sheet inside the
   Capacitor shell), restores the session on boot, and hands the user to the
   sync engine. The cloud is optional: everything works signed out, and
   signing out never touches local data. */

import { isNative } from './native.js';
import { loadFirebase } from './firebase.js';
import { startSync, stopSync, syncStatus } from './sync.js';

const FLAG = 'lockin.sync.on'; // "the user wants the cloud" — set on sign-in

let user = null;          // { uid, name, email, photo }
let signingIn = false;
let listening = false;
let lastError = '';

/* Inside the Capacitor shell the plugin is wired by cap sync and reached
   through the global bridge — no npm import, no bundler. */
const nativeAuth = () => globalThis.Capacitor?.Plugins?.FirebaseAuthentication || null;

function emit() {
  document.dispatchEvent(new CustomEvent('lockin:account', { detail: accountState() }));
}

/** Everything the Settings card needs, in one read. */
export function accountState() {
  return { user, signingIn, ...syncStatus(), error: lastError };
}

function adopt(fbUser) {
  if (fbUser) {
    user = {
      uid: fbUser.uid,
      name: fbUser.displayName || '',
      email: fbUser.email || '',
      photo: fbUser.photoURL || '',
    };
    try { localStorage.setItem(FLAG, '1'); } catch (_) { /* flag is a bonus */ }
    startSync(fbUser);
  } else {
    user = null;
    try { localStorage.removeItem(FLAG); } catch (_) { /* flag is a bonus */ }
    stopSync();
  }
  emit();
}

function listen(auth, A) {
  if (listening) return;
  listening = true;
  A.onAuthStateChanged(auth, adopt);
}

/** Boot: only touches the network when the user has asked for the cloud. */
export async function initAccount() {
  let wants = false;
  try { wants = localStorage.getItem(FLAG) === '1'; } catch (_) { /* fresh start */ }
  if (!wants) return;
  try {
    const { auth, A } = await loadFirebase();
    listen(auth, A);
    try { await A.getRedirectResult(auth); } catch (_) { /* a stale redirect is not fatal */ }
  } catch (_) {
    lastError = 'offline'; // the flag stays; the next online moment retries
    emit();
  }
}

export async function signIn() {
  if (signingIn || user) return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    lastError = 'offline';
    emit();
    return;
  }
  signingIn = true;
  lastError = '';
  emit();
  try {
    const { auth, A } = await loadFirebase();
    listen(auth, A);
    if (isNative && nativeAuth()) {
      /* Google blocks OAuth inside WebViews, so the shell uses the native
         sheet and hands the token to the JS SDK for Firestore. */
      const res = await nativeAuth().signInWithGoogle({ skipNativeAuth: true });
      const idToken = res?.credential?.idToken || undefined;
      const accessToken = res?.credential?.accessToken || undefined;
      const cred = A.GoogleAuthProvider.credential(idToken, accessToken);
      await A.signInWithCredential(auth, cred);
    } else {
      await A.signInWithPopup(auth, new A.GoogleAuthProvider());
    }
    /* onAuthStateChanged adopts the user from here. */
  } catch (err) {
    const code = String(err?.code || '');
    if (code === 'auth/popup-blocked') {
      try {
        const { auth, A } = await loadFirebase();
        await A.signInWithRedirect(auth, new A.GoogleAuthProvider());
        return; // the page navigates; boot completes the flow via getRedirectResult
      } catch (_) { /* fall through to the quiet error */ }
    }
    lastError = code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request'
      ? ''
      : String(code || err?.message || 'sign-in failed');
  } finally {
    signingIn = false;
    emit();
  }
}

export async function signOut() {
  try {
    const { auth, A } = await loadFirebase();
    await A.signOut(auth);
    if (isNative && nativeAuth()) await nativeAuth().signOut().catch(() => { /* best effort */ });
  } catch (_) { /* signing out locally must always succeed */ }
  adopt(null); // onAuthStateChanged also fires; adopt is idempotent
}

/** Removes the cloud copy, then signs out so nothing re-uploads it.
    This device keeps its data. */
export async function deleteCloudData() {
  if (!user) return;
  try {
    const { db, F } = await loadFirebase();
    const uid = user.uid;
    for (const name of ['profile', 'settings', 'schedules', 'tasks', 'sessions', 'slips']) {
      const snap = await F.getDocs(F.collection(db, 'users', uid, name));
      const docs = snap.docs;
      for (let i = 0; i < docs.length; i += 400) {
        const batch = F.writeBatch(db);
        for (const d of docs.slice(i, i + 400)) batch.delete(d.ref);
        await batch.commit();
      }
    }
    await signOut();
  } catch (err) {
    lastError = String(err?.code || err?.message || 'delete failed');
    emit();
  }
}
