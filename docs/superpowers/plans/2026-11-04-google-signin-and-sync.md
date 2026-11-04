# Google Sign-in & Cloud Sync Implementation Plan (v1.6.0)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Optional Google sign-in that mirrors the user's Lockin data to their own Firestore, so phone and browser stay in step — local-first, offline-safe, no data loss.

**Architecture:** The store stays the single source of truth on device. A pure merge engine (`app/core/sync.js`) diffs the store against a shadow snapshot and merges remote docs (last-write-wins for mutable entities, union-by-id for immutable ones, tombstones for deletes). A thin engine (`app/assets/js/sync.js`) pushes/pulls over Firestore; auth lives in `app/assets/js/account.js` (Firebase JS SDK popup on web, `@capacitor-firebase/authentication` native sheet on Android feeding `signInWithCredential`). Firebase SDK loads lazily from Google's CDN — the app boots and works offline with zero Firebase code loaded.

**Tech Stack:** Firebase JS SDK 11.6.0 (ESM CDN), Firestore (native mode), `@capacitor-firebase/authentication` 8.6.0 (Android only), vanilla ES modules, no build step.

**Spec:** this document (design decided in conversation with the owner on 2026-11-04; owner approved autonomous execution).

## Global Constraints

- Version becomes **1.6.0** (versionCode 160) — `npm run bump -- 1.6.0` at the docs task.
- No build step, no bundler: Firebase loads via dynamic `import()` from `https://www.gstatic.com/firebasejs/11.6.0/`.
- The app must boot and fully work offline, signed out, with no Firebase network traffic.
- Firebase web config is public by design; Firestore rules (already published by the owner) are the access control: `users/{uid}/{document=**}` readable/writable only by that uid.
- Never block or break the app on sync failure: every network call is guarded, failures are silent, local data never waits on the network.
- Synced slices: `profile`, `settings`, `schedules`, `tasks`, `sessions`, `slips`. Device-local: `session` (live snapshot), `flags`, `activities`, `plans` (dead day-grid data).
- No browser/device testing during implementation — Node checks only (`npm run check`, `npm test`, `npm run lint`); the owner runs the device round afterwards.
- One commit per task, push after each; plan checkboxes updated in the same commit.

## Data model (Firestore)

| Path | Contents | Merge rule |
|---|---|---|
| `users/{uid}/profile/main` | profile fields + `updatedAt` | LWW |
| `users/{uid}/settings/main` | settings fields + `updatedAt` | LWW |
| `users/{uid}/schedules/{id}` | schedule + `updatedAt` | LWW per doc; delete = tombstone `{deleted:true}` |
| `users/{uid}/tasks/{id}` | task + `updatedAt` | LWW per doc; delete = tombstone |
| `users/{uid}/sessions/{id}` | session + `updatedAt` | append-only, union by id |
| `users/{uid}/slips/{id}` | slip + `updatedAt` | append-only, union by id |

- `updatedAt` is client epoch ms; tie goes to the remote copy. Clock skew between one user's devices is accepted and documented.
- Sync metadata (shadow + cursor) lives in localStorage key `lockin.sync.v1`, never inside the store (no sync-of-sync loops).
- Signed-in flag: localStorage key `lockin.sync.on`.

## Review Focus

1. **Two devices edit the same task offline** — the newer `updatedAt` must win everywhere, and the loser's edit must not resurrect later. Pinned by `mergeDocs` LWW tests.
2. **Delete on one device must delete on the other** — tombstone must survive as a doc (not a hard delete) and remove the local copy; a local edit newer than the tombstone wins instead. Pinned by tombstone tests.
3. **Re-push loop** — after a pull merge, the shadow must reflect the merged state or the engine re-pushes what it just pulled forever. Pinned by the no-op diff test.
4. **Offline boot, signed in** — SDK load fails or hangs; the app must still boot, show "Offline — will retry", and sync when back online. Covered by guarded boot path (manual device check later; code keeps every await inside try/catch).
5. **Sign-out must not delete local data** — signing out leaves the store untouched; only the cloud mirror stops. Pinned by an explicit test that `stopSync` never touches Store.

---

### Task 1: Pure sync merge engine (`app/core/sync.js`)

**Files:**
- Create: `app/core/sync.js`
- Test: `app/assets/js/tests.mjs` (new group "Sync merge math")

**Interfaces:**
- Produces (used by tasks 4–5):
  - `stableStringify(value) → string` — sorted-keys JSON for order-insensitive diffs
  - `diffCollection(current, shadow) → { upserts: entity[], removedIds: string[] }` — `shadow` is a map id → entity-or-tombstone; entities whose content (ignoring `updatedAt`) differs, or that are absent from the shadow, are upserts; ids in the shadow but not current are removedIds
  - `diffScalar(current, shadow) → boolean` — stable-JSON inequality
  - `mergeDocs(localArr, remoteDocs, mode) → { arr, added, updated, deleted }` — `mode` `'append'` unions by id (never overwrites); `'lww'` compares `updatedAt` (local missing counts as 0; remote tombstone `deleted:true` removes the local copy unless the local copy is strictly newer)
  - `mergeScalar(local, remote) → value` — LWW by `updatedAt`, tie → remote
  - `nextCursor(cursor, docs) → number`

- [x] **Step 1: Write the failing tests** — new group in `tests.mjs`: key-order-insensitive stringify; diff finds add/change/remove and is a no-op when equal; append merge unions without overwriting; LWW merge picks newer each way; tombstone removes an older local and loses to a newer local; scalar LWW incl. tie; cursor advance.
- [x] **Step 2: Run** `npm test` — new group fails (module missing).
- [x] **Step 3: Implement** the six functions in `app/core/sync.js` — pure, no imports, no DOM.
- [x] **Step 4: Run** `npm test` — all groups pass; `npm run check` + `npm run lint` clean.
- [x] **Step 5: Commit** — `Sync merge engine (plan 1)`

### Task 2: Lazy Firebase loader (`app/assets/js/firebase.js`)

**Files:**
- Create: `app/assets/js/firebase.js`

**Interfaces:**
- Produces (used by tasks 3–5): `loadFirebase() → Promise<{ app, auth, db, A: authMod, F: firestoreMod }>` — memoized; `FIREBASE_CONFIG` export.

- [x] **Step 1: Implement** — config constant (owner's web app), dynamic `import()` of `firebase-app.js`, `firebase-auth.js`, `firebase-firestore.js` from the pinned CDN, `initializeApp` + `getAuth` + `getFirestore`, memoized single-flight promise.
- [x] **Step 2: Run** `npm run check` (module parses, 32→33 JS modules) + `npm run lint`.
- [x] **Step 3: Commit** — `Lazy Firebase loader (plan 2)`

### Task 3: Account module (`app/assets/js/account.js`)

**Files:**
- Create: `app/assets/js/account.js`

**Interfaces:**
- Consumes: `loadFirebase` (task 2), `startSync`/`stopSync` (task 4), `isNative` from `native.js`.
- Produces (used by task 5): `initAccount()`, `signIn()`, `signOut()`, `deleteCloudData()`, `accountState() → { user: {uid,name,email,photo}|null, status, lastSyncAt, error }`, events `lockin:account` and `lockin:sync`.

- [x] **Step 1: Implement** — boot restore (flag → load SDK → `onAuthStateChanged` → `startSync`/`stopSync`); web sign-in via `signInWithPopup` with `signInWithRedirect` fallback and `getRedirectResult` completion at boot; native sign-in via `Capacitor.Plugins.FirebaseAuthentication.signInWithGoogle({ skipNativeAuth: true })` → `GoogleAuthProvider.credential(idToken, accessToken)` → `signInWithCredential`; sign-out clears the flag and calls the native plugin's signOut; status events on every transition. Every network path inside try/catch; offline sign-in shows a hint, never throws.
- [x] **Step 2: Run** `npm run check` + `npm run lint`.
- [x] **Step 3: Commit** — `Account module: Google sign-in, web + native (plan 3)`

### Task 4: Sync engine (`app/assets/js/sync.js`)

**Files:**
- Create: `app/assets/js/sync.js`

**Interfaces:**
- Consumes: core merge functions (task 1), `loadFirebase` (task 2), `Store`.
- Produces (used by tasks 3, 5): `startSync(user)`, `stopSync()`, `syncNow(reason)`, status via `lockin:sync` events.

- [x] **Step 1: Implement** — shadow + cursor persisted in `lockin.sync.v1`; `syncNow` = pull (full when cursor is 0, else `where('updatedAt','>',cursor)` paged at 500) → merge into the store under a re-entrancy guard → push (diff → stamped `updatedAt` → chunked `writeBatch`, tombstones for removals) → snapshot shadow → advance cursor. Debounced 1.5 s push on `lockin:changed`; immediate cycle on tab focus, `online`, and manual calls. Status events: `syncing`, `idle`, `offline`, `error`.
- [x] **Step 2: Run** `npm run check` + `npm test` + `npm run lint`.
- [x] **Step 3: Commit** — `Sync engine: shadow diff, pull, push, cursors (plan 4)`

### Task 5: Boot wiring, Settings account card, service worker

**Files:**
- Modify: `app/assets/js/app.js` (call `initAccount()`)
- Modify: `app/assets/js/views/settings.js` (Account card; About copy)
- Modify: `app/sw.js` (precache the four new files; cache-first for `gstatic.com/firebasejs/`)

**Interfaces:**
- Consumes: `accountState`, `signIn`, `signOut`, `deleteCloudData`, `syncNow` (tasks 3–4).

- [x] **Step 1: Settings Account card** — signed out: one honest line + "Sign in with Google"; signed in: name/email, live sync status line, **Sync now**, **Sign out**, **Delete cloud data** (sheet-confirmed, deletes only the cloud copy). Card renders on web and native.
- [x] **Step 2: About copy** — "No account" line becomes "optional account" wording consistent with privacy.md.
- [x] **Step 3: app.js** — `initAccount()` after `startNative()`.
- [x] **Step 4: sw.js** — add `core/sync.js`, `assets/js/firebase.js`, `assets/js/account.js`, `assets/js/sync.js` to PRECACHE; cache-first branch for `www.gstatic.com/firebasejs/*` (versioned URLs are immutable).
- [x] **Step 5: Run** `npm run check` + `npm run lint` + `npm test`.
- [x] **Step 6: Commit** — `Account card in Settings, boot wiring, SW caching (plan 5)`

### Task 6: Android wiring

**Files:**
- Modify: `package.json` (+`@capacitor-firebase/authentication`)
- Modify: `.gitignore` (+`android/app/google-services.json`)
- Modify: `docs/android.md` (sign-in note)

**Interfaces:**
- Consumes: the conditional `apply plugin: 'com.google.gms.google-services'` already present in `android/app/build.gradle` (classpath 4.4.4 already in the root build.gradle — no Gradle edits needed).

- [ ] **Step 1:** `npm install @capacitor-firebase/authentication --legacy-peer-deps` (peer `firebase` is only needed by the plugin's web implementation, which Lockin never loads).
- [ ] **Step 2:** `npx cap sync android` — wires the plugin + copies web assets.
- [ ] **Step 3:** gitignore `google-services.json` (contains project identifiers; keep it out of a public repo).
- [ ] **Step 4:** Verify the Gradle graph still builds: `assembleDebug` with `JAVA_HOME` set to the Android Studio JBR.
- [ ] **Step 5: Commit** — `Android: Capacitor Firebase Auth plugin + config gitignore (plan 6)`

### Task 7: Docs, changelog, version 1.6.0

**Files:**
- Modify: `docs/privacy.md`, `docs/architecture.md`, `README.md`, `CHANGELOG.md`
- Modify: version homes via `npm run bump -- 1.6.0`

- [ ] **Step 1:** privacy.md — what sync means: data mirrors to the owner's own Firestore doc tree, rules are the lock, sign-out keeps local data, "Delete cloud data" is real.
- [ ] **Step 2:** architecture.md — the sync section: slices, merge rules, cursors, tombstones, honest limits (clock skew, no realtime listeners).
- [ ] **Step 3:** README — premise line ("optional account"), feature bullet, status line.
- [ ] **Step 4:** CHANGELOG 1.6.0 entry; `npm run bump -- 1.6.0` (versionCode 160).
- [ ] **Step 5: Commit** — `v1.6.0: docs, changelog, version bump (plan 7)`

### Task 8: Final verification

- [ ] **Step 1:** `npm run check`, `npm test`, `npm run lint` all green; push.
- [ ] **Step 2:** Report to the owner: what shipped, what to test on the device (sign-in round), and what queues next (Home rebuild → Focus redesign → extension limits → Android alarm → app blocking).
