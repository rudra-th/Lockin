# Privacy

Lockin is a study tool, not an advertising product. This document describes
what the **shipped 1.4.0 build** does and what the planned sync will do. It is
written to be read, not to hide behind.

## The short version

- 1.4.0 is local-first. Tasks, schedules, sessions, slips and settings live in
  one `localStorage` key on your device.
- There is no account, no analytics and no third-party request in 1.4.0.
- The extension keeps its own state in `chrome.storage.local` and makes no
  network requests.
- Export is a plain JSON file you control. Treat it like a diary.

## Web app

| Data | Where | Why |
|---|---|---|
| Tasks, schedules, sessions, slips, settings, profile name/exam | `localStorage` key `lockin.store.v1` | The app needs it to work offline and survive a reload |
| Service worker cache | Browser Cache Storage | Offline shell |
| Notification permission | Browser permission store | Round notices, schedule alarms and reminders |
| Screen Wake Lock | Browser session only | Keep the screen awake during a session |

No data leaves the browser in 1.4.0. Fonts are self-hosted. There is no
third-party script, pixel or CDN.

## Extension

| Data | Where | Why |
|---|---|---|
| Site list, block deadline, per-day seconds | `chrome.storage.local` key `lockin.ext` | Blocking and the badge countdown |
| Active tab URL | Memory + the same key | Attribute time to a domain and redirect blocked navigations |

The extension reads the active tab, not the history database, page content or
form fields. It injects no content scripts. It makes no network requests.

The extension cannot read the PWA's `localStorage`, and the PWA cannot read the
extension's storage. Usage is separate until sync ships.

## Android

The Capacitor shell adds capabilities the web cannot have:

- **Usage access** (`PACKAGE_USAGE_STATS`) for per-app screen time. Granted in
  system settings; the app can open that screen but cannot grant it silently.
- **Exact alarms** (`SCHEDULE_EXACT_ALARM`) for block starts and reminders.
- **Notifications** (`POST_NOTIFICATIONS`) for alarms.

The 1.4.0 APK does **not** ship an accessibility service or a blocking tier.
Those remain a documented design for a later direct-APK build; if they ship,
the service is never part of the Play build and its visible scope is stated
before the user turns it on.

Android data stays on the device until sync ships. The Android privacy
declaration and Play Data Safety form will be written from
[`permissions.md`](permissions.md) before any store release.

## Planned sync (not in 1.4.0)

The next version is designed to offer opt-in Google sign-in:

- The Firestore project belongs to the app owner.
- Documents are keyed by `request.auth.uid`.
- A random 128-bit space code joins the web app, extension and Android shell.
- There is no cryptographic derivation in v1. Records are **plaintext** in
  Firestore; the app will say so before you turn sync on.
- Firestore rules deny `list` and only allow the signed-in owner to read or
  write their own documents.
- The extension uses Firestore REST, not the Firebase SDK.
- Sync is opt-in. The clock works without an account.

If analytics ships, it will be documented here and in the store Data Safety
form before release. It will not be used to sell data. The in-app experience
will not show a data-collection banner; the disclosure lives in the store
listing and this document.

## Your controls

- **Export** a JSON backup from Settings → Your data.
- **Erase all data** is real: it clears the store and re-runs the opening film.
- **Delete a schedule** in its editor (two-step).
- **Disable alarms** globally in Settings → Schedule, or per block.
- Uninstall the extension to remove `lockin.ext`. Uninstalling the Android app
  removes its local data.

## Honest limits

- The web app rings only while a Lockin page is alive. A closed tab cannot ring.
- The extension sees the active Chrome tab, not other browsers or apps.
- Android exact alarms can be denied by the OS; the app falls back and says so.
- No app can block another app on iOS. Lockin does not pretend otherwise.
