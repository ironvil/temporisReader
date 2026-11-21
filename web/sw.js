/**
 * Service worker for the web version (built into dist-web/sw.js by vite.config.ts, which fills in
 * the cache name and file list). Keeps the whole app so it opens without a connection; books,
 * dictionaries and settings live in the browser's storage (IndexedDB), not here.
 *
 * A new version installs in the background and waits; the page tells it to take over while the
 * app is hidden (src/web-app.ts), then reloads.
 */
const CACHE = __CACHE__;
const FILES = __FILES__;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('temporis-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      // Pages (any path in scope) are the app's one page.
      const cached = request.mode === 'navigate' ? await cache.match('./', { ignoreVary: true }) : await cache.match(request, { ignoreSearch: true, ignoreVary: true });
      return cached ?? fetch(request);
    })(),
  );
});
