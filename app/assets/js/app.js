/* Lockin — bootstrap: store, theme, router, tab bar, live-session resume, SW. */

import { Store } from './store.js';
import { Router } from './router.js';
import { $$ } from './util.js';
import { initHome } from './views/home.js';
import { initSchedule } from './views/schedule.js';
import { initFocus } from './views/focus.js';
import { initStats } from './views/stats.js';
import { initSettings } from './views/settings.js';
import { initWalkthrough } from './views/walkthrough.js';
import { startAlarms } from './alarms.js';

Store.load();

/* ---------- theme ---------- */

function applyTheme() {
  const pref = Store.state.settings.theme || 'system';
  const dark = pref === 'dark' || (pref === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  const color = dark ? '#08090c' : '#f7f8f5';
  $$('meta[name="theme-color"]').forEach((m) => { m.content = color; });
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
document.addEventListener('lockin:changed', applyTheme); // Settings theme switches apply live

/* ---------- routes ---------- */

initHome(Router);
initSchedule(Router);
initFocus(Router);
initStats(Router);
initSettings(Router);
initWalkthrough(Router);

/* a live session always owns the screen; otherwise new users start with the film */
if (Store.state.session && ['running', 'break', 'paused'].includes(Store.state.session.phase)) {
  Router.go('/focus');
} else if (!Store.state.flags.onboarded) {
  Router.go('/start');
}

Router.start();
applyTheme();
startAlarms();

/* ---------- tab bar ---------- */

function markTabs() {
  const { path } = Router.parse();
  $$('.tabbar button').forEach((b) => {
    if (b.dataset.nav === `#${path}`) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });
}

/* the shell's buttons only carry data-nav — routing lives here */
$$('.tabbar button').forEach((b) => {
  b.addEventListener('click', () => {
    if (b.dataset.nav) Router.go(b.dataset.nav);
  });
});
addEventListener('hashchange', markTabs);
markTabs();

/* re-mark after Router render settles (router renders on the same event) */
setTimeout(markTabs, 0);

/* ---------- service worker (offline shell) ---------- */

if ('serviceWorker' in navigator) {
  addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  navigator.serviceWorker.addEventListener('message', (ev) => {
    if (ev.data?.type === 'open-schedule') Router.go('/schedule');
  });
}
