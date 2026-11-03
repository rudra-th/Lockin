# Lockin — focus, strictly

A study-first focus PWA. Paint your day on a 24-hour grid, then run wake-locked **Study Mode** sessions that take over the whole screen — and log, honestly, every time you walk away from them.

Vanilla JavaScript. No build step, no framework, no account, no analytics. Everything lives in your browser's localStorage.

## The premise

Regain, Forest, Opal and friends block apps or grow trees. Lockin is doing a different job: **it assumes you want to study, and makes everything else the harder choice.**

| | Lockin's deal |
|---|---|
| Plans | Paint the full 24 hours (sleep, school, meals, subjects) on tap-tap-paint grid |
| Enforces | Study Mode holds a full-bleed session screen, keeps the screen awake, and **logs a slip** if you leave mid-focus for more than 10 seconds |
| Forgives | Away under 10s? Forgiven — 3 free accidents a day. No punishment for mistakes |
| Remembers | Every slip, quit, and rescued accident goes into the Honesty Log. The streak of *genuinely clean days* is earned, never bought |

One honest limit, stated plainly in-app: **a web app cannot block other apps on your phone** — nothing on the web can. Lockin's enforcement lives inside the session: a full-bleed screen, wake lock, a daily-target meter you can't hide from, and a log that doesn't lie.

## What's inside

- **Plan** — 48 half-hour slots, tap-tap painting per subject, block editor (stretch/shrink/rename/delete), copy day → tomorrow / next week, per-day tasks with staged subtasks.
- **Study Mode** — set up on one quiet screen (daily target, Timer or Stopwatch, length with projected end, subject, tasks); preset lengths (10–90 min) or ×3 Pomodoro with configurable focus/short/long breaks; a hold-the-ring intention screen (latches Screen Wake Lock + notification permission in one gesture); the running room keeps the app identity and a live **daily-target meter** (banked today + this session) on screen; attach today's tasks and tick them mid-session; quit requires a 2.4-second hold + explicit confirm, then it's logged.
- **Session survives everything** — a running session is snapshotted to storage every change; close the tab, crash, reload — reopen and the clock is still true (wall-clock math, not setInterval accumulation), and an away-episode that bracketed the reload is processed exactly once.
- **Stats** — daily goal ring, 7-day bars, subject split, 13-week clean-day heatmap (lime = clean, orange = focused but broken), full session log and Honesty Log.
- **Strict Mode is a switch, not a trap** — off means tracking only. Daily goal, clean-day minimum, rescue rules: all visible, all adjustable in Settings.
- **First-run film** — seven full-bleed scenes that ask your name, target exam (JEE, NEET, Boards, MHT-CET and more, or type your own), the rough month and year, and a daily study bar; then the honest rules, a believable sample day, and a safe 2-minute demo session that never logs slips and never touches your stats. Rerunnable from Settings.
- **Exam countdown on Home** — “182 days left until NEET”, with the approximate month; it turns warm inside 30 days and asks for a new date once the exam passes.
- **Exam-aware seeds** — the sample plan, subjects and tasks follow the exam you picked, and can be edited like any other.
- **Offline-first PWA** — installable, service-worker precache of the entire shell, works with airplane mode on.

## Run it

```bash
python serve.py        # → http://localhost:4173
```

Any static file server works; the service worker needs a secure context, and `localhost` counts. For the real test, open it on your phone (same LAN, via `python serve.py <port>` + your machine's IP) and **Install** from the browser menu.

## Self-check

`tests.html` runs the pure-logic asserts (slot math, paint/merge/erode, clean-day streaks, the 10-second accident window) against your actual browser — also linked from Settings → About.

## Structure

```
index.html              app shell + tab bar
manifest.webmanifest    PWA identity
sw.js                   offline-first service worker
favicon.svg             brand glyph source
assets/
  css/app.css           whole design system (tokens → components)
  js/
    store.js            versioned localStorage store + pure grid math
    exams.js            exam catalogue, seeded subjects, rough-date math
    util.js             time/slot/date helpers + decideAway (enforcement math)
    router.js           hash router
    ui.js               shared sheet, hint and daily-goal meter widgets
    install.js          beforeinstallprompt plumbing
    app.js              bootstrap: theme, routes, live-session resume
    icons.js            inline SVG set
    views/              home · plan · focus · stats · settings · walkthrough
tools/gen-icons.ps1     regenerates the PNG icon set (GDI+, no deps)
serve.py                tiny dev server (no-store headers, SW scope)
```

## Data

One localStorage key: `lockin.store.v1`. Export/import a JSON backup from Settings; "Erase all data" is real and re-runs the opening film.

## Status

v1.1.0 — the opening film, the exam clock and a quieter Study Mode. The first run now asks who you are, what you're aiming at, roughly when, and what a good day looks like; Home keeps the countdown. Study Mode setup became type and hairlines instead of cards. New type system: Fraunces for moments, Hanken Grotesk for the interface, IBM Plex Mono for figures. Desktop + Android Chrome/Edge get the full experience (wake lock, install); iOS gets the PWA-shell session.
