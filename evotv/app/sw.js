const CACHE = 'evotv-catalogo-offline-v110';
const ISOLATION_CACHE = 'evotv-cross-origin-isolation-v1';
const ISOLATION_POLICY_URL = new URL('./.cross-origin-isolation-policy', self.location.href).href;
const APP_SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './auth-api.js',
  './device-vault.js',
  './catalog-db.js',
  './series-catalog-db.js',
  './vendor/mpegts.js',
  './vendor/hls.min.js',
  './manifest.webmanifest',
  './assets/poster-placeholder.svg',
  './assets/fallback-shows.png',
  './assets/logo_evotv.png',
  './assets/icon-192.png',
  './assets/icon-512.png',
];

async function isolationPolicy() {
  const cache = await caches.open(ISOLATION_CACHE);
  const stored = await cache.match(ISOLATION_POLICY_URL);
  return stored ? stored.text() : 'credentialless';
}

async function isolateNavigation(response) {
  if (!response || response.type === 'opaque' || response.status === 0) return response;
  const policy = await isolationPolicy();
  const headers = new Headers(response.headers);
  headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  headers.set('Cross-Origin-Embedder-Policy', policy);
  headers.set('Permissions-Policy', 'cross-origin-isolated=(self "https://evotv-offline-media-proxy.evotechubdev.workers.dev")');
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
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE && key !== ISOLATION_CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener('message', (event) => {
  if (event.data?.type !== 'evotv:set-isolation-policy') return;
  const policy = event.data.policy;
  if (!['credentialless', 'require-corp'].includes(policy)) return;
  event.waitUntil(caches.open(ISOLATION_CACHE)
    .then((cache) => cache.put(ISOLATION_POLICY_URL, new Response(policy)))
    .then(() => event.ports[0]?.postMessage({ ok: true, policy })));
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || event.request.method !== 'GET') return;
  event.respondWith((async () => {
    const cached = await caches.match(event.request);
    if (event.request.mode === 'navigate') {
      try {
        const response = await fetch(event.request);
        if (response.ok) {
          const responseCopy = response.clone();
          void caches.open(CACHE).then(cache => cache.put(event.request, responseCopy)).catch(() => {});
        }
        return isolateNavigation(response);
      } catch {
        const fallback = cached || await caches.match(new URL('./index.html', self.registration.scope).href);
        return isolateNavigation(fallback);
      }
    }
    if (cached) return cached;
    const response = await fetch(event.request);
    if (response.ok) {
      const responseCopy = response.clone();
      void caches.open(CACHE).then(cache => cache.put(event.request, responseCopy)).catch(() => {});
    }
    return response;
  })());
});
