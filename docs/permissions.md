# Permissions

The source of truth for every permission Lockin asks for, on every surface. Store listings and the privacy policy are written from this file.

## Browser extension (Chrome, MV3)

| Permission | Why | What it does not do |
|---|---|---|
| `storage` | Keep the site list, block deadline and per-day usage counts in `chrome.storage.local`. | No sync, no account, no network. |
| `alarms` | Tick once a minute to commit the active-tab seconds and expire a block on time. | Does not wake the machine or run in the background beyond the alarm. |
| `tabs` | Read the active tab's URL to attribute time to a domain, and to close the blocked tab. | Does not read page content, forms, or history. |
| `declarativeNetRequest` | Redirect top-level navigations to a blocked domain — and YouTube Shorts, Instagram Reels, Facebook Reels or Snapchat Spotlight when the shorts toggle is on — to `blocked.html`. | Does not inspect or modify page bodies. |
| `host_permissions: <all_urls>` | The user chooses which domains to block; the rule set is built at runtime. | No content scripts are injected. |

The extension makes **no network requests**. Its only data is the `lockin.ext` key described in `extension/README.md`.

## Web app

| Capability | Why | Notes |
|---|---|---|
| `localStorage` | The whole store: tasks, recurring schedules, sessions, slips, settings. | One key, `lockin.store.v1`. Export/import is manual. |
| Service worker | Offline shell, cache, and the notification click target. | Same-origin only. |
| Screen Wake Lock | Keep the phone awake during a session. | Released when the session ends or the tab hides. |
| Notifications | Round notices, schedule alarms and the five-minute reminder. | Opt-in, requested from a real click. A web app can only ring while a Lockin page is alive; Android adds exact alarms. |
| Web Audio | The alarm chime. | Generated in the page; no audio file and no microphone. |

No account, no analytics, no third-party requests. Fonts are self-hosted.

## Android

What the shipped APK declares — nothing more:

| Capability | Why |
|---|---|
| `PACKAGE_USAGE_STATS` | Per-app screen time, pickups, unlocks. Granted in system settings. |
| `SCHEDULE_EXACT_ALARM` | Ring at the scheduled minute. |
| `POST_NOTIFICATIONS` | Reminder five minutes before a block. Runtime prompt. |
| `USE_FULL_SCREEN_INTENT` | A start alarm may take over the lock screen. Android 14+ can deny it; the alarm still arrives as a heads-up. |
| `RECEIVE_BOOT_COMPLETED` | Re-seed alarms after a reboot. |
| `VIBRATE`, `WAKE_LOCK` | Deliver the alarm on time. |
| `INTERNET` | Capacitor local server and future opt-in sync. |
| Accessibility service (off by default, user-enabled) | See which app comes to the front, so apps you chose can be covered, foreground minutes counted against daily limits, and strict mode enforced. `canRetrieveWindowContent=false`: package names only — no screen text, page content or keystrokes. |
| Device admin receiver (optional, inert) | Becomes active only after the user runs the one-time `dpm set-device-owner` command. Then strict mode can use Android lock task; without it Lockin falls back to screen pinning and says **Limited kiosk**. |

The accessibility service is optional. Without it Lockin still measures, rings
and logs; Settings says "Service off — nothing is blocked yet" instead of
pretending. It only covers apps you pick, only inside a schedule block or a
running/paused Study Mode session. Lockin, launchers, Settings and the default
dialer are never covered, even if an older saved list still contains them, so
the service can always be turned off and help can always be reached. It is a
focus aid, not a lock: Android lets you turn it off at any time.

Per-app limits count foreground time only while that service is on, and the
counters stay in device-local `SharedPreferences`. Strict kiosk is a separate
opt-in: device owner is the only mode that can truly hold the phone, and the UI
labels the pinning fallback honestly. A deadline releases lock task even if the
app dies. See [`android.md`](android.md).

## What we will never ask for

- Contacts, location, microphone, camera, SMS, call logs.
- Broad browsing history. The extension sees the active tab, not the history database.
- Screen content, accessibility node trees, keystrokes or app storage. The Android service reads package names only.
- An account to use the clock. Sync, when it arrives, is opt-in.
