const CACHE_NAME = 'evotv-pwa-v16';
const SERVICE_WORKER_VERSION = '16';
const APP_ROOT = new URL('./', self.location.href).href;
const PWA_ROOT = new URL('pwa/', APP_ROOT).href;
const PWA_INDEX = new URL('index.html', PWA_ROOT).href;
const APP_SHELL = [
  PWA_ROOT,
  PWA_INDEX,
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

self.addEventListener('message', (event) => {
  const reply = (value) => event.ports[0]?.postMessage(value);
  if (!isPwaClient(event.source) || event.data?.type !== 'EVOTV_PING') {
    reply({ ok: false, error: 'Mensagem não reconhecida.' });
    return;
  }
  reply({ ok: true, version: SERVICE_WORKER_VERSION });
});

function isPwaClient(source) {
  try {
    return source && new URL(source.url).pathname.startsWith(new URL(PWA_ROOT).pathname);
  } catch {
    return false;
  }
}

async function cacheApplicationShell() {
  const cache = await caches.open(CACHE_NAME);
  await Promise.all(APP_SHELL.map(async (url) => {
    const response = await fetch(url, { cache: 'reload' });
    if (!response.ok) throw new Error(`Falha ao atualizar ${url}`);
    await cache.put(url, response);
  }));
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
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || request.method !== 'GET') return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request, { cache: 'no-store' })
        .then((response) => {
          const copy = response.clone();
          void caches.open(CACHE_NAME).then((cache) => cache.put(PWA_ROOT, copy));
          return response;
        })
        .catch(async () => (await caches.match(PWA_ROOT)) || Response.error()),
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
      }).catch(async () => {
        if (url.href === PWA_INDEX || url.pathname === new URL(PWA_ROOT).pathname) {
          return (await caches.match(PWA_INDEX)) ||
            (await caches.match(PWA_ROOT)) ||
            Response.error();
        }
        return Response.error();
      });
    }),
  );
});
