# Production-Readiness & Design Plan — Lockin v1.5.0

**Date:** 2026-11-04
**Status:** Draft — awaiting owner approval
**Scope:** Web PWA (`app/`), Chrome extension (`extension/`), Android shell (`android/`), docs & CI
**Based on:** Full audit of v1.4.1 (`main` @ `950bb84`, tag `v1.4.1` shipped 2026-11-04)

---

## Audit — where the project honestly is

**Solid foundations (keep as-is):**

- One coherent design language across all five tabs: Fraunces serif display type,
  IBM Plex Mono micro-labels, single lime accent, token-driven dark theme
  (`app/assets/css/app.css`). The v1.4.1 onboarding film is the most polished surface.
- A real session engine: timestamp-based (`focus.js` uses `Date.now()` deltas, not
  interval counting), survives reload/restart, snapshots every 15s, honest
  grace/rescue model. No timer-drift bug — this was checked specifically.
- 51 pure-logic tests that run in-app (`app/tests.html`) — but see gap #1.
- Honest empty states everywhere; no demo data. Privacy-clean: one localStorage
  key, no accounts, no telemetry (`docs/privacy.md` is accurate).
- Extension blocking works via declarativeNetRequest with a redirect page.

**Production gaps (what "not a proper app" is made of right now):**

1. **Tests never run automatically.** `.github/workflows/check.yml` runs only
   `npm run check` (syntax + manifest lint). The 51 logic asserts in
   `app/tests.html` are manual. No linting (`package.json` has no `test`/`lint`
   scripts at all).
2. **Version pinning is hand-synced** across `package.json`, `package-lock.json`,
   `app/sw.js` (`lockin.v1.4.1`), `android/app/build.gradle` (141/1.4.1), and
   version stanzas in 5 docs; `tools/check.mjs` only cross-checks `app/` ↔ package.json.
3. **Android ships debug-signed only.** No signing config, no release build, no
   on-device test pass yet (no device was attached during the audit).
4. **Interaction robustness gaps:** `ui.js` `openSheet()` has no Escape handler
   and no focus trap (role=dialog but not modal); Service Worker has no
   "update ready" prompt (stale users only refresh when SW byte-check happens);
   storage-quota and import failures don't surface; `Store.set` has no
   try/catch around `localStorage` writes.
5. **Documented-but-unshipped features** erode trust: device-wide Android
   blocking ("a documented tier, not shipped" — `docs/architecture.md` line 26),
   web push (alarms only ring while a tab is open), extension only counts the
   active tab.
6. **Accessibility floor not met:** no `:focus-visible` styling pass, sheets not
   keyboard-closable, several content-bearing mono captions sit at 9.5–10.5px.
7. **Design debts found in screenshots** (home / schedule / stats / focus /
   walk-through, taken at 430×932 dark):
   - **Focus**: starting a session is a two-tap flow (pick chip → "Set the
     timer"); the `Pomodoro ×3` pill is an unexplained magic affordance.
   - **Schedule**: two stacked "Add a block" primary buttons (hero + empty card).
   - **Home**: the "Focused" goal bar renders invisible at 0% (`tbar` has no
     visible track); the tile's number could carry the hero weight.
   - **Microtype**: content-bearing labels (`film-perm` pill, `gm-*` captions)
     at 9.5–10.5px mono are at the legibility floor.
   - **Light theme**: `theme` setting exists in code but no view-by-view light
     audit was ever done (token leaks likely: hard-coded rgba + color-mix mixes).

## What "production" means here (definition of done)

A new user on any of the three surfaces: installs without confusion, gets
onboarded in ≤2 minutes with zero required permissions, runs a session that
never loses its minutes, can fix or discover any permission without reading
docs, and never sees a dead end. Repo-side: tests + check + lint green in CI on
every push; every release artifact release-signed and documented; no feature
promised in docs that isn't shipped.

---

## Global Constraints

- **No build step.** The web app ships hand-written ES modules (`app/assets/js/*.js`)
  consumed directly; no bundler, no transpile. New code stays plain ES2022 modules.
- **One data store.** Everything stays in `lockin.store.v1` (localStorage), schema
  version `v: 1`. No server, no accounts. Sync/Firebase is explicitly out of scope
  (blocked on owner's Firebase project).
- **Honesty stance is non-negotiable.** No demo data, no seeded samples, no
  required permission, copy never overpromises.
- **Design changes go through tokens** (`app/assets/css/app.css` custom props) —
  no hard-coded colors, no new frameworks, no new fonts without a token.
- **Every task** ends with `npm run check && npm test` green (from Phase 0 on) and
  one commit, pushed. No browser testing during implementation — on-device and
  on-site passes happen together with the owner afterwards.
- **Docs and code move together:** every view/behavioral change updates
  `CHANGELOG.md` (unreleased section) and the README feature line in the same commit.

---

## Phase 0 — Guardrails (CI, tests, versions) — est. 1 day

### Task 0.1: Extract the 51 logic tests into a Node-runnable suite

Files: new `app/assets/js/tests.mjs`, new `tools/run-tests.mjs`, `app/tests.html`, `package.json`.

- [x] Step 1. Move the assert suite body out of the inline `<script type="module">`
      in `app/tests.html` into `app/assets/js/tests.mjs` exporting
      `runSelfCheck(reporter)` where `reporter = { group(name), ok(name), bad(name, err) }`
      and a mutable `summary()` returning `{ pass, fail }`. Keep all assert wording
      identical. The five DOM-factory asserts stay behind a `dom: true` flag
      (they need a real document).
- [x] Step 2. `app/tests.html` keeps its page but now imports the shared suite and
      renders the same rows it does today (same CSS classes, same summary line).
- [x] Step 3. `tools/run-tests.mjs`: stubs `globalThis.localStorage`,
      `self`, `document` (util.js creates a `<template>` at parse time) before a
      dynamic `import('../app/assets/js/tests.mjs')`, runs
      `runSelfCheck` with a console reporter, exits `1` if any assert fails,
      prints `npm test: 46/46 passed` (the browser page adds the five
      DOM-factory asserts for the full 51).
- [x] Step 4. `package.json`: add `"test": "node tools/run-tests.mjs"`. Delete the
      old inline suite from `tests.html` (keep the page + reporter wiring).
- [x] Step 5. Verify: `npm test` prints 46/46; `npm run check` reports 30 modules
      parse; the browser page still shows 51/51 (owner pass).

### Task 0.2: ESLint flat config

Files: new `eslint.config.js`, `package.json` (`devDependency: eslint`, script `lint`).

- [x] Step 1. `eslint.config.js`: flat config, `languageOptions.ecmaVersion 2024`,
      `sourceType: 'module'`, browser globals; rules = `eslint:recommended` minus
      style-only rules (`no-unused-vars` at warn, `prefer-const` off). Ignore
      `dist/`, `android/app/build/`, `app/assets/fonts/`, `tools/gen-*.ps1`.
- [x] Step 2. Add `"lint": "eslint ."` script. Fix every error it raises (expect a
      handful: unused vars, unreachable code). Warnings allowed only if reasoned
      with an inline disable comment.
- [x] Step 3. Verify: `npm run lint` exits 0; `npm run check && npm test` still green.

### Task 0.3: Single-source version bumping

Files: new `tools/version.mjs`, edit `tools/check.mjs`, `.github/workflows/check.yml`.

- [x] Step 1. `tools/version.mjs <semver>`: updates `package.json` and
      `package-lock.json` directly (deterministic JSON rewrite, no npm spawn),
      `app/sw.js` `VERSION` const, and `android/app/build.gradle` (`versionCode`
      = Major×100 + Minor×10 + Patch, `versionName` = semver). Prints a diff
      summary. Exposed as `npm run bump -- <semver>`.
- [x] Step 2. Extend `tools/check.mjs` with a version-consistency block:
      package.json ↔ package-lock.json ↔ app/sw.js ↔ android/app/build.gradle must
      all agree; fail with the disagreeing file listed.
- [x] Step 3. `.github/workflows/check.yml`: after `npm run check`, add
      `- run: npm run lint` and `- run: npm test`.
- [x] Step 4. Verify: push a trivial commit; CI shows three green steps.

---

## Phase 1 — Web robustness (the session promise) — est. 1 day

### Task 1.1: Bottom sheet keyboard + focus correctness (TDD-able in logic only)

Files: `app/assets/js/ui.js`, `app/assets/css/app.css`.

- [x] Step 1. `openSheet()`: set `aria-modal="true"`, remember
      `document.activeElement`, focus the sheet's first focusable child. Add a
      `keydown` listener on `document` while a sheet is open: `Escape` → `closeSheet()`.
- [x] Step 2. Focus trap: on `Tab`, cycle within `sheetEl` (first ⇄ last); on
      `closeSheet()`, restore focus to the remembered element. Cleanup: remove the
      keydown listener inside `closeSheet` (mirror the `sceneCleanup` pattern in
      `walkthrough.js`).
- [x] Step 3. Focus ring: already present — `app.css:175` has a global
      `:focus-visible { outline: 2px solid var(--acc); outline-offset: 2px }`.
- [x] Step 4. Verify: `npm run check`; manual keyboard run happens in the-owner
      pass afterwards.

### Task 1.2: SW update prompt

Files: `app/assets/js/install.js` (or wherever `serviceWorker.register` lives).

- [x] Step 1. On `registration.onupdatefound`, wait for `newWorker.statechange` →
      `installed` while `navigator.serviceWorker.controller` is present, then call
      `hint('Update downloaded — restart Lockin to refresh')` once.
- [x] Step 2. Guard: don't show if worker already took over (there is no
      `skipWaiting` in `sw.js`, so the one-shot behavior holds by construction).
- [x] Step 3. Verify: `npm run check`; note in CHANGELOG unreleased section.

### Task 1.3: Storage hardening

Files: `app/assets/js/store.js`, `app/assets/js/views/settings.js`.

- [x] Step 1. Wrap the localStorage write in `Store.set` in try/catch; on
      failure keep the in-memory state live and dispatch a one-shot
      `lockin:storage-full` event (only on the transition into failure);
      `app.js` surfaces `hint('Storage is full — export a backup from
      Settings, then free space')` once per episode.
- [x] Step 2. Import path: already honest — `settings.js` catches and shows
      `hint('That file is not a Lockin backup.')`; `importJSON` throws on
      corrupted JSON and on a wrong `v`.
- [x] Step 3. Add pure-logic tests to `tests.mjs`: corrupted-JSON import
      throws and leaves state untouched; a wrong-version backup is rejected;
      a valid export round-trips through reset + import.
- [x] Step 4. Verify: `npm test` (49/49), `npm run check`, `npm run lint`.

### Task 1.4: Session engine edge-case tests

Files: `app/assets/js/tests.mjs`.

- [x] Step 1. Add asserts (pure logic, no DOM): `sessionMins` never negative
      (defect found and fixed — a malformed session could subtract minutes);
      overnight blocks: `occurrenceOn` ends the next calendar day,
      `eventsBetween` emits the start inside the evening window, emits nothing
      twice across midnight, `nextOccurrence` keeps the block ongoing just
      after midnight, `normalizeSchedule` keeps an overnight end as written.
      (`decideAway` boundaries, `earnedExit` and stopwatch `sessionMins` were
      already covered by the existing suite.)
- [x] Step 2. Verify: `npm test` count grows by ≥6 asserts (49 → 55 tests);
      all green.

---

## Phase 2 — Design pass (fix what the screenshots showed) — est. 1–2 days

### Task 2.1: Focus screen — one decision per step

Files: `app/assets/js/views/focus.js`, `app/assets/css/app.css`.

- [x] Step 1. Duration chips are direct starts: tapping `10m`–`90m` begins the
      session immediately (strict or not); the existing 20-second accident
      window is the undo, surfaced as an 8s `undo-toast` pill ("Started by
      accident?") that calls the same free-stop path. The armed hold stays
      for the stopwatch; the timer footer button is gone (there is no custom
      duration field — chips were always the only picker).
- [x] Step 2. The Pomodoro pill now says what it does:
      `Pomodoro · 25m ×3` with an expanded aria-label; the chained end time
      was already shown by the projection line.
- [x] Step 3. `ends ≈` projection bumped to 12px; the running screen gains a
      truthful `Ends at HH:MM` note (with the strict reminder when strict is on).
- [x] Step 4. Verify: `npm run check`; copy changes recorded in CHANGELOG.

### Task 2.2: Schedule — one add affordance

Files: `app/assets/js/views/schedule.js`, `app/assets/css/app.css`.

- [x] Step 1. Keep exactly one primary "Add a block": the hero card button. The
      empty "Nothing scheduled today" card lost its button and now points at
      the always-present header `+`: "A repeating block takes the decision
      out of the moment — the + in the top corner adds one."
- [x] Step 2. The day ring's count line (`sched-count span`) raised to the
      11px floor (was 10.5px).
- [x] Step 3. Verify: `npm run check`; only one `btn-primary "Add a block"`
      remains (the hero CTA); the Repeating section keeps its own scoped
      subtle buttons by design.

### Task 2.3: Home — make the goal count

Files: `app/assets/js/views/home.js`, `app/assets/css/app.css`.

- [ ] Step 1. Give `.tbar` a always-visible track (1px `--line-2` border +
      `min-height: 3px`) so 0% still reads as a meter.
- [ ] Step 2. Bump the `Focused` tile value to the largest type on the strip
      (currently ties with Streak); captions keep the ≥11px floor.
- [ ] Step 3. Verify: `npm run check`; screenshot pass deferred to owner testing.

### Task 2.4: Microtype floor + light-theme audit

Files: `app/assets/css/app.css`, all views (token-level only).

- [ ] Step 1. Sweep every content-bearing font-size below 11px in `app.css`
      (grep `font-size: 9\.|10\.`): raise to 11px where the text carries meaning
      (perm pill, gm captions, tile captions, footer mono), leave decorative
      letterspaced kickers as-is by design.
- [ ] Step 2. Light theme audit (code-level): grep hard-coded `rgba(`/`#` colors
      and `color-mix(... var(--panel-2) ...)` mixes that assume dark; replace with
      tokens so `theme: 'light'` renders correctly in every card, sheet, film and
      tab bar. Record any true leaks fixed.
- [ ] Step 3. Verify: `npm run check` CSS-brace check passes; owner-side
      side-by-side dark/light screenshots happen in the testing pass.

### Task 2.5: Accessibility floor

Files: `app/assets/css/app.css`, `app/assets/js/views/*.js`.

- [ ] Step 1. `:focus-visible` token + tab-bar targets ≥44px (`--tap-min`).
- [ ] Step 2. `aria-live="polite"` on the focus running-clock container; tab bar
      links get `aria-current="page"` when active (check router `mount`).
- [ ] Step 3. Verify: `npm run check && npm test`; keyboard walkthrough with owner.

---

## Phase 3 — Android release engineering — est. 1 day + owner device time

### Task 3.1: Release signing setup

Files: `android/app/build.gradle`, new `android/keystore.properties.example`,
new `docs/android-release.md`, `.gitignore`.

- [ ] Step 1. Add `signingConfigs.release` reading `storeFile`, `storePassword`,
      `keyAlias`, `keyPassword` from `android/keystore.properties` (gitignored);
      wire `buildTypes.release`. Add the example file with assembled placeholders.
      If properties are missing, the release build fails fast with a named error.
- [ ] Step 2. `docs/android-release.md`: one-page keygen (`keytool`),
      properties-file template, `npm run android:build -- assembleRelease`
      produces `app-release.apk`, artifact naming follows
      `dist/lockin-<version>-release.apk`.
- [ ] Step 3. Verify: `gradlew assembleDebug` still passes locally (no device
      needed); assembleRelease blocked only on the keystore file (owner creates it).

### Task 3.2: On-device QA checklist (owner-gated)

Files: new `docs/android-qa.md`.

- [ ] Step 1. Write the checklist as literal tap-by-tap assertions: walkthrough
      permission rows on a real device, exact alarm firing with the app swiped
      away, usage-access panel matching a 7-day browser/ad-aware profile, retry
      on revoked permission, alarm tap route opening the right block.
- [ ] Step 2. Leave the checklist at 0/checked — the owner runs the pass in his own
      test round ("we will test afterwards").

### Task 3.3: Un-promise what isn't shipped (decision-dependent)

Files: `docs/architecture.md`, `README.md`, `docs/privacy.md`, `CHANGELOG.md`.

- [ ] Step 1. If the owner keeps device-wide blocking unshipped (Review Focus row 5),
      rewrite architecture.md's Android row and the README's tier language so docs
      only describe shipped behavior. Otherwise skip — the feature build replaces
      this task and becomes its own plan.

---

## Phase 4 — Decisions that need the owner (reviewed, then planned)

These are approval gates, not code tasks in this plan:

- [ ] **Device-wide blocking tier (Android)** — build (usage-access listener +
      app-launch interception; largest Unreal risk) vs. de-document. Owner decides.
- [ ] **Per-site time limits (extension)** — currently all-or-nothing until
      `blockUntil`. If wanted: per-domain daily budget in `chrome.storage`, DNR
      dynamic-rule swap at budget end. Owner decides.
- [ ] **Sync (Google login, Firestore)** — blocked; needs the owner's Firebase
      project keys before any code.
- [ ] **Play Store listing** — needs release signing first; then listing copy,
      screenshots, and the privacy policy URL already at `docs/privacy.md`.
- [ ] **Push-based web alarms** — would need a push server; the honest
      "open tab can ring, closed tab can't" copy stays until the owner opts in.

---

## Review Focus (the five rows)

| # | Decision | Why it's the risky/borderline call |
|---|---|---|
| 1 | **Focus chips start instantly** (Task 2.1) — replaces the two-tap flow with tap-to-start + 8s Undo. | Changes the app's most-used interaction; mis-taps become real sessions. The Undo pill is the safety net — approve the interaction contract. |
| 2 | **Schedule loses its second "Add a block"** (Task 2.2). | The hero card keeps the only CTA; the empty card becomes a hint.OwnerId of the empty-state copy decides if the arrow is enough. |
| 3 | **Logic tests move out of tests.html into `tests.mjs`** (Task 0.1) — Node + browser share one suite with a stubbed localStorage. | Touches the only test infrastructure there is. If it breaks, CI goes red on the next push — hence it's Phase 0 and gets its own commit. |
| 4 | **Release signing via gitignored `keystore.properties`** (Task 3.1). | Standard pattern, but the keystore itself must live somewhere safe; losing it means a new app identity on Play. Owner owns that risk in his keygen doc. |
| 5 | **Device-wide blocking: build vs. de-document** (Phase 4 / Task 3.3). | The honest doc pass makes the app smaller; building the tier is a second project. Owner must pick one — the plan does not silently keep the promise. |

## Self-review

- **Spec coverage:** every audit gap (#1–#7) maps to a task: 1→Phase 0, 2→0.3,
  3→Phase 3, 4→Phase 1, 5→Phase 4/3.3, 6→2.5, 7→Phase 2. Nothing from the
  screenshots is left unowned.
- **Exact interfaces:** `runSelfCheck(reporter)`, `tools/version.mjs <semver>`,
  permission-row reuse of `paintPerm` in `walkthrough.js`, sheet focus via
  `document.activeElement`. Names are given where new symbols are created.
- **Tests:** TDD where logic exists (1.3, 1.4); UI/interaction tasks are verified
  by `npm run check`, code review, and the owner's device pass. No new framework
  is introduced.
- **Size:** every task is ≤1 file-cluster, commits stay small, each phase ends
  shippable. Phase 2 touches only CSS + two view files per task.
- **Assumptions checked rather than invented:** the timer has no drift bug
  (verified by reading `focus.js`'s `Date.now()` math); CI exists but is thin
  (verified `check.yml` line-by-line); light theme exists in code but was never
  audited (stated as unverified, not as broken).
