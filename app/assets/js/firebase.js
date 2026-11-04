/* Lockin — lazy Firebase loader.
   The SDK loads from Google's pinned CDN only when the account feature needs
   it: the app boots and works offline with zero Firebase code, and the
   service worker runtime-caches the modules after the first sign-in. */

/* The web app config is public by design — it identifies the project, it
   does not grant access. Firestore rules are the lock. */
export const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyCpgy7nEoqaHNgQeDsJXggzNeMDuMP91pY',
  authDomain: 'lockin-29758.firebaseapp.com',
  projectId: 'lockin-29758',
  storageBucket: 'lockin-29758.firebasestorage.app',
  messagingSenderId: '364813854806',
  appId: '1:364813854806:web:c40d79fadb08c4b31033f7',
};

const CDN = 'https://www.gstatic.com/firebasejs/11.6.0/';
let mods = null;
let loading = null;

/** Load and initialize the SDK once; later calls get the same instance. */
export function loadFirebase() {
  if (mods) return Promise.resolve(mods);
  if (loading) return loading;
  loading = (async () => {
    const [appMod, authMod, storeMod] = await Promise.all([
      import(`${CDN}firebase-app.js`),
      import(`${CDN}firebase-auth.js`),
      import(`${CDN}firebase-firestore.js`),
    ]);
    const app = appMod.getApps().length ? appMod.getApps()[0] : appMod.initializeApp(FIREBASE_CONFIG);
    mods = {
      app,
      auth: authMod.getAuth(app),
      db: storeMod.getFirestore(app),
      A: authMod,
      F: storeMod,
    };
    return mods;
  })();
  loading.catch(() => { loading = null; }); // a failed load can be retried
  return loading;
}
