/* Lockin service worker — precache the offline shell, runtime-cache the rest.
   Bump VERSION whenever shipped files change; old caches are purged on activate. */

const VERSION = 'lockin.v1.11.1';
const CORE = `${VERSION}-core`;
const RUNTIME = `${VERSION}-runtime`;

const PRECACHE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './favicon.svg',
  './assets/css/app.css',
  './core/time.js',
  './core/honesty.js',
  './core/schedule.js',
  './core/sync.js',
  './assets/js/store.js',
  './assets/js/exams.js',
  './assets/js/util.js',
  './assets/js/router.js',
  './assets/js/icons.js',
  './assets/js/ui.js',
  './assets/js/install.js',
  './assets/js/tasks.js',
  './assets/js/controls.js',
  './assets/js/alarms.js',
  './assets/js/native.js',
  './assets/js/firebase.js',
  './assets/js/account.js',
  './assets/js/sync.js',
  './assets/js/app.js',
  './assets/js/views/home.js',
  './assets/js/views/schedule.js',
  './assets/js/views/focus.js',
  './assets/js/views/stats.js',
  './assets/js/views/settings.js',
  './assets/js/views/walkthrough.js',
  './assets/fonts/hanken-grotesk-latin.woff2',
  './assets/fonts/hanken-grotesk-latin-ext.woff2',
  './assets/fonts/fraunces-latin.woff2',
  './assets/fonts/fraunces-latin-ext.woff2',
  './assets/fonts/fraunces-italic-latin.woff2',
  './assets/fonts/ibm-plex-mono-400.woff2',
  './assets/fonts/ibm-plex-mono-500.woff2',
  './assets/fonts/ibm-plex-mono-600.woff2',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/icons/icon-maskable-192.png',
  './assets/icons/icon-maskable-512.png',
  './assets/icons/apple-touch-icon.png',
  './assets/icons/favicon-32.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CORE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Firebase's CDN modules are versioned and immutable: after the first
  // sign-in they are cached for good, so the cloud keeps working offline.
  if (url.hostname === 'www.gstatic.com' && url.pathname.startsWith('/firebasejs/')) {
    event.respondWith(
      caches.match(req).then(
        (hit) => hit || fetch(req).then((res) => {
          const copy = res.clone();
          caches.open(RUNTIME).then((c) => c.put(req, copy));
          return res;
        })
      )
    );
    return;
  }

  if (url.origin !== location.origin) return;

  // Navigations: the hash-routed shell owns '/' and '/index.html' — serve it
  // cached-first, offline included. Aux pages (tests.html, …) go network-first,
  // get remembered in the runtime cache, and fall back to the shell offline.
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      if (url.pathname === '/' || url.pathname === '/index.html') {
        return (await caches.match('./index.html')) || fetch(req);
      }
      try {
        const res = await fetch(req);
        await caches.open(RUNTIME).then((c) => c.put(req, res.clone()));
        return res;
      } catch (_) {
        return (await caches.match(req)) || (await caches.match('./index.html'));
      }
    })());
    return;
  }

  // Everything else: cache first, then network (and remember it).
  event.respondWith(
    caches.match(req).then(
      (hit) => hit || fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(RUNTIME).then((c) => c.put(req, copy));
        return res;
      })
    )
  );
});

/* Tapping a schedule notification brings the app forward, or opens it at
   the schedule when no Lockin window is alive. */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const alive = windows.find((c) => 'focus' in c);
    if (alive) {
      await alive.focus();
      alive.postMessage({ type: 'open-schedule' });
      return;
    }
    await self.clients.openWindow('./index.html#/schedule');
  })());
});
