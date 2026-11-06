# Lockin — Block & Track

The browser half of Lockin. It does five jobs and refuses the sixth:

- **Blocks** the sites on your list for a chosen stretch (25 min, 45 min, 1 h).
- **Limits** any site to a daily allowance — 10 minutes to 2 hours. Spend it and the site holds until midnight.
- **Cuts short videos** — YouTube Shorts, Instagram Reels, Facebook Reels and Snapchat Spotlight — on a toggle that is on by default.
- **Tracks** the time the active Chrome tab spends on each site, per day.
- **Links to your phone** — paste the pairing code from Lockin's Settings → Account and the popup shows today's phone screen time, focus minutes and most-used apps.
- **Does not** run the study clock. Timers, tasks, daily targets and streaks live in the app.

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
  limits: { 'youtube.com': 30 },   // daily allowance in minutes; absent = none
  shorts: true,                    // short-video URL blocking; default on
  blockUntil: 1730000000000,       // 0 = no block
  usage: { '2026-11-03': { 'youtube.com': 3120 } },
  active: { domain, since }        // the tab being counted right now
}
```

A second key, `lockin.cloud`, holds the optional phone link: the pairing code and the last summary fetched. It contains no account credentials.

Nothing is uploaded. The extension has no account and makes one kind of network request: a read-only `GET` for the public summary document that matches your pairing code. No personal data, browsing history or site list is sent. The code can be rotated at any time in the app.

## Daily limits

The stepper next to each site sets an allowance in minutes (`0` is off, then
10–120). The popup draws today's usage against it, and the site turns red once
the allowance is spent.

- **Spent is computed, never stored.** The worker compares today's usage bucket
  with the limit on every tab change and every minute. At local midnight the
  day key rolls over and every limit is fresh again — no reset job to miss.
- **A spent allowance blocks like a manual block.** `syncRules` emits a
  `declarativeNetRequest` redirect with `why=limit`; the blocked page says
  "Daily limit", counts down to midnight, and hides the end-the-block button
  (a manual block still wins the reason while it is running).
- **Unchecking wins.** An unchecked site is never redirected, even if its
  allowance is spent; the limit is kept so re-checking restores it.
- **The badge is the nearest freedom.** It shows the manual block's minutes
  while one runs, otherwise the hours until the daily reset. No badge means
  nothing is holding.
- The limit is a study aid, not a lock: raising it in the popup frees the site
  immediately, and an open blocked page refreshes itself.

## Shorts & Reels

The popup's **Short videos** card toggles URL-level blocking for the four
infinite feeds people lose evenings to:

| Site | Matched paths |
|---|---|
| YouTube | `/shorts`, `/shorts/<id>` |
| Instagram | `/reel`, `/reels`, `/reels/<id>` |
| Facebook | `/reel`, `/reels`, `/watch/reel` |
| Snapchat | `/spotlight` |

- The matcher (`app/core/shorts.js`) is pure and unit-tested: it reads the path,
  not the page. A watch page, a channel or a normal post is untouched.
- `syncRules` emits `declarativeNetRequest` redirects with `why=shorts`; the
  worker also checks `tabs.onUpdated` so an in-page navigation into a feed is
  caught even when the top-level URL did not change.
- The blocked page names the surface (“Short videos”), explains that the feed
  is the point, and offers **Back to the site** once the toggle is off. It never
  pretends a daily limit is the reason.
- Default on. Turning it off removes the rules immediately; nothing is stored
  per day for shorts.

## Honest limits

- It counts the **active tab in Chrome only** — not other browsers, not apps on your phone, not a second Chrome profile.
- Lockin's own web app (`lockin.surge.sh`) is never counted as time on a blocked site.
- Usage is sampled on tab and window changes plus a one-minute alarm, so a count can be off by up to a minute.
- Blocking is `declarativeNetRequest` on whole domains, top-level navigations. Subdomains are covered by the domain rule; embedded players inside an allowed page are not.
- Shorts rules match URL paths. YouTube's in-page player, an embedded Reel, or a feed rendered without changing the URL can slip past; Chrome gives the extension the tab URL, not the page content.
- The block deadline is local time. Changing the system clock can end a block early.

The Android app is the surface that can see apps and hold a device-wide block. This extension is deliberately smaller than that.
