/* Lockin — one-time root service-worker kill switch.

   Until 1.12.0 the app was served from `/` and its worker cached the whole
   shell. Now that the landing lives at `/`, this file answers the retired
   `/sw.js` request at the new landing root. An installed 1.11.x worker fetches
   it, installs it, and this worker then: clears every cache, unregisters
   itself, and reloads the open tabs. The landing page registers no worker, so
   nothing takes its place. Visitors who never installed the old app never load
   this file. */

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((key) => caches.delete(key)));

    /* Retire the registration before reloading so the next document is a
       plain network load, not a controlled one. */
    await self.registration.unregister();

    const windows = await self.clients.matchAll({ type: 'window' });
    await Promise.all(windows.map(async (client) => {
      try { await client.navigate(client.url); } catch (_) { /* closing tab */ }
    }));
  })());
});

/* While this worker is briefly in control, never answer from a cache: the old
   shell must not win a race against the activation above. */
self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request));
});
