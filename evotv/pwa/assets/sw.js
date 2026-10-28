const CACHE_NAME = 'evotv-pwa-v17';
const SERVICE_WORKER_VERSION = '17';
const APP_ROOT = new URL('./', self.location.href).href;
const PWA_ROOT = new URL('pwa/', APP_ROOT).href;
const PWA_INDEX = new URL('index.html', PWA_ROOT).href;
const DIRECT_MEDIA_PREFIX = new URL('__direct_media/', PWA_ROOT).pathname;
const directMediaTargets = new Map();
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
  if (!isPwaClient(event.source)) {
    reply({ ok: false, error: 'Mensagem não reconhecida.' });
    return;
  }
  if (event.data?.type === 'EVOTV_PING') {
    reply({ ok: true, version: SERVICE_WORKER_VERSION });
    return;
  }
  if (event.data?.type === 'EVOTV_DIRECT_MEDIA_REGISTER') {
    try {
      const id = String(event.data.id || '');
      const target = new URL(String(event.data.target || ''));
      if (!/^[a-f0-9-]{36}$/i.test(id)
        || !['http:', 'https:'].includes(target.protocol)
        || target.username || target.password) {
        throw new Error('invalid_direct_media');
      }
      const now = Date.now();
      for (const [key, value] of directMediaTargets) {
        if (value.expiresAt <= now) directMediaTargets.delete(key);
      }
      while (directMediaTargets.size >= 8) directMediaTargets.delete(directMediaTargets.keys().next().value);
      directMediaTargets.set(id, { target: target.href, expiresAt: now + 2 * 60 * 60 * 1000 });
      reply({ ok: true });
    } catch {
      reply({ ok: false, error: 'Destino de midia invalido.' });
    }
    return;
  }
  reply({ ok: false, error: 'Mensagem nao reconhecida.' });
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

  if (url.pathname.startsWith(DIRECT_MEDIA_PREFIX)) {
    event.respondWith(relayDirectMedia(request, url));
    return;
  }

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

async function relayDirectMedia(request, url) {
  const relative = url.pathname.slice(DIRECT_MEDIA_PREFIX.length);
  const id = relative.split('/')[0] || '';
  const entry = directMediaTargets.get(id);
  if (!entry || entry.expiresAt <= Date.now()) {
    directMediaTargets.delete(id);
    return new Response('Autorizacao de midia expirada.', { status: 410 });
  }
  const headers = new Headers({ Accept: request.headers.get('accept') || '*/*' });
  const range = request.headers.get('range');
  if (range) headers.set('Range', range);
  try {
    const upstream = await fetch(entry.target, {
      method: 'GET',
      headers,
      cache: 'no-store',
      redirect: 'follow',
    });
    const responseHeaders = new Headers({
      'Cache-Control': 'private, no-store',
      'Content-Type': upstream.headers.get('content-type') || 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
    });
    for (const name of ['accept-ranges', 'content-length', 'content-range', 'etag', 'last-modified']) {
      const value = upstream.headers.get(name);
      if (value) responseHeaders.set(name, value);
    }
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders,
    });
  } catch {
    return new Response('O navegador bloqueou a conexao HTTP direta.', { status: 502 });
  }
}
