/* Lockin service worker — precache the offline shell, runtime-cache the rest.
   Bump VERSION whenever shipped files change; old caches are purged on activate. */

const VERSION = 'lockin.v1.0.18';
const CORE = `${VERSION}-core`;
const RUNTIME = `${VERSION}-runtime`;

const PRECACHE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './favicon.svg',
  './assets/css/app.css',
  './assets/js/store.js',
  './assets/js/util.js',
  './assets/js/router.js',
  './assets/js/icons.js',
  './assets/js/ui.js',
  './assets/js/install.js',
  './assets/js/app.js',
  './assets/js/views/home.js',
  './assets/js/views/plan.js',
  './assets/js/views/focus.js',
  './assets/js/views/stats.js',
  './assets/js/views/settings.js',
  './assets/js/views/setup.js',
  './assets/js/views/walkthrough.js',
  './assets/fonts/inter-latin.woff2',
  './assets/fonts/inter-latin-ext.woff2',
  './assets/fonts/jetbrains-mono-latin.woff2',
  './assets/fonts/instrument-serif-latin.woff2',
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
