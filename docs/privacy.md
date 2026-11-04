# Privacy

Lockin is a study tool, not an advertising product. This document describes
what the **shipped 1.6.0 build** does — local-first by default, with optional
Google sign-in for cloud sync. It is written to be read, not to hide behind.

## The short version

- 1.6.0 is local-first. Tasks, schedules, sessions, slips and settings live in
  one `localStorage` key on your device.
- Sync is opt-in. Signed out there is no account, no analytics and no
  third-party request.
- Signed in, the synced slices mirror to your own Firestore tree
  (`users/{uid}/…`), locked to your Google account by Firestore rules. The
  Firebase SDK loads from Google's CDN for this.
- The extension keeps its own state in `chrome.storage.local` and makes no
  network requests. Extension sync is not shipped.
- Export is a plain JSON file you control. Treat it like a diary.

## Web app

| Data | Where | Why |
|---|---|---|
| Tasks, schedules, sessions, slips, settings, profile name/exam | `localStorage` key `lockin.store.v1` | The app needs it to work offline and survive a reload |
| Google account (optional) | Firebase Authentication | Identifies the owner of the cloud mirror |
| Cloud mirror (optional) | Firestore `users/{uid}/…` | Keeps phone and browser in step |
| Sync bookkeeping | `localStorage` keys `lockin.sync.v1` (shadow + cursor) and `lockin.sync.on` (signed-in flag) | Knows what the cloud already has |
| Service worker cache | Browser Cache Storage | Offline shell |
| Notification permission | Browser permission store | Round notices, schedule alarms and reminders |
| Screen Wake Lock | Browser session only | Keep the screen awake during a session |

Signed out, no data leaves the browser: fonts are self-hosted and there is no
third-party script, pixel or CDN. Signed in, the Firebase SDK loads from
`www.gstatic.com` and the synced slices are written to your Firestore tree.

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
- **App blocking** (optional accessibility service) for the apps you choose
  during a focus window. The service config sets
  `canRetrieveWindowContent="false"`: it receives one event type and reads the
  foreground package name, never screen text, page content or keystrokes. The
  list of blocked apps and the window schedule live in device-local
  `SharedPreferences` (`lockin_blocking`) and are never synced.

The service is off until you enable it in system settings and flip the master
switch in Settings → Android. It is a focus aid, not a lock: Android lets you
turn it off, and Lockin says so plainly. Without it, the app still measures,
rings and logs.

Android data stays on the device unless you sign in and enable sync. The native
Google sheet hands a token to the Firebase SDK; the same Firestore tree
follows. The Android privacy declaration and Play Data Safety form will be
written from [`permissions.md`](permissions.md) before any store release.

## Sync (opt-in, shipped in 1.6.0)

- Sign in with Google: a popup on the web, the native Google sheet on Android.
  The account exists only for sync.
- The Firestore project belongs to the app owner; documents are keyed by
  `request.auth.uid`, and rules allow only that signed-in uid to read or write
  their own tree. There is no shared space code — the account is the join.
- Records are **plaintext** in Firestore by design. Nothing is encrypted
  client-side; the rules are the lock.
- Synced slices: profile, settings, schedules, tasks, sessions, slips. A live
  session snapshot, onboarding flags, activities and the old day-grid data
  never leave the device.
- No realtime listeners. Sync runs on boot, on tab focus, when the connection
  returns, and 1.5 s after a local change.
- Signing out stops the mirror and keeps every local byte. **Delete cloud
  data** wipes the Firestore tree, then signs out so nothing re-uploads.
- The extension does not sync yet; its storage stays separate.

If analytics ships, it will be documented here and in the store Data Safety
form before release. It will not be used to sell data. The in-app experience
will not show a data-collection banner; the disclosure lives in the store
listing and this document.

## Your controls

- **Export** a JSON backup from Settings → Your data.
- **Erase all data** is real: it clears the store and re-runs the opening film.
- **Sign out** in Settings → Account stops the cloud mirror; local data stays.
- **Delete cloud data** wipes the Firestore copy, then signs out.
- **Delete a schedule** in its editor (two-step).
- **Disable alarms** globally in Settings → Schedule, or per block.
- Uninstall the extension to remove `lockin.ext`. Uninstalling the Android app
  removes its local data.

## Honest limits

- The web app rings only while a Lockin page is alive. A closed tab cannot ring.
- The extension sees the active Chrome tab, not other browsers or apps.
- Android exact alarms can be denied by the OS; the app falls back and says so.
- No app can block another app on iOS. Lockin does not pretend otherwise.
- Sync has no realtime listeners, so another device's edit can take a moment to
  arrive. Merge timestamps are device clocks; a badly skewed clock can win or
  lose a conflict. Sessions and slips are append-only, so history never
  disappears.
