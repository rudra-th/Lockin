# Lockin — focus, strictly

**[lockin.surge.sh](https://lockin.surge.sh)**

A study-first focus PWA. Keep a short task list for today and tomorrow, then run wake-locked **Study Mode** sessions that take over the whole screen — and log, honestly, every time you walk away from them.

Vanilla JavaScript. No build step, no framework, no account, no analytics. Everything lives in your browser's localStorage.

## The premise

Regain, Forest, Opal and friends block apps or grow trees. Lockin is doing a different job: **it assumes you want to study, and makes everything else the harder choice.**

| | Lockin's deal |
|---|---|
| Plans | Today and tomorrow's tasks, written by you — no sample data, no default timetable |
| Enforces | Study Mode holds a full-bleed session screen, keeps the screen awake, and **logs a slip** if you leave mid-focus for more than 10 seconds — or quit before your earned-exit bar |
| Forgives | Away under 10s? Forgiven — 3 free accidents a day. End a session after 15 minutes of real work? Neutral — no slip, no broken streak |
| Remembers | Every slip, early quit and rescued accident goes into the Honesty Log. An earned end is recorded as neutral. The streak of *genuinely clean days* is earned, never bought |

One honest limit, stated plainly in-app: **a web app cannot block other apps on your phone** — nothing on the web can. Lockin's enforcement lives inside the session: a full-bleed screen, wake lock, a daily-target meter you can't hide from, and a log that doesn't lie.

## What's inside

- **Plan** — a task list for today and tomorrow, with add, tick and delete. Tasks are yours; nothing is preloaded. The 24-hour timetable is parked behind a visible “coming soon” card while it is rebuilt.
- **Study Mode** — set up on one quiet screen (daily target, Timer or Stopwatch, length with projected end, tasks); preset lengths (10–90 min) or ×3 Pomodoro with configurable focus/short/long breaks; a hold-the-ring intention screen (latches Screen Wake Lock + notification permission in one gesture); the running room keeps the app identity and a live **daily-target meter** (banked today + this session) on screen; attach today's tasks and tick them mid-session; quitting under the earned-exit bar requires a 2.4-second hold + explicit confirm, then it's logged. Once you've banked the bar (15 minutes by default), the control becomes a neutral one-tap **End session** that breaks nothing.
- **Session survives everything** — a running session is snapshotted to storage on every change; close the tab, crash, reload — reopen and the clock is still true (wall-clock math, not setInterval accumulation), and an away-episode that bracketed the reload is processed exactly once.
- **Stats** — today's goal ring and streak, all-time totals, a 7-day bar chart with the daily goal line, task completion, a weekday-aligned 13-week clean-day heatmap, recent sessions and the full Honesty Log. Honest empty states when there is nothing to measure yet.
- **Strict Mode is a switch, not a trap** — off means tracking only: no away slips and no quit slips, ever. **Earned exit** (15 minutes by default, 5–60 or off) makes ending after real work neutral in either mode. Daily goal, clean-day minimum, earned-exit bar and rescue rules: all visible, all adjustable in Settings.
- **First-run film** — six full-bleed scenes that ask your name, target exam (JEE, NEET, Boards, MHT-CET and more, or type your own), the rough month and year, and a daily study bar; then the honest rules. No demo session, no seeded plan. Rerunnable from Settings.
- **Exam countdown on Home** — “182 days left until NEET”, with the approximate month; it turns warm inside 30 days and asks for a new date once the exam passes.
- **Offline-first PWA** — installable, service-worker precache of the entire shell, works with airplane mode on.

## Run it

```bash
python serve.py        # → http://localhost:4173
```

Any static file server works; the service worker needs a secure context, and `localhost` counts. For the real test, open it on your phone (same LAN, via `python serve.py <port>` + your machine's IP) and **Install** from the browser menu.

## Self-check

`tests.html` runs the pure-logic asserts (task storage, session minutes, clean-day streaks, the 10-second accident window, the 20-second free stop, the earned-exit bar) against your actual browser — also linked from Settings → About.

## Structure

```
index.html              app shell + tab bar
manifest.webmanifest    PWA identity
sw.js                   offline-first service worker
favicon.svg             brand glyph source
assets/
  css/app.css           whole design system (tokens → components)
  js/
    store.js            versioned localStorage store + session math
    exams.js            exam catalogue + rough-date math
    util.js             time/date helpers + decideAway (enforcement math)
    router.js           hash router
    ui.js               shared sheet, hint and daily-goal meter widgets
    install.js          beforeinstallprompt plumbing
    tasks.js            shared task row / add-form / list controls
    app.js              bootstrap: theme, routes, live-session resume
    icons.js            inline SVG set
    views/              home · plan · focus · stats · settings · walkthrough
tools/gen-icons.ps1     regenerates the PNG icon set (GDI+, no deps)
serve.py                tiny dev server (no-store headers, SW scope)
```

## Data

One localStorage key: `lockin.store.v1`. Export/import a JSON backup from Settings; "Erase all data" is real and re-runs the opening film. Sessions store minutes, tasks and honesty events — no subject list to maintain.

## Status

v1.3.0 — Study Mode no longer asks for a subject; the clock starts with one button. Earned exit makes stopping neutral after 15 minutes (adjustable, or off) and inside the first 20 seconds, while early quits still land in the Honesty Log. v1.2.0 brought tasks, removed demo mode and the seeded subjects, and rebuilt Stats around all-time focus, goal days, task completion and an aligned heatmap. The opening film is six scenes and no longer seeds a sample day. Live at **[lockin.surge.sh](https://lockin.surge.sh)**.
