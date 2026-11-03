# Architecture

Lockin is one repository with three surfaces and one shared core. The web app
owns the study session; the extension is deliberately smaller; Android is a
shell around the same web UI, not a second UI.

```text
                 app/core/  (pure JS: time, honesty, schedule)
                    │
      ┌─────────────┼─────────────────┐
      │             │                 │
   app/          extension/         android/
   web PWA       Chrome MV3         Capacitor shell
   sessions      blocking +         exact alarms,
   tasks         active-tab time    usage access,
   schedule                        blocking tiers
   alarms
```

## Surfaces

| Surface | Owns | Does not own |
|---|---|---|
| **Web app** (`app/`) | Tasks, schedules, Study Mode sessions, earned exit, Stats, Honesty Log, foreground alarms | Device-wide blocking, closed-app alarms |
| **Extension** (`extension/`) | Site block list, active-Chrome-tab seconds, badge countdown | Sessions, tasks, streaks, the PWA's localStorage |
| **Android** (`android/`) | Exact alarms, notification permission, usage access, per-app screen time | A forked UI or a second data model; device-wide blocking is still a documented tier, not shipped |

The extension and the PWA cannot read each other's storage. Usage stays separate
until sync exists. This is stated in `extension/README.md` and in the UI.

## Shared core

`app/core/` is dependency-free ES modules with no DOM, storage or network:

- `time.js` — date keys, clock formatting, day math, slot helpers.
- `honesty.js` — accident window, earned exit, free stop, neutral ends.
- `schedule.js` — `HH:MM` parsing, spans, occurrences, next occurrence,
  reminder times, alarm events, day labels, input normalization.

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

## Sync (planned, not shipped in 1.4.0)

- Google sign-in identifies the user; Firestore documents are keyed by
  `request.auth.uid`.
- A random 128-bit space code joins surfaces. No crypto derivation in v1.
- Records are plaintext in Firestore by design; the privacy copy says so.
- Rules deny `list` and only allow a signed-in owner to read/write their own
  documents.
- The extension uses Firestore REST, not the SDK.

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
5. The web app stays dependency-free. Native capability goes through a bridge,
   never a forked screen.
