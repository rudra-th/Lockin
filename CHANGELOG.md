# Changelog

All notable changes to Lockin. The web app and extension share a version line;
the Android shell follows once it ships.

## Unreleased

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
