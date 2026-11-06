/* Lockin — bootstrap: store, theme, router, tab bar, live-session resume, SW. */

import { Store } from './store.js';
import { Router } from './router.js';
import { el, $$ } from './util.js';
import { hint } from './ui.js';
import { isTrial, resetTrial } from './trial.js';
import { initHome } from './views/home.js';
import { initSchedule } from './views/schedule.js';
import { initFocus } from './views/focus.js';
import { initControl } from './views/control.js';
import { initSettings } from './views/settings.js';
import { initWalkthrough } from './views/walkthrough.js';
import { startAlarms } from './alarms.js';
import { startNative, isNative } from './native.js';
import { startUsageSnapshots } from './usage.js';
import { initAccount } from './account.js';

Store.load();

/* ---------- trial shell ----------
   A slim strip above the app, never inside a view: it survives every route and
   says plainly that this is a demo with its own storage. */

function mountTrialBar() {
  document.body.classList.add('is-trial');
  const bar = el('div', { class: 'trialbar', role: 'region', 'aria-label': 'Trial mode' },
    el('span', { class: 'trial-dot', 'aria-hidden': 'true' }),
    el('b', { class: 'trial-word' }, 'Trial'),
    el('span', { class: 'trial-who' }, 'Test Account'),
    el('span', { class: 'trial-sep', 'aria-hidden': 'true' }, '·'),
    el('span', { class: 'trial-note' }, 'demo data'),
    el('span', { class: 'trial-grow' }),
    el('button', {
      class: 'trial-btn', type: 'button',
      onclick: () => resetTrial(),
      title: 'Restore the seeded demo week',
    }, 'Reset'),
    el('a', { class: 'trial-btn trial-get', href: '/#download' }, 'Get the app'),
  );
  document.body.prepend(bar);
}

if (isTrial) mountTrialBar();

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

/* Storage quota blew up: the app still works from memory, but nothing is
   being saved. Say it once per episode — quietly, in Settings' own words. */
document.addEventListener('lockin:storage-full', () => {
  hint('Storage is full — export a backup from Settings, then free space');
});

/* ---------- routes ---------- */

initHome(Router);
initSchedule(Router);
initFocus(Router);
initControl(Router);
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
startNative();
startUsageSnapshots(); // Android only; folds usage into the synced store
initAccount(); // only touches the network when the user asked for the cloud

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

/* ---------- service worker (offline shell) ----------
   The Capacitor shell already ships the files locally; a worker there would
   only add a stale-cache layer between the app and its own assets. */

if ('serviceWorker' in navigator && !isNative) {
  addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').then((reg) => {
      /* A first install takes over silently; only an update to an existing
         worker needs a restart, so say so once instead of surprising the
         visitor with a changed app on their next reload. */
      reg.addEventListener('updatefound', () => {
        const next = reg.installing;
        if (!next) return;
        next.addEventListener('statechange', () => {
          if (next.state === 'installed' && navigator.serviceWorker.controller) {
            hint('Update downloaded — restart Lockin to refresh');
          }
        });
      });
    }).catch(() => { /* offline shell is a bonus */ });
  });
  navigator.serviceWorker.addEventListener('message', (ev) => {
    if (ev.data?.type === 'open-schedule') Router.go('/schedule');
  });
}
