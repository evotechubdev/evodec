const CACHE = 'evotv-catalogo-offline-v86';
const APP_SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './shows-catalog.js',
  './auth-api.js',
  './device-vault.js',
  './catalog-db.js',
  './series-catalog-db.js',
  './vendor/mpegts.js',
  './manifest.webmanifest',
  './assets/poster-placeholder.svg',
  './assets/fallback-shows.png',
  './assets/logo_evotv.png',
  './assets/icon-192.png',
  './assets/icon-512.png',
];

function isolateNavigation(response) {
  if (!response || response.type === 'opaque' || response.status === 0) return response;
  const headers = new Headers(response.headers);
  headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  headers.set('Cross-Origin-Embedder-Policy', 'credentialless');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || event.request.method !== 'GET') return;
  event.respondWith((async () => {
    const cached = await caches.match(event.request);
    if (cached) return event.request.mode === 'navigate' ? isolateNavigation(cached) : cached;
    const response = await fetch(event.request);
    if (response.ok) {
      const responseCopy = response.clone();
      void caches.open(CACHE).then(cache => cache.put(event.request, responseCopy)).catch(() => {});
    }
    return event.request.mode === 'navigate' ? isolateNavigation(response) : response;
  })());
});
