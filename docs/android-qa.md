# Lockin — Android on-device QA

Owner-run pass. Every line is a literal tap-by-tap assertion — check the box
only when you saw it with your own eyes on the device. Nothing here can be
verified in a browser or an emulator with confidence.

**Build under test:** `assembleDebug` or a release APK from
`docs/android-release.md` · **Version:** ______ · **Device:** ______ ·
**Date:** ______

Progress: **0 / 34 checked**

---

## 1. Install & first run

- [ ] `adb install app-debug.apk` (or sideload the release APK) succeeds; no
      Play Protect warning blocks install.
- [ ] Cold start opens the walkthrough film directly — no white flash, no
      permission ask before its scene.
- [ ] Rotating the device during the film doesn't restart the film or lose
      your place.
- [ ] Killing the app mid-film and reopening resumes at the film (or skips
      cleanly to Home once onboarded).

## 2. Walkthrough permission rows

The three rows live on the walkthrough's permissions scene. Expected states
come from `paintPerm`: **on** (green check), **Allow/Open** button, or
**Blocked + Settings**.

- [ ] Notifications row: tapping **Allow** raises the Android notification
      permission dialog; granting flips the row to **on** without leaving the
      app.
- [ ] Notifications row: denying the dialog flips the row to **Blocked** with
      a **Settings** action that opens the app's system notification page.
- [ ] Alarms & reminders row: tapping **Open** lands on the system
      "Alarms & reminders" page listing Lockin; granting returns to the app
      with the row flipped to **on**.
- [ ] Usage access row: tapping **Open** lands on the system "Usage access"
      page; granting returns with the row flipped to **on**.
- [ ] Skipping all three rows (Back / close) never blocks onboarding — the
      film finishes and Home renders.

## 3. Schedules & exact alarms

Create a block 3 minutes in the future with the alarm toggle on before each
of these.

- [ ] With the app open, the five-minute warning and the start alarm arrive
      as notifications at the right minutes.
- [ ] **Alarm fires with the app swiped away** (recent-apps swipe): swipe
      Lockin out, lock the screen, wait — the notification still arrives at
      the exact minute.
- [ ] Alarm fires after a device reboot (reboot ≥1 min before the block).
- [ ] Tapping the alarm notification opens Lockin on the **Schedule** tab.
- [ ] The alarm is audible/vibrating with the phone locked and silent media
      volume (alarm channel, not media).
- [ ] A block with the alarm toggle off produces no notification.

## 4. Screen-time panel (usage access)

Compare against a device with a normal 7-day mix (browsing, video, a game —
not just Lockin).

- [ ] The Settings screen-time panel renders non-zero daily totals for days
      with real usage.
- [ ] The panel's total for today is within a few minutes of Android's own
      Digital Wellbeing number for today.
- [ ] A day with zero phone use shows 0 — not blank, not yesterday's number.
- [ ] The 7-day rail matches Digital Wellbeing's per-day ordering (which days
      were heavy vs light).
- [ ] With usage access **revoked**, the panel shows its honest empty state
      (no zeros pretending to be data, no crash).

## 5. Revoked-permission retry

- [ ] Revoke Notifications in system settings, reopen Lockin: the
      walkthrough row (or Settings) shows **Blocked + Settings**, and tapping
      Settings opens the right system page.
- [ ] Re-grant from that system page, return to Lockin: the row flips to
      **on** without an app restart.
- [ ] Revoke exact alarms the same way; the row returns to **Open** and a
      new alarm-bearing block warns honestly (no silent promise).

## 6. Session engine on hardware

- [ ] Start a 10m session, lock the screen for 2 minutes, unlock: the clock
      shows the correct remaining time (no drift — it's timestamp-based).
- [ ] Start a session, swipe the app away, return within the grace window:
      the session is still running and the return is a rescue, not a slip.
- [ ] Leave the app past the grace window with Strict on: returning shows
      the slip honestly in the log.
- [ ] Screen stays awake during a running session (wake lock) with the
      "keep screen awake" setting on, and doesn't with it off.
- [ ] Kill the app entirely mid-session, reopen: the session resumes from
      its snapshot (started time preserved, not restarted).

## 7. Shell & offline

- [ ] Airplane mode: app opens, all views render, starting a session works
      (everything is local).
- [ ] Airplane mode: a session started offline logs its minutes correctly
      once connectivity returns.
- [ ] The system Back gesture/button closes sheets first, then exits — it
      never dumps the user out of a running session without the quit flow.
- [ ] Dark and light theme both render correctly across Home, Schedule,
      Focus, Stats and Settings (the light audit was code-only; this is the
      visual confirmation).

---

## After the pass

- [ ] `docs/android-release.md` was followed once end-to-end and a signed
      release APK exists in `dist/`.
- [ ] Anything that failed is filed as a fix task — not silently unchecked.
