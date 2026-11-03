# Permissions

The source of truth for every permission Lockin asks for, on every surface. Store listings and the privacy policy are written from this file.

## Browser extension (Chrome, MV3)

| Permission | Why | What it does not do |
|---|---|---|
| `storage` | Keep the site list, block deadline and per-day usage counts in `chrome.storage.local`. | No sync, no account, no network. |
| `alarms` | Tick once a minute to commit the active-tab seconds and expire a block on time. | Does not wake the machine or run in the background beyond the alarm. |
| `tabs` | Read the active tab's URL to attribute time to a domain, and to close the blocked tab. | Does not read page content, forms, or history. |
| `declarativeNetRequest` | Redirect top-level navigations to a blocked domain to `blocked.html`. | Does not inspect or modify page bodies. |
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

## Android (planned)

| Capability | Why | Tier |
|---|---|---|
| `PACKAGE_USAGE_STATS` | Per-app screen time, pickups, unlocks. | Both builds; user grants it in system settings. |
| `SCHEDULE_EXACT_ALARM` | Fire a block alarm at the scheduled minute. | Both builds. |
| `POST_NOTIFICATIONS` | Reminder five minutes before a block. | Both builds, runtime prompt. |
| Accessibility service | Detect and cover blocked apps. | **Direct APK only.** Never in the Play build. |
| `SYSTEM_ALERT_WINDOW` | Draw the block overlay. | Direct APK only. |

## What we will never ask for

- Contacts, location, microphone, camera, SMS, call logs.
- Broad browsing history. The extension sees the active tab, not the history database.
- An account to use the clock. Sync, when it arrives, is opt-in.
