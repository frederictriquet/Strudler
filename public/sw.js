// [SPEC-14.4] Service Worker: cache the remote sample bank so that, after the
// first (networked) load, samples are available offline. It intercepts ONLY the
// sample host — app assets, Vite HMR and everything else are untouched.

const CACHE = 'strudler-samples-v1';
const SAMPLE_HOSTS = ['raw.githubusercontent.com'];

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
  let url;
  try {
    url = new URL(event.request.url);
  } catch {
    return; // non-standard request; let the browser handle it
  }
  if (!SAMPLE_HOSTS.includes(url.hostname)) return; // only cache samples

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(event.request);
      if (cached) return cached; // cache-first → offline once warm
      try {
        const response = await fetch(event.request);
        // Cache successful CORS responses for next time.
        if (response && response.ok) cache.put(event.request, response.clone());
        return response;
      } catch (err) {
        const fallback = await cache.match(event.request);
        if (fallback) return fallback;
        throw err; // genuinely offline and not cached
      }
    })(),
  );
});
