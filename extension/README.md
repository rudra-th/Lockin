# Lockin — Block & Track

The browser half of Lockin. It does two jobs and refuses the third:

- **Blocks** the sites on your list for a chosen stretch (25 min, 45 min, 1 h).
- **Tracks** the time the active Chrome tab spends on each site, per day.
- **Does not** run the study clock. Timers, tasks, streaks and the Honesty Log live in the app.

## Build and load

```bash
node tools/pack-extension.mjs
```

Then open `chrome://extensions`, turn on **Developer mode**, choose **Load unpacked**, and pick `dist/extension`.

Load `dist/extension`, not `extension/`. The source imports the shared core from `app/core/`, and Chrome only resolves imports inside the packed folder — the pack script copies it in. It also copies the three UI fonts, so the popup and the blocked page use the same type as the app.

## What it stores

One `chrome.storage.local` key: `lockin.ext`.

```js
{
  sites: ['youtube.com', …],
  off: { 'x.com': true },          // unchecked, still on the list
  blockUntil: 1730000000000,       // 0 = no block
  usage: { '2026-11-03': { 'youtube.com': 3120 } },
  active: { domain, since }        // the tab being counted right now
}
```

Nothing leaves the browser. The extension has no account and no network calls.

## Honest limits

- It counts the **active tab in Chrome only** — not other browsers, not apps on your phone, not a second Chrome profile.
- Usage is sampled on tab and window changes plus a one-minute alarm, so a count can be off by up to a minute.
- Blocking is `declarativeNetRequest` on whole domains, top-level navigations. Subdomains are covered by the domain rule; embedded players inside an allowed page are not.
- The block deadline is local time. Changing the system clock can end a block early.

The Android app is the surface that can see apps and hold a device-wide block. This extension is deliberately smaller than that.
