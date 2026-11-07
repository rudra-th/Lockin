/* Lockin — Google account.
   Signs in with Google (a popup on the web, the native sheet inside the
   Capacitor shell), restores the session on boot, and hands the user to the
   sync engine. The cloud is optional: everything works signed out, and
   signing out never touches local data. */

import { isNative } from './native.js';
import { loadFirebase } from './firebase.js';
import { startSync, stopSync, syncStatus, resetSyncMeta } from './sync.js';
import { Store } from './store.js';
import { ensurePairCode, resetSummarySignature } from './summary.js';
import { authErrorMessage, errorCodeOf, isCancel } from '../../core/auth-errors.js';
import { isTrial, TRIAL_ACCOUNT } from './trial.js';

const FLAG = 'lockin.sync.on'; // "the user wants the cloud" — set on sign-in

let user = isTrial ? { ...TRIAL_ACCOUNT } : null; // { uid, name, email, photo }
let signingIn = false;
let listening = false;
let lastError = '';
let nativeProfile = null; // photo/name straight from the Google sheet, in case Firebase omits them

/* Inside the Capacitor shell the plugin is wired by cap sync and reached
   through the global bridge — no npm import, no bundler. */
const nativeAuth = () => globalThis.Capacitor?.Plugins?.FirebaseAuthentication || null;

function emit() {
  document.dispatchEvent(new CustomEvent('lockin:account', { detail: accountState() }));
}

/** Everything the Settings card needs, in one read. */
export function accountState() {
  const sync = syncStatus();
  return { user, signingIn, trial: isTrial, ...sync, error: lastError || sync.error };
}

function photoOf(fbUser) {
  return fbUser?.photoURL
    || fbUser?.providerData?.find((p) => p?.photoURL)?.photoURL
    || nativeProfile?.photoUrl
    || nativeProfile?.photoURL
    || '';
}

function adopt(fbUser) {
  if (fbUser) {
    user = {
      uid: fbUser.uid,
      name: fbUser.displayName || nativeProfile?.displayName || '',
      email: fbUser.email || nativeProfile?.email || '',
      photo: photoOf(fbUser),
    };
    rememberProfile(user);
    try { localStorage.setItem(FLAG, '1'); } catch (_) { /* flag is a bonus */ }
    startSync(fbUser);
  } else {
    user = null;
    try { localStorage.removeItem(FLAG); } catch (_) { /* flag is a bonus */ }
    stopSync();
  }
  emit();
}

/** Keep the signed-in Google address (backup + account label) and the
    extension pairing code in the store, so both sync to the user's tree. */
function rememberProfile(account) {
  const email = String(account?.email || '').trim();
  if (!email) return;
  const code = ensurePairCode();
  const s = Store.state;
  if (s.profile.email === email && s.settings.pairCode === code) return;
  Store.set((st) => {
    st.profile.email = email;
    st.settings.pairCode = code;
  });
}

function rememberCloud() {
  try { localStorage.setItem(FLAG, '1'); } catch (_) { /* redirect still works this session */ }
}

function listen(auth, A) {
  if (listening) return;
  listening = true;
  A.onAuthStateChanged(auth, adopt);
}

/** Boot: only touches the network when the user has asked for the cloud. */
export async function initAccount() {
  if (isTrial) { emit(); return; } // the Test Account is local; Firebase never loads
  let wants = false;
  try { wants = localStorage.getItem(FLAG) === '1'; } catch (_) { /* fresh start */ }
  if (!wants) return;
  try {
    const { auth, A } = await loadFirebase();
    listen(auth, A);
    try { await A.getRedirectResult(auth); } catch (_) { /* a stale redirect is not fatal */ }
  } catch (_) {
    lastError = authErrorMessage({ code: 'auth/network-request-failed' }); // the flag stays; the next online moment retries
    emit();
  }
}

/**
 * The native sheet, then the Firebase credential. Credential Manager is the
 * modern path; some phones (older Play services, no saved Google account in
 * the manager) only work through the legacy GoogleSignIn intent, so a failed
 * first attempt that is not a cancellation retries there before giving up.
 */
async function nativeGoogleTokens(plugin) {
  if (!plugin) {
    const err = new Error('native Google sign-in is not available');
    err.code = 'lockin/native-auth-missing';
    throw err;
  }

  const options = { skipNativeAuth: true };
  let res;
  try {
    res = await plugin.signInWithGoogle({ ...options, useCredentialManager: true });
  } catch (err) {
    if (isCancel(err)) throw err;
    res = await plugin.signInWithGoogle({ ...options, useCredentialManager: false });
  }

  const cred = res?.credential || {};
  const idToken = cred.idToken || res?.idToken || '';
  const accessToken = cred.accessToken || res?.accessToken || '';
  if (!idToken) {
    const err = new Error('Google returned no ID token');
    err.code = 'lockin/no-id-token';
    throw err;
  }
  /* The native sheet knows the photo even when Firebase's restored profile
     drops it; keep it for adopt(). */
  nativeProfile = res?.user || null;
  return { idToken, accessToken };
}

export async function signIn() {
  if (isTrial) { emit(); return; } // already the Test Account
  if (signingIn || user) return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    lastError = authErrorMessage({ code: 'auth/network-request-failed' });
    emit();
    return;
  }
  signingIn = true;
  lastError = '';
  emit();
  try {
    const { auth, A } = await loadFirebase();
    listen(auth, A);

    if (isNative) {
      /* Google blocks OAuth inside WebViews, so the shell uses the native
         sheet and hands the token to the JS SDK for Firestore. */
      const { idToken, accessToken } = await nativeGoogleTokens(nativeAuth());
      const cred = A.GoogleAuthProvider.credential(idToken, accessToken || undefined);
      await A.signInWithCredential(auth, cred);
    } else {
      try {
        await A.signInWithPopup(auth, new A.GoogleAuthProvider());
      } catch (err) {
        const code = errorCodeOf(err);
        if (code === 'auth/popup-blocked'
          || code === 'auth/operation-not-supported-in-this-environment') {
          /* The redirect navigates away; boot finishes the flow through
             getRedirectResult. Set the cloud flag first so initAccount runs. */
          rememberCloud();
          await A.signInWithRedirect(auth, new A.GoogleAuthProvider());
          return;
        }
        throw err;
      }
    }
    /* onAuthStateChanged adopts the user from here. */
  } catch (err) {
    if (!isCancel(err)) lastError = authErrorMessage(err, { native: isNative });
  } finally {
    signingIn = false;
    emit();
  }
}

export async function signOut() {
  if (isTrial) { emit(); return; } // the trial cannot sign out of its demo account
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
  if (isTrial || !user) return;
  try {
    const { db, F } = await loadFirebase();
    const uid = user.uid;
    for (const name of ['profile', 'settings', 'schedules', 'tasks', 'sessions', 'slips', 'screenTime']) {
      const snap = await F.getDocs(F.collection(db, 'users', uid, name));
      const docs = snap.docs;
      for (let i = 0; i < docs.length; i += 400) {
        const batch = F.writeBatch(db);
        for (const d of docs.slice(i, i + 400)) batch.delete(d.ref);
        await batch.commit();
      }
    }
    /* The extension's public summary is part of the cloud copy too. */
    const code = Store.state.settings?.pairCode;
    if (code) {
      try { await F.deleteDoc(F.doc(db, 'public', code)); } catch (_) { /* already gone */ }
    }
    resetSummarySignature(); // the next sign-in republishes even if nothing changed
    resetSyncMeta(); // a later sign-in re-uploads from scratch
    await signOut();
  } catch (err) {
    lastError = String(err?.code || err?.message || 'delete failed');
    emit();
  }
}
