# Home, Focus, extension limits, Android alarm & blocking

> Owner-approved autonomous execution (2026-11-04): no questions, one commit per
> task, push after each, tick boxes in the same commit. Node + Gradle verification
> only; the owner runs the device round afterwards.

**Order:** Home rebuild → Focus redesign → extension per-site daily limits →
Android full-screen alarm → Android app blocking.

## Global constraints

- No build step. Vanilla ES modules. Existing tokens only (`--acc`, `--good`,
  `--warn`, `--font-serif`, `--font-mono`).
- Every animation sits under the global `prefers-reduced-motion` guard.
- One accent, one job. Emoji and icons must carry meaning, not decoration.
- Honest limits stay visible. No claim a platform cannot keep.
- Version line: Home + Focus → **1.7.0**; extension limits → **1.8.0**;
  Android alarm → **1.9.0**; Android blocking → **1.10.0**.

---

### Task 1: Home rebuild (v1.7.0)

Home answers four questions and nothing else: **how many days are left, how much
did I focus today, where did the time go, and what is the next block.**

- [x] Exam countdown becomes the anchor: serif days number, exam name, month;
      ≤30 days turns warm, past date asks for the next one, no date asks for one.
- [x] Today card: focused minutes vs goal, animated meter, one primary Start
      Study Mode button (suggested length), live-session state.
- [x] Schedule card: ongoing block wins, else next occurrence with "in 3h 12m",
      else an honest empty state with a route to Schedule.
- [x] Screen-time card (Android only): today's top apps from usage access,
      permission prompt when denied, honest "foreground time" wording. Hidden
      on web.
- [x] Drop tasks, tiles, week rail and the old hero from Home — Schedule and
      Stats own them.
- [x] Motion: staggered cards, meter fill, countdown pop, live pulse, hover
      lift; all reduced-motion-safe.
- [x] Verify `check` + `lint` + `test`; commit; push. — verified in dark, light,
      empty and wide layouts with a seeded 390 px preview.

### Task 2: Focus redesign (v1.7.0)

- [x] Setup: one clear "how long" centre, mode switch, Pomodoro, task attach,
      projected end - same engine, calmer hierarchy.
- [x] Running room: circular progress ring around the clock (timer), breathing
      ring for the stopwatch, cleaner chrome, task chips as a checklist.
- [x] Done screen: one honest number, a lightweight confetti burst for a clean
      finish (reduced-motion-safe), clearer next actions.
- [x] Break screen: calmer green, breathing ring, no new rules.
- [x] Verify `check` + `lint` + `test`; commit; push.
- [x] `npm run bump -- 1.7.0` + changelog/docs; commit; push.

### Task 3: Extension per-site daily limits (v1.8.0)

- [ ] Data: each site gains `limitMin` (0 = no limit) and a per-day used
      counter with a day key; migration-safe.
- [ ] Background: attribute active-tab seconds, block a site once its daily
      allowance is spent (redirect with a clear reason), reset at midnight.
- [ ] Popup: per-site limit stepper, today's usage bar, "blocked for today"
      state; badge stays the countdown to the next block/reset.
- [ ] Blocked page: says why and when it returns.
- [ ] Verify `check` + `lint` + `test`; commit; push; bump 1.8.0 + docs.

### Task 4: Android full-screen alarm (v1.9.0)

- [ ] `USE_FULL_SCREEN_INTENT` permission; full-screen `PendingIntent` on the
      start notification when the OS allows it (API 34+ checked at runtime).
- [ ] `AlarmActivity`: show when locked, turn screen on, big clock + block name,
      Dismiss / Open Lockin; graceful fallback to a heads-up notification.
- [ ] Manifest + notification channel wiring; verify `assembleDebug` exit 0.
- [ ] Commit; push; bump 1.9.0 + docs.

### Task 5: Android app blocking (v1.10.0)

- [ ] `LockinAccessibilityService`: foreground package detection, no window
      content, no keystrokes; declared scope in the settings copy.
- [ ] Block overlay (accessibility overlay window) with the block name, the
      time left, and a single "Leave" action that sends the user home.
- [ ] Web Settings → Android: enable-service route, installed-app picker
      (launchable apps only), per-app toggles stored natively.
- [ ] Service respects enabled schedules/Study Mode windows; fails open when
      Lockin is open or the list is empty.
- [ ] Verify `assembleDebug` exit 0; commit; push; bump 1.10.0 + docs.

## Review focus

1. **Home with no profile, no schedule, no usage permission** — every card must
   have an honest empty state, never a broken number.
2. **A live session on Home** — the start button must become "back to the room";
   no second session can start.
3. **Focus reload mid-session** — the ring must redraw from wall-clock truth,
   not restart.
4. **Extension limit across midnight** — yesterday's seconds never count today.
5. **Android alarm denied full-screen intent** — still rings as a notification.
6. **Accessibility service off/denied** — the app works, Settings says what is
   missing, and nothing pretends to block.
