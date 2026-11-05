# Control center, app limits, strict kiosk and short-video blocking

**Status:** shipped in 1.11.0 · **Version:** 1.11.0

The roadmap shipped in 1.10.0. This phase gives the phone side one home:
a **Control** tab that owns blocking, per-app limits, short-video presets and a
real strict study mode. Screen time and every stat moved to Settings, which is
now grouped into Study, Device, Progress and You.

## Design rules

- **One home for device control.** Settings keeps permissions and screen time;
  Control owns what those permissions do. No duplicated pickers or state.
- **Fail open, never lock out.** Launchers, Settings and the dialer stay
  reachable in every mode. Strict mode is the one exception the user opts into,
  and even it keeps a deadline and the system safety hatch.
- **Never lie about enforcement.** Android cannot stop a user from disabling an
  accessibility service or unpinning an app unless Lockin is the device owner.
  The UI says which mode is active and what it can actually do.
- **Device-local.** App lists, limits, usage and strict config stay in
  `SharedPreferences`; they are not synced.

## Task 1: Control tab, Settings screen time (v1.11.0)

- [x] New main tab **Control** between Focus and Settings; the bar ends at five
      tabs once Stats folds into Settings → Progress (Task 7).
- [x] Control owns app blocking, distraction presets, per-app limits and the
      strict kiosk; Settings keeps a one-card pointer.
- [x] The app picker stays collapsed to removable chips with **Browse all
      apps** opening the searchable list, so limits and strict mode sit above
      the fold.
- [x] Screen time card moved from Control into Settings: total foreground time,
      top apps with bars, 7-day rail, refresh, usage-access CTA.
- [x] Removed the compact Stats screen-time card and the Home "where the time
      went" card, so screen time has one home.
- [x] Web fallback: explains app control lives in the Android app and points
      to the extension for sites.
- [x] Native `queryUsageToday()` and `queryUsageDaily(7)` with local-midnight
      boundaries.

## Task 2: Per-app daily limits

- [x] `BlockingStore` gains `limits` (package → minutes) and `usage`
      (`dayKey → package → ms`), pruned to two days.
- [x] Service tracks foreground time (flush on app switch, screen off, the
      15 s watch, service destroy) and blocks an app once its allowance is
      spent; resets at midnight automatically.
- [x] Overlay reason `limit`: "Daily limit reached", reset time, progress,
      one action home.
- [x] Control UI: limited-app list with usage bar and a stepper
      (Off/15/30/45/60/90/120/180), add-app search, remove.
- [x] Limits count only while the service is on; the card says so.

## Task 3: Strict study mode (kiosk)

- [x] `LockinDeviceAdminReceiver` + `device_admin.xml`; docs for one-time
      `dpm set-device-owner`.
- [x] Native `startStrictMode`/`stopStrictMode`/`strictStatus`: device-owner
      lock task with the allowed packages, `LOCK_TASK_FEATURE_NONE`; screen
      pinning best effort otherwise.
- [x] Strict config in `BlockingStore`: active flag, allowed packages,
      fail-open deadline.
- [x] Service: during a strict session, cover every non-allowed app with a
      "Strict study mode" overlay and one action: **Back to Lockin**.
- [x] Session integration: start on begin/resume, stop on finish/abort/discard
      and on boot with no live session; a stale strict flag is cleared.
- [x] Session room dock: allowed apps, launched from Lockin; a "Limited
      kiosk" pill when device owner is missing.
- [x] Control card: toggle, allowed-app picker, live kiosk state, setup
      instructions with a copy button.

## Task 4: Reels & Shorts

- [x] Extension: `shorts` toggle (default on), dynamic DNR rules for YouTube
      Shorts, Instagram Reels, Facebook Reels and Snapchat Spotlight,
      redirect with `why=shorts`; blocked page explains and offers a route
      back; popup toggle.
- [x] Android: a one-tap preset that adds installed distraction apps
      (YouTube, Instagram, Facebook, Snapchat, TikTok, X, Reddit, Discord,
      Telegram, WhatsApp, Netflix, Prime Video, Twitch) to the blocked list,
      with honest copy: Android cannot see a path inside an app without
      reading screen content, so the whole app is blocked during focus.
- [x] Tests for the shorts matcher (pure helper).

## Task 5: Onboarding, account and Google sign-in

- [x] Name scene gains **Already have an account?** with a Google sign-in
      panel; a signed-in account fills the name.
- [x] New account scene offers create-account / sign-in before the rules, with
      **Not now — keep it on this device**.
- [x] Permissions scene asks for notifications, exact alarms, full-screen
      alarms, accessibility and usage access, with live status and actions.
- [x] Native sign-in retries the legacy Google sheet when Credential Manager
      fails; ID token validated; cancellations stay silent.
- [x] Web sign-in sets the cloud flag before the redirect fallback and finishes
      through `getRedirectResult`.
- [x] Pure `core/auth-errors.js` maps every failure to one actionable sentence.
- [x] Debug APKs sign with the release keystore when `keystore.properties` is
      complete, so Google sees the registered certificate.

## Task 6: Verify and ship

- [x] `check`, `lint`, `test`, `assembleDebug`/`assembleRelease`; visual pass
      at 390 px for Control, Settings and the opening film.
- [x] Docs: `android.md`, `permissions.md`, `privacy.md`, `architecture.md`,
      `README.md`, extension README; CHANGELOG 1.11.0.
- [x] Commit each task, tick boxes in the same commit, bump 1.11.0.

## Task 7: Settings categories and Progress

- [x] Stats folded into Settings as **Progress**: today's ring, all-time tiles,
      7-day bars, tasks, 13-week heatmap, recent sessions, Honesty Log; honest
      empty states kept.
- [x] Five-tab bar (Stats button removed); old `#/stats` links redirect to
      `#/settings?section=progress`; the done screen's "See the week" follows.
- [x] Settings grouped into **Study**, **Device**, **Progress** and **You**, with
      icons, one-line descriptions, a 2×2 chip grid on phones and deep links for
      every section.
- [x] Device keeps screen wake/notifications, screen time and Android
      permissions; the web build gets an honest Android fallback card.
- [x] About credits **Made by Rudra** with a GitHub mark linking to
      `github.com/rudra-th`.
- [x] README, CHANGELOG, release notes, architecture and QA docs updated; screens
      regenerated; axe 0 violations on all four sections in both themes; 36/36
      interaction checks.
