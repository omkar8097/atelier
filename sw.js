const CACHE_NAME = 'atelier-v4';
const SHELL_FILES = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './csv-utils.js',
  './outfit-engine.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Never intercept or cache Anthropic API calls
  if (event.request.url.includes('api.anthropic.com')) {
    return;
  }

  event.respondWith(
    caches.match(event.request, { ignoreSearch: true }).then((cached) => {
      if (cached) {
        return cached;
      }

      // If not in cache, try network and catch network errors gracefully
      return fetch(event.request)
        .then((response) => {
          // Cache external fonts if fetched online
          if (response.ok && (event.request.url.includes('fonts.googleapis.com') || event.request.url.includes('fonts.gstatic.com'))) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(() => {
          // Offline fallback for navigation requests
          if (event.request.mode === 'navigate') {
            return caches.match('./index.html') || caches.match('./');
          }
          return new Response('', { status: 503, statusText: 'Offline' });
        });
    })
  );
});
