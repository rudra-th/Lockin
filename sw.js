/* Lockin service worker — precache the offline shell, runtime-cache the rest.
   Bump VERSION whenever shipped files change; old caches are purged on activate. */

const VERSION = 'lockin.v1.0.0';
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
  './assets/js/audio.js',
  './assets/js/icons.js',
  './assets/js/ui.js',
  './assets/js/install.js',
  './assets/js/app.js',
  './assets/js/views/home.js',
  './assets/js/views/plan.js',
  './assets/js/views/focus.js',
  './assets/js/views/stats.js',
  './assets/js/views/settings.js',
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

  // Navigations: shell first, network fallback — the app is hash-routed,
  // so one document serves every route, offline included.
  if (req.mode === 'navigate') {
    event.respondWith(
      caches.match('./index.html').then(
        (hit) => hit || fetch(req).then((res) => {
          const copy = res.clone();
          caches.open(RUNTIME).then((c) => c.put('./index.html', copy));
          return res;
        })
      )
    );
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
