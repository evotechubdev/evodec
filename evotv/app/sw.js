const CACHE = 'evotv-catalogo-offline-v10';
const APP_SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './catalog-db.js',
  './manifest.webmanifest',
  './assets/poster-placeholder.svg',
  './assets/logo_evotv.png',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './data/catalogo-offline.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || event.request.method !== 'GET') return;
  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request).then((response) => {
    if (response.ok) caches.open(CACHE).then((cache) => cache.put(event.request, response.clone()));
    return response;
  })));
});
