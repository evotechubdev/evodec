const CACHE_NAME = 'evotv-pwa-v7';
const APP_ROOT = new URL('./', self.location.href).href;
const PWA_ROOT = new URL('pwa/', APP_ROOT).href;
const APP_SHELL = [
  PWA_ROOT,
  new URL('pwa/manifest.json', APP_ROOT).href,
  new URL('icons/icon-192.png', APP_ROOT).href,
  new URL('icons/icon-512.png', APP_ROOT).href,
];

self.addEventListener('install', (event) => {
  event.waitUntil(cacheApplicationShell().then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

async function cacheApplicationShell() {
  const cache = await caches.open(CACHE_NAME);
  await cache.addAll(APP_SHELL);
  const documentResponse = await cache.match(PWA_ROOT);
  if (!documentResponse) return;
  const html = await documentResponse.text();
  const urls = Array.from(html.matchAll(/(?:src|href)=["']([^"']+)["']/g))
    .map((match) => new URL(match[1], PWA_ROOT))
    .filter(
      (url) =>
        url.origin === self.location.origin &&
        url.pathname.startsWith(new URL(APP_ROOT).pathname),
    )
    .map((url) => url.href);
  await cache.addAll([...new Set(urls)]);
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          void caches.open(CACHE_NAME).then((cache) => cache.put(PWA_ROOT, copy));
          return response;
        })
        .catch(() => caches.match(PWA_ROOT)),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          void caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      });
    }),
  );
});
