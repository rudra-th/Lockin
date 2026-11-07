# Changelog

All notable changes to Lockin. The web app and extension share a version line;
the Android shell follows once it ships.

## 1.17.0 — 2026-11-07

### Strict mode, held by the phone

- **A live strict session now has a foreground service.** `StrictSessionService`
  keeps the process warm with a quiet, ongoing notification for exactly as long
  as the session runs, and stops the moment it ends. It never starts on its own.
- **Device owner gets the hard lock.** Where Lockin is device owner, strict mode
  enters lock task with the user’s allowlist, disables lock-task escape hatches,
  and blocks uninstalling the app until the session ends. Without device
  ownership it falls back to screen pinning — which Android always lets the user
  unpin — and the Focus screen says so.
- **Reboot does not quietly end it.** If a strict deadline survived a reboot,
  `BootReceiver` reopens Focus so the web layer can restore the session and
  re-arm the lock. An expired deadline still fails open.
- **Split-screen and floating windows are covered.** The accessibility service
  watches window changes, counts visible app windows, and covers the whole
  surface when a second app sits beside an allowed one. It still reads no
  window content, text, node trees or keystrokes.
- **Smaller release APK.** R8 minification + resource shrinking are on, with
  keep rules for Capacitor, its plugins and the Lockin bridge. The self-check
  page and its 37 KB module are stripped from packaged assets instead of
  shipping to phones.
- Bumped to 1.17.0 (versionCode 270).

## 1.16.0 — 2026-11-07

### The Instrument — the whole app, rebuilt around one action

- **A new visual system.** Near-black canvas, two surfaces, one hero and one
  primary action per screen. Hanken Grotesk for the interface, Fraunces for the
  two places that deserve it (the Home line and the done screen), IBM Plex Mono
  for clocks and figures. Lime is reserved for the action that matters.
- **Five tabs, one job each: Home · Plan · Focus · Phone · You.** Progress left
  Settings for its own screen; Settings is now a short hub of four groups.
- **Home** answers “what now?” with today’s minutes against the target, the next
  block and the week strip. The strip opens Progress.
- **Focus** opens on a setup screen: timer or stopwatch, rounds and a Strict
  Mode switch. Strict mode blocks every app outside your allowlist, hides pause,
  and makes ending a long hold that forfeits the running segment — rounds you
  already finished stay banked.
- **Phone** leads with the week chart, today’s total and the top apps. **More**
  opens a full screen-time screen with 7- or 30-day ranges, per-day totals and
  each day’s app breakdown, including past days.
- **Progress** is a dedicated record screen. **Settings** is four grouped
  sections: Study & focus, Screen & alerts, Account & sync, Data & backup.
- **Light theme is warm paper**, not an inversion. Theme follows the system by
  default and remains switchable in Settings → You.
- **Fixes**
  - A schedule start marks its whole occurrence as fired, so a reminder due in
    the same lookback cannot ring “in 0 min” on the next tick.
  - Deleting cloud data resets the public-summary signature, so the next sync
    republishes instead of skipping.
  - Share previews are generation-guarded; a slow older render can no longer
    overwrite a newer one.
  - Settings removes every document listener on unmount instead of waiting for
    a later event to notice the card is gone.
  - Holding the end control through navigation is cancelled cleanly.
- Native usage now reports each day’s top apps for the last 30 days; older
  snapshots still fall back to today’s list.

## 1.15.1 — 2026-11-07

### Share the card, for real

- **Sharing now shares the image.** The share button sends the rendered card as
  a PNG through the Android share sheet (or the Web Share API where files are
  supported) instead of copying a caption. Download is the fallback.
- **A square card, drawn at 2×.** Today's card is 1:1 (2160 × 2160) with the
  status pill, ring, seven-day rail and credit redrawn at export size. The week
  card exports at 2160 × 2700.
- Bumped to 1.15.1 (versionCode 251).

## 1.15.0 — 2026-11-06

### On the home screen — widget and Quick Settings tile

- **Home-screen widget.** Today's focus minutes against the target, the current
  streak and the next block, on the launcher. It redraws whenever the app
  writes, and tapping it opens Lockin. `Settings → Android → Home screen → Pin
  widget` asks the launcher to place it where pinning is supported; otherwise a
  long-press on the home screen adds it.
- **Quick Settings tile.** A **Focus** tile opens the Focus setup screen — it
  never starts a session on its own, because the hold on the ring is the
  consent. The tile reads active while a session is running and inactive
  otherwise.
- **One snapshot, no second source of truth.** The store stays authoritative.
  The app mirrors minutes, target, streak, next block and live state into
  device-local preferences (`lockin_widget`) and native redraws both surfaces
  from that copy. Nothing here is synced or uploaded.
- **Route handoff.** A tapped tile now asks for any screen (`/focus`), not just
  Schedule; `MainActivity` passes it to the router on cold and warm starts.
- Bumped to 1.15.0 (versionCode 250).

## 1.14.0 — 2026-11-06

### Clean slate — daily targets replace the honesty log

- **The slip system is gone.** No slips, rescues, away detection, Honesty Log,
  earned exits or clean-day rules. Local `slips` and the old
  `settings.strict` / `minClean` / `exitGraceMin` keys are deleted by the store
  migration. The cloud `users/{uid}/slips` collection is deleted once per
  account on the first v1.14 sync; nothing is archived.
- **Daily target is the only judge.** A day counts when its focused minutes
  reach the target that was set on that day. `settings.goalHistory` records
  every target change, so a new goal never rewrites yesterday. Streaks, the
  Progress heatmap and the weekly card now count target days.
- **Study Mode without punishments.** Every session opens the intention screen;
  a ~1.5 s hold starts it. Ending is a ~1.4 s hold with no confirm sheet and no
  second gate. Minutes before an early end stay banked; under 20 seconds the
  session is discarded. Strict Mode is now just the full-screen room, wake lock
  and hold.
- **Start or skip the block.** Schedule alarms carry the occurrence identity,
  so the notification and the full-screen alarm offer **Start session** and
  **Skip today**. A skip is stored in `settings.blockSkips` and hides the
  occurrence from the next-block hero. Actions tapped while Lockin is closed
  are queued natively and applied on the next boot or resume.
- **Daily check-in.** One quiet notification a day (20:00 by default,
  adjustable, on/off) that says how much of today's target is left. It fires
  once and only while the target is still unmet. The pre-block reminder carries
  the same target line.
- **Share the week.** The share card now sums the last seven days: total
  minutes, target days, best day, top completed task and the current streak.
- **Lockin does not count itself.** Its Android package is filtered from every
  usage row and daily total, and `lockin.surge.sh` is ignored by the extension.
- **Kiosk stays opt-in.** The Android kiosk is a separate `settings.kiosk`
  switch, relabelled from "Strict mode" to **Kiosk** throughout, with the same
  fail-open deadline.
- **Old clean-day streaks will recompute.** Past days are re-measured against
  the target that applied on each day, so a streak may be shorter or longer
  than the one you remember.

## 1.13.1 — 2026-11-06

### Share the day — and take it to the browser

- **Share card.** Once today's target is met, Home and the done screen offer
  **Share today**: a 1080×1350 PNG with the date, focus time, a ring filled
  against the target (plus an over-target arrow), the student's name and the
  Lockin mark. It shares through the Web Share API where files are supported and
  falls back to a download with the caption copied. The "made by Rudra" credit
  can be hidden before sharing.
- **Cloud summary for the extension.** Focus minutes, daily goal and phone
  screen time now sync, and the app publishes a read-only `public/{code}` summary
  so the extension can show the phone's week after a one-time pairing code.
  The Google email stays in the private tree and is never published.
- **Pairing in Settings.** Settings → Account shows the code, lets you copy it
  or rotate it, and the extension popup links with a paste.
- **Quieter sync.** Identical remote data no longer counts as a change, cycles
  wait for real local edits, the indicator settles instead of flashing, and
  polling is slower.
- **Profile picture fix.** Google avatars now resolve through the provider and
  native Google result, with an initial fallback when the image cannot load.
- **Mode switch fix.** Starting Study Mode from Home pins the timer once; picking
  Stopwatch by hand now sticks instead of snapping back.
- Removed the old "no analytics / no trackers / no network" copy now that sync
  and the optional phone summary are real.

### Release

- Bumped to 1.13.1 (versionCode 231): signed release APK, extension zip and the
  packed site deploy.

## 1.13.0 — 2026-11-06

### A calmer, easier app — screen time first

- **Control is now the screen-time home.** A seven-day bar chart, today's total,
  the delta against your week's average and the four most-used apps sit at the
  top, next to the limits that act on them. On Android the numbers come from
  `UsageStats`; in the trial they are clearly labelled demo data.
- **One master switch per surface.** App blocking gains a single "Block selected
  apps" switch, and Schedule gains "Schedule on / paused" that pauses or resumes
  every recurring block at once.
- **Bigger touch targets throughout.** Pill buttons at 54px, 46px minimum taps,
  58px switches, 999px radii and calmer flat cards replace the smaller dense
  controls. Card titles are sentence case instead of micro-caps.
- **Less duplication.** The old screen-time card in Settings is now a single
  pointer to Control, so there is one place for usage and one place for limits.
- **Readable labels.** The heatmap, chart and schedule rows use body-size text
  instead of 8–10px uppercase mono labels; repeating blocks show their days as
  words rather than a letter strip.
- The browser trial keeps its honest Android-only upgrade card; the web app at
  `/app/` and the Android APK share the same redesigned source.

### Release

- Bumped to 1.13.0 (versionCode 230): signed release APK, extension zip and the
  packed site deploy.

## 1.12.0 — 2026-11-05

### The landing page, the live trial, the upgrade path

- **lockin.surge.sh is now the landing page** (source in `site/`): hero with the
  live 50-second Study Mode countdown on the stopwatch ring, a screen mosaic, a
  showcase slider, a how-it-works stage, proof figures, FAQ and footer.
- **One domain, two products.** The landing lives at `/`, the product at
  `/app/`, downloads at `/downloads/`, screenshots under `/screenshots/`. The
  pack step `npm run pack:site` stages `dist/site` for the Surge deploy.
- **The live trial** at `/app/?trial=1` runs the real app against a pre-filled
  demo week (14 seeded days of sessions, tasks, schedules and an honest slip log)
  on a local **Test Account** — its own browser store, no Firebase, no network
  call, one-tap Reset, real store untouched.
- **Browser gaps are stated, not hidden.** Control and the Settings Device card
  show an explicit "Only available on the Android app" card with download CTAs
  instead of an empty panel — in the app and in the trial.
- **Root service-worker kill switch** at `/sw.js` retires the 1.11.x root worker,
  so visitors still controlled by the old cached shell land on the landing page
  instead of a stale app.

### Release

- Bumped to 1.12.0 (versionCode 220): signed release APK, extension zip and the
  packed site deploy, GitHub release `v1.12.0`, docs updated.

## 1.11.1 — 2026-11-05

### Google sign-in on Android

- The Capacitor shell now registers `google.com` under
  `plugins.FirebaseAuthentication.providers`. The plugin defaults that list to
  empty, so 1.11.0 threw **“google.com sign-in provider is not enabled”** before
  the native sheet could open. The config is synced into the Android assets and
  the APK rebuilds as versionCode 211, so it installs over 1.11.0.
- Web and extension behaviour is unchanged; they follow the shared version line.

## 1.11.0 — 2026-11-05

### Control, screen time in Settings, strict kiosk

- A new **Control** tab sits between Focus and Settings and owns everything
  device-side: a master app-blocking switch, a searchable picker, one-tap
  distraction presets across Short videos / Feeds & chat / Streaming, per-app
  daily limits with live usage bars, and the strict kiosk. Settings keeps the
  permissions and a one-card pointer.
- The app picker opens as **removable chips of what is blocked**, with the full
  searchable list one tap behind **Browse all apps**, so presets, limits and
  strict mode are visible without scrolling past every installed app.
- **Screen time moved to Settings.** The full card shows today's foreground
  time, top apps, a 7-day rail, a refresh action and an honest usage-access
  empty state. It left Control, the compact progress view and Home, so there is
  one place to read it and one place to grant the permission.
- **Stats moved into Settings → Progress, and Settings is grouped.** The tab bar
  is five tabs. Progress keeps today's goal ring and streak, all-time totals, the
  7-day bars, task completion, the 13-week clean-day heatmap, recent sessions and
  the Honesty Log. The categories are **Study** (rules, rounds, alarms),
  **Device** (screen, alerts, screen time, Android access), **Progress** and
  **You** (profile, appearance, account, data, About); each is addressable with
  `#/settings?section=progress`, and old `#/stats` links redirect there. The About
  card now credits **Made by Rudra** with a GitHub mark linking to
  `github.com/rudra-th`.
- **Per-app daily limits** (15 min–3 h): the accessibility service tracks
  foreground time in local day buckets (pruned to two days), and an app over its
  allowance gets a **Daily limit reached** overlay with the reset time and one
  action home. Limits count only while the service is on, and the card says so.
  Raising an allowance frees the app immediately; midnight resets by day key.
- **Strict study mode** is a real kiosk when Lockin is device owner: lock task
  with `LOCK_TASK_FEATURE_NONE` and the user's allowlist holds the phone, and a
  **Back to Lockin** overlay covers every non-allowed app. Without device owner
  it falls back to screen pinning and labels the state **Limited kiosk** instead
  of pretending. The JS engine refreshes a fail-open deadline that native also
  enforces with a `Handler`, so a killed app cannot leave the phone stuck; a
  stale flag is cleared on boot.
- **Short-video presets** add installed YouTube, Instagram, Facebook, Snapchat,
  TikTok, X, Reddit, Discord, Telegram, WhatsApp, Netflix, Prime Video and
  Twitch to the block list in one tap. The copy is honest: Android sees an app,
  not `/shorts`; the extension blocks the URL itself.

### Opening film, account and Google sign-in

- The name scene gains **Already have an account? → Sign in with Google**, with
  a real four-colour Google mark and a signed-in state that fills the name.
- A new **account scene** offers create-account-or-sign-in before the rules, and
  a quiet **Not now — keep it on this device** route. Skipping Google is never
  punished; the tour no longer assumes an account.
- The permissions scene now asks for all five Android capabilities —
  notifications, exact alarms, full-screen alarms, the accessibility service and
  usage access — each with live status and a direct action, and it fits a 390 px
  phone without hiding the last row.
- **Google sign-in fixed on both surfaces.** The native path tries Credential
  Manager, then retries the legacy Google sheet once on a non-cancel failure,
  validates the ID token and reports a real error. The web path sets the cloud
  flag before a redirect fallback and finishes through `getRedirectResult`.
  A new pure `core/auth-errors.js` turns every Firebase, Play services and
  Capacitor failure into one actionable sentence; cancellations stay silent.
- Debug APKs now sign with the release keystore whenever
  `android/keystore.properties` is complete, matching the certificate
  registered with Google. No more `DEVELOPER_ERROR` from a test build.

### Extension

- **Shorts & Reels blocking**, on by default: pure path matching for YouTube
  Shorts, Instagram Reels, Facebook Reels and Snapchat Spotlight, dynamic DNR
  rules with `why=shorts`, an in-page navigation check, and a blocked page that
  names the feed and offers a way back once the toggle is off.
- Audit fixes: a manual block redirects immediately, sleep/quit credit is capped
  so a closed laptop cannot bank hours, popup writes re-read state before
  mutating it, subdomains canonicalise to the saved domain, and an expired block
  gets a real **Back to the site** route.
- The popup now announces each change through its own live region instead of
  making the whole panel live, names every stepper, checkbox and duration
  button, and puts focus back on the control that changed (or on the heading
  when it disappears). Tertiary text was lightened to clear WCAG AA.
- Adding a site explains a bad entry instead of silently doing nothing, and
  says when the site is already on the list.

### Accessibility and contrast

- Every settings switch, stepper and segmented control now takes its
  accessible name from the row ("Strict Mode", "Daily focus goal"), stepper
  values announce their changes, and progress bars expose a label and value.
- A dedicated route announcer replaces `aria-live` on the whole view: a screen
  reader hears "Settings screen" once per navigation instead of every timer
  repaint. Tab changes also update the document title and reset the scroll
  container.
- Navigating to a tab now moves focus to that screen's heading, and each
  opening-film scene focuses its new title, so keyboard and screen-reader users
  start at the top instead of on the button that vanished. Starting, pausing,
  resuming or ending a session does the same inside Study Mode.
- The accident-window undo pill sits just above the stop controls, so it no
  longer covers the daily-target meter.
- Text and accent tokens meet WCAG AA in both themes. The light accent and
  warning colours were darkened, and the `data-theme` token block is scoped to
  `:root` so theme-preview buttons cannot inherit the other theme.
- Reduced motion turns off smooth scrolling too, and decorative SVGs are
  hidden from assistive technology.
- Small phones: on a 320 px screen the Schedule hero stacks its ring, Settings
  gives wide steppers and segmented groups their own line, and the pomodoro
  chip no longer breaks mid-label.

### Verification and docs

- `npm test` 88/88 (new short-video, auth-error and limit groups), `npm run
  check` and `npm run lint` clean; `assembleDebug` and `assembleRelease` build.
- `docs/android.md`, `permissions.md`, `privacy.md`, `architecture.md`,
  `README.md` and `extension/README.md` updated for Control, limits, strict
  kiosk, the signing rule and short-video URL blocking.

## 1.10.0 — 2026-11-04

### App blocking on Android

- Settings → Android gains an **App blocking** card: the accessibility service
  state with a route to system settings, a master switch, a searchable picker of
  launchable apps, and a live "blocking now / next window" line.
- `LockinAccessibilityService` listens to one event — a window came to the
  front — and reads only the foreground package. `canRetrieveWindowContent` is
  off; no text, page content or keystrokes. Launchers, Settings, the dialer and
  Lockin itself are never covered, even by a stale saved list.
- During a schedule block or a running/paused Study Mode session, a
  `TYPE_ACCESSIBILITY_OVERLAY` covers a chosen app with the block name, a live
  countdown, a progress bar and one action: **Leave this app** → home. Breaks
  are free; an overnight block is still a block after midnight.
- Windows are computed in the web app for the next 14 days — including a block
  already running after midnight — plus the live session, and pushed on boot,
  background and every session change. A stopwatch has no planned end, so it
  covers four hours from the last push, rounded to a quarter hour. A new pure
  `occurrencesBetween` helper and tests cover the overlap and horizon cases.
- The config is device-local `SharedPreferences`, never synced. The app picker
  uses a narrow MAIN/LAUNCHER `<queries>` entry, not `QUERY_ALL_PACKAGES`.
- Fail open, always: service off, empty list, no active window, Lockin in front,
  or a protected app means no overlay. A 15-second safety check covers an app
  already open when a window starts. Honest limit: it is a focus aid, not a
  lock — Android lets the user turn the service off at any time.
- Docs: `android.md` now describes the bridge contract, the overlay, the
  permission scope, the Play policy cost and the limitation; `permissions.md`,
  `privacy.md`, `architecture.md` and the README follow.

## 1.9.0 — 2026-11-04

### Android alarms can take the lock screen

- A schedule **start** now asks for a full-screen alarm. `AlarmActivity` turns
  the screen on, draws over the keyguard with the current time, the block name
  and its time range, and offers **Dismiss** / **Open Lockin**. Reminders stay
  quiet notifications.
- Android 14+ decides whether an app may use full-screen intents. The receiver
  checks `canUseFullScreenIntent()` on every alarm; when it is denied, the same
  alarm posts as a loud heads-up notification on the alarm channel. Nothing
  pretends the screen will light up.
- Settings → Android gains a **Full-screen alarm** row with live On/Heads-up
  state and a route to the system toggle. The permission is declared in the
  manifest; the alarm activity is unexported, excluded from recents and owns no
  schedule state.
- The alarm clock updates once a second while visible, and either action clears
  its notification. Pre-Android 8 alarms now carry their own alarm sound and
  vibration, since those versions ignore notification channels.

## 1.8.0 — 2026-11-04

### Per-site daily limits in the extension

- Every site on the block list can carry a daily allowance from 10 minutes to
  2 hours. The popup draws today's usage against it and a stepper changes it;
  unchecking a site keeps its allowance but frees it immediately.
- Spend the allowance and the site holds until local midnight. The worker adds
  a `declarativeNetRequest` redirect with `why=limit`; the blocked page says
  "That's the allowance", counts down to the reset, and offers no end-the-block
  escape. A manual block still owns the reason while it runs, then the spent
  allowance takes over.
- The badge is the nearest freedom: the manual block's countdown when one is
  running, otherwise the hours until the daily reset. Spent sites turn red in
  the popup with "Blocked for today · resets at midnight".
- The limit engine is a pure core module (`app/core/limits.js`) shared by the
  worker, popup and blocked page, so "spent" means one thing everywhere. New
  tests cover the exact allowance boundary and the midnight rollover.
- `npm run bump` now versions `extension/manifest.json` too, and `check`
  verifies it agrees with the app.

## 1.7.0 — 2026-11-04

### Home, rebuilt around four facts

- Home now answers four questions and nothing else: how many days are left,
  how much you have focused today, where the time went (Android), and what
  block comes next. Tasks moved to Schedule; streaks and history stayed in
  Stats.
- The exam countdown is the anchor: a serif days number, the exam name and
  month, warm inside 30 days, an honest prompt when the date has passed or is
  missing.
- Today's card pairs focused minutes with the daily goal, an animated meter,
  and one primary Start Study Mode button carrying the suggested length. A
  live session turns it into "Back to the room".
- Schedule card: the ongoing block wins, else the next occurrence with a
  relative "in 3h 12m", else a route to plan one.
- Screen-time card on Android reads foreground time only (last 24 hours, top
  three apps) and links to usage access when it is missing. Hidden on web.

### Study Mode, calmer

- Setup now has one decision at its centre: a big length dial that remembers
  the last length you used, with Timer/Stopwatch as a quiet segmented switch.
  Preset lengths and Pomodoro remain one tap away.
- The running room draws a circular progress ring around the clock (wall-clock
  truth, so a reload redraws it correctly); the stopwatch and breaks breathe
  instead of counting down.
- Attached tasks are checklist pills you can tick mid-session, with a proper
  struck-through done state.
- A clean finish gets a small confetti burst (reduced-motion-safe), a bigger
  amount, a "focused today" line, and a direct route to the week in Stats.
- The break room is calmer and greener, and every new animation sits under the
  global reduced-motion guard.

### Fixes

- `app/assets/js/sync.js` imported the merge core from the wrong path
  (`assets/core` instead of `core`), which would 404 the module. The check
  script now verifies that every relative import resolves to a real file.

## 1.6.0 — 2026-11-04

### Optional Google sign-in & cloud sync

- Settings → **Account**: sign in with Google on the web (popup, redirect
  fallback) and on Android (the native Google sheet). The account is optional —
  signed out, Lockin is exactly the local-first app it was, with zero Firebase
  code loaded.
- Synced slices mirror to your own Firestore tree (`users/{uid}/…`), one
  document per entity. Phone and browser stay in step without a server of ours.
- Local-first and offline-safe: the store is the truth, sync runs in the
  background, and a failed sync never blocks the app. The status line is
  honest — syncing, synced, offline, or an error worth reading.
- Merge rules: last-write-wins per task and schedule (client timestamp, tie →
  cloud), union-by-id for sessions and slips, tombstones for deletes. A delete
  on one device deletes on the other; a newer local edit survives an older
  tombstone.
- Sign out keeps every local byte. **Delete cloud data** wipes the Firestore
  copy, then signs out so nothing re-uploads.
- The Firebase SDK loads lazily from a pinned CDN only when the account is
  used; the service worker caches it after the first sign-in, so the shell
  keeps working offline.
- The account card has a little life: status emoji, a sync ring around the
  avatar, a check badge when a sync lands, and reduced-motion-friendly
  micro-animations throughout.

### Android

- `@capacitor-firebase/authentication` is wired into the shell;
  `android/app/google-services.json` stays gitignored and local. The Gradle
  graph builds with the plugin (`assembleDebug` verified).

### Docs

- `privacy.md` and `architecture.md` now describe shipped sync instead of a
  plan — the account-scoped Firestore tree, merge rules, cursors, tombstones,
  and the honest limits (device clocks, no realtime listeners).

## 1.5.0 — 2026-11-04

### Robustness

- Bottom sheets are now modal: Escape closes them, Tab cycles inside, focus
  enters on open and returns to the control that opened them.
- A service-worker update announces itself — "Update downloaded — restart
  Lockin to refresh" — instead of swapping the app on an unnoticed reload.
- A full storage quota now says so — "Storage is full — export a backup from
  Settings" — instead of failing silently in the console.

### Design

- **Study Mode starts in one tap.** A length chip now begins the session
  directly; the first seconds show an "Undo" pill that leaves nothing behind
  (the same 20-second free stop, one tap closer to the mis-tap). The armed
  hold stays where it belongs — the open-ended stopwatch.
- The Pomodoro pill says what it does (`Pomodoro · 25m ×3`) and the running
  screen shows when the session ends.
- **Schedule has one add affordance.** The "Nothing scheduled today" card no
  longer stacks a second "Add a block" button — it points at the `+` in the
  top corner, which is always there.
- **Home's goal bar reads at 0%.** The Focused tile's meter now has a visible
  track, and the Focused number is the largest figure on the strip.
- **Microtype floor.** Every content-bearing label below 11px was raised to
  11px (28 seats); decorative uppercase kickers keep their designed size.
- **Light theme hardened.** The bottom sheet's shadow now follows the theme
  (new `--shadow-up` token) instead of a hard-coded black; the rest of the
  audit found no token leaks.
- **Accessibility floor.** The running clock is a real `role="timer"`, phase
  changes announce politely, tab targets are pinned to a 44px minimum, and
  the active tab is announced with `aria-current="page"`.
- **Docs only promise what ships.** The Android "blocking tiers" table,
  the undeclared `SYSTEM_ALERT_WINDOW` permission, and the planned
  accessibility service are gone from the docs — the Android shell measures
  and rings; blocking is the extension's job.

### Android & tooling

- Release builds are signed: a gitignored `android/keystore.properties`
  feeds `signingConfigs.release`, and `assembleRelease` fails fast — naming
  the missing piece — until the keystore exists. Lockin distributes the APK
  directly; the keystore is what makes future updates install cleanly.
- `npm run bump -- <semver>` updates all four version homes at once, and CI
  fails if they ever disagree.
- The self-check suite runs in CI (`npm test`, 55 asserts) alongside
  `npm run check` and ESLint.
- `docs/android-qa.md` — a tap-by-tap device checklist, ready for a test
  round.

## 1.4.1 — 2026-11-04

### Opening film

- New seventh scene, **Let Lockin reach you**: the first run now asks for the
  permissions the schedule needs instead of leaving them buried in Settings.
- **Web** asks for notifications from a real tap and says plainly that they
  arrive only while a Lockin tab is open.
- **Android** shows notifications, exact alarms and usage access in one place.
  Each row has a live On/Blocked state, requests what it can, and opens the
  matching system screen when Android will not ask again.
- Statuses refresh when you come back from a system setting. Every ask is
  optional; **Start using Lockin** never depends on a grant.
- Replaying the film from Settings includes the permission scene, so a denied
  permission can be fixed without hunting.
- Service worker bumped to `lockin.v1.4.1`; Android `versionCode` 141.

## 1.4.0 — 2026-11-03

### Schedule

- **Plan is now Schedule.** The tab, route, manifest shortcut, Stats links and
  docs all use the new name; `#/plan` redirects to `#/schedule`.
- Recurring local-time blocks: name, start, end, days of the week, enabled
  switch. A block whose end is before its start crosses midnight.
- 24-hour SVG day ring with today's blocks, a live hand and a next/ongoing hero.
- Today's blocks, today/tomorrow tasks, repeating block rows with week strips,
  and an alarm summary that links to Settings.
- Per-block editor with a two-step delete, a live span preview and an overnight
  warning.
- **Alarms**: a full-screen in-app alarm, a generated chime, vibration and a
  system notification when a block starts. Reminder five minutes before,
  adjustable per block (0–30 minutes).
- Global alarm settings in **Settings → Schedule**: master switch, default
  reminder, sound and vibration.
- Alarm-launched sessions open `#/focus?min=<duration>` with the block's length
  as a visible preset. The user still starts the session.
- Notification clicks focus an open Lockin window or open `#/schedule`.
- Honest limit stated in-app: the web build rings only while Lockin is open.
  Android exact alarms are the next surface.

### Android shell

- Capacitor 8 shell around `app/` (appId `com.lockin.app`, SDK 36, minSdk 24).
- `LockinNative` bridge: exact alarms via `AlarmManager`, notification
  permission, usage access and per-app screen time.
- Two notification channels (alarms and reminders), a boot receiver that
  re-seeds the next window, and a notification tap that lands on Schedule.
- `app/assets/js/native.js`: seeds 14 days of events while Lockin is in the
  background and cancels them on return, so an open app never rings twice.
  Inert outside the shell; the service worker is not registered there.
- Settings → Android shows exact-alarm, notification and usage-access state,
  plus a 7-day screen-time panel. Nothing leaves the device.
- Brand launcher icon, adaptive foreground, round icon and splash set
  generated from the same stopwatch-padlock glyph
  (`tools/gen-android-icons.ps1`).
- Debug APK builds with `npm run android:build`; device testing is the next
  gate. No accessibility service and no blocking tier ship in this APK.

### Under the hood

- New pure core module `app/core/schedule.js`: parsing, spans, occurrences,
  next occurrence, reminder times and alarm events. Shared by the web app and
  the extension pack.
- New `app/assets/js/alarms.js` foreground engine (15-second tick, four-minute
  lookback, per-tab dedupe).
- New `app/assets/js/controls.js` shared settings row, toggle and stepper.
- Store v1.4 migration: `schedules`, `scheduleAlarms`, `alarmSound`,
  `alarmVibrate`, `remindDefault`.
- Service worker bumped to `lockin.v1.4.0`; precache covers the new modules.
- 9 new schedule asserts; self-check is now **51/51**.
- Extension repacked with the shared core (`dist/extension`, 184 KB).

## 1.3.0 — 2026-10-31

- Study Mode no longer asks for a subject. The clock starts with one button.
- **Earned exit**: ending after 15 minutes of real work is neutral. Adjustable
  5–60 minutes, or off.
- **Free stop**: ending inside the first 20 seconds discards the session with no
  slip.
- Strict Mode off now means no slips at all, in both timer and stopwatch modes.
- Honesty Log records neutral earned ends separately from slips.

## 1.2.0 — 2026-10-30

- Tasks-first **Plan** screen for today and tomorrow: add, tick and delete.
- Demo mode and seeded subjects removed.
- Stats rebuilt around all-time focus, goal days, task completion and a
  weekday-aligned 13-week heatmap.
- Opening film reduced to six scenes; no sample day is seeded.

## 1.1.0 — 2026-10-28

- Opening film with name, exam and daily target.
- Exam countdown on Home.
- Quieter Study Mode setup and running screens.
