# Architecture

Lockin is one repository with three surfaces and one shared core. The web app
owns the study session; the extension is deliberately smaller; Android is a
shell around the same web UI, not a second UI.

```text
                 app/core/  (pure JS: time, honesty, schedule, limits, sync)
                    │
      ┌─────────────┼─────────────────┐
      │             │                 │
   app/          extension/         android/
   web PWA       Chrome MV3         Capacitor shell
   sessions      blocking +         exact alarms,
   tasks         active-tab time    usage access,
   schedule      shorts rules       screen time, limits,
   alarms                           strict kiosk,
                                    Google sign-in (sync)
```

## Surfaces

| Surface | Owns | Does not own |
|---|---|---|
| **Web app** (`app/`) | Tasks, schedules, Study Mode sessions, earned exit, Stats, Honesty Log, foreground alarms, the **Control** tab's web explanation, Settings | Device-wide blocking, closed-app alarms |
| **Extension** (`extension/`) | Site block list, per-site daily allowances, short-video URL rules, active-Chrome-tab seconds, badge countdown | Sessions, tasks, streaks, the PWA's localStorage |
| **Android** (`android/`) | Exact alarms, full-screen lock-screen alarms, notification permission, usage access, per-app screen time in Settings, app blocking and per-app limits in Control, the optional strict kiosk, optional Google sign-in for cloud sync | A forked UI or a second data model. Blocking, limits, usage and strict config are device-local `SharedPreferences`, not part of the synced store |

The extension and the PWA cannot read each other's storage. Usage stays separate
until sync exists. This is stated in `extension/README.md` and in the UI.

## Shared core

`app/core/` is dependency-free ES modules with no DOM, storage or network:

- `time.js` — date keys, clock formatting, day math, slot helpers.
- `honesty.js` — accident window, earned exit, free stop, neutral ends.
- `schedule.js` — `HH:MM` parsing, spans, occurrences, next occurrence,
  reminder times, alarm events, day labels, input normalization.
- `limits.js` — daily-allowance math: minutes used, remaining, the reset key.
- `shorts.js` — the pure short-video matcher: YouTube Shorts, Instagram Reels,
  Facebook Reels and Snapchat Spotlight paths plus the runtime filter list.
- `sync.js` — stable diffing, last-write-wins and append merges, tombstones,
  pull cursors. No DOM, storage or network; the engine drives it.
- `auth-errors.js` — one calm sentence for every Google sign-in failure code,
  including native `DEVELOPER_ERROR` and cancellations that should stay silent.

`app/assets/js/util.js` re-exports the core so views import one module. The
extension pack copies `app/core/` into `dist/extension/`; Chrome cannot resolve
imports outside an extension folder. Android gets the same files through
Capacitor's `webDir: "app"`.

## Schedule model

```js
{
  id: 'sch_…',
  name: 'Morning deep work',
  start: '06:30',        // local time, 24-hour
  end: '08:00',          // end < start crosses midnight
  days: [1, 2, 3, 4, 5], // 0 = Sunday
  enabled: true,
  alarm: true,
  remind: 5,             // minutes before; 0 = off
  createdAt: 1790000000000
}
```

`occurrenceOn(schedule, date)` builds concrete local `Date` objects. A block is
one occurrence per selected day, even when it crosses midnight. `eventsBetween`
emits `remind` and `start` events for a window; the web engine and the future
Android bridge both read it.

### Foreground alarms (web)

`app/assets/js/alarms.js` ticks every 15 seconds with a four-minute lookback. It
dedupes fired events in `sessionStorage`, plays a generated Web Audio chime,
vibrates after the first user gesture, sends a system notification when
permission is granted, and shows a full-screen alarm or a reminder toast.

Honest limit: a web page cannot ring while it is closed. The UI says so. Android
adds `AlarmManager` exact alarms for that case.

### Native alarms (Android)

The Capacitor shell exposes a small `LockinNative` plugin. `app/assets/js/native.js`
computes the next fourteen days of events from `eventsBetween`, sends them to
the plugin, and the plugin schedules exact alarms. A boot receiver re-seeds them
after a reboot. If exact-alarm permission is denied, the plugin falls back to an
inexact alarm and reports that to the UI.

The handoff is deliberate: while the app is in the foreground the web engine
owns the ring; when it goes to the background the bridge seeds the native
window; on return the window is cancelled. That avoids a double ring and keeps
the web build's honest limit intact.

## Data

One web key: `lockin.store.v1`. Store migrations are additive and run on load.
Export/import is manual JSON from Settings. The extension uses one key,
`lockin.ext`, in `chrome.storage.local`.

Sync adds two device-local keys outside the store — `lockin.sync.v1` (shadow
snapshot + pull cursor) and `lockin.sync.on` (the user asked for the cloud) —
so the store never contains sync-of-sync bookkeeping.

Android keeps its device-control state in native `SharedPreferences`
(`lockin_blocking`): the block switch and package list, push windows, per-app
daily allowances, two days of foreground-time buckets, and the strict flags.
That is deliberately outside the synced store and the device's own data is
never uploaded.

## Sync (opt-in, shipped in 1.6.0)

The store stays the source of truth. Sync mirrors six slices to Firestore and
merges by rules that never lose history:

| Path | Merge rule |
|---|---|
| `users/{uid}/profile/main`, `settings/main` | Last-write-wins on `updatedAt`; identical content never churns |
| `users/{uid}/schedules/{id}`, `tasks/{id}` | LWW per doc; a delete writes a `{deleted:true}` tombstone and removes the local copy; a newer local edit survives an older tombstone |
| `users/{uid}/sessions/{id}`, `slips/{id}` | Append-only union by id — history is immutable |

`updatedAt` is client epoch milliseconds; a tie goes to the cloud copy. The
engine (`app/assets/js/sync.js`) pulls first — full when the cursor is 0, then
`where('updatedAt', '>', cursor)` paged at 500 — merges under a re-entrancy
guard, then diffs the store against its shadow and pushes stamped docs in
chunked `writeBatch` commits. Pulled docs are absorbed into the shadow so they
are never pushed back; the cursor advances from pulled docs only, never from
push stamps.

Triggers: boot, tab focus, `online`, a 1.5 s debounced `lockin:changed`, and
the manual **Sync now**. No realtime listeners — this is a mirror, not a live
document. Auth lives in `app/assets/js/account.js`: `signInWithPopup` on the
web (redirect fallback), the `@capacitor-firebase/authentication` native sheet
on Android feeding `signInWithCredential`, and a lazy Firebase SDK loaded from
the pinned CDN in `app/assets/js/firebase.js`. Signed out, no Firebase code
loads at all. Failures are translated by `core/auth-errors.js`; cancellations
stay silent, and native sign-in retries the legacy Google flow once when
Credential Manager cannot complete. Sync failure is always quiet and never
blocks the app.

## Build and check

- Web: no build step. `python serve.py` serves `app/`.
- Extension: `node tools/pack-extension.mjs` stages `dist/extension`.
- Android: `npm run android:sync`, then Gradle.
- `npm run check`: JS parse, JSON, CSS braces, SW precache, version agreement,
  stale Plan references and extension manifest.
- `app/tests.html`: pure-logic asserts in a real browser.

## Design rules

1. One accent, one job: lime means a primary action or live data.
2. Serif for moments, mono for every figure, sans for the working text.
3. Flat surfaces and honest borders; no decorative gradients that carry no
   information.
4. No claim the platform cannot keep. The limits are part of the product.
5. The web app has no build step or framework; the only third-party code is
   the Firebase SDK, lazy-loaded from a pinned CDN when the user signs in.
   Native capability goes through a bridge, never a forked screen.
