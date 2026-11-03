# Android — not scaffolded yet

The Android surface is the third build in the v2 plan, after the web app and the extension. It will be a Capacitor shell around `app/`, not a second UI.

## What it adds

- **Usage access** — real per-app screen time, pickups and unlocks via `UsageStatsManager`.
- **Device-wide blocking** — an Accessibility service (direct APK) or a softer overlay tier (Play build), chosen at build time.
- **Exact alarms** — `AlarmManager.setExactAndAllowWhileIdle` with `SCHEDULE_EXACT_ALARM`, plus a full-screen intent where the OS allows it.
- **Notifications** — a reminder five minutes before a scheduled block, changeable per schedule.

## Rules

- `webDir` is `app/`; the service worker is disabled inside the shell.
- The shell never forks the UI. If a screen needs a native capability, it goes through the platform interface, not a copy of the view.
- Blocking tiers are honest: the Play build says what it can do; the direct APK says what it does.
- No accessibility-based blocking in the Play build. It is a policy risk and a privacy cost the store build should not carry.

The Capacitor project lands when the web app's Schedule model is in place — the alarms and blocks need something real to schedule.
