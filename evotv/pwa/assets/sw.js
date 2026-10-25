const CACHE_NAME = 'evotv-pwa-v15';
const SERVICE_WORKER_VERSION = '15';
const APP_ROOT = new URL('./', self.location.href).href;
const PWA_ROOT = new URL('pwa/', APP_ROOT).href;
const PWA_INDEX = new URL('index.html', PWA_ROOT).href;
const MEDIA_PATH = new URL('__media/', PWA_ROOT).pathname;
const RELAY_ORIGINS = new Set([
  'https://evotv-web-media-relay.bonnystork8.chatgpt.site',
  'https://evodec.onrender.com',
]);
const MEDIA_SESSION_MS = 12 * 60 * 60 * 1000;
const MEDIA_ID = /^[a-f0-9-]{32,40}$/i;
const REQUIRED_MEDIA_HEADERS = [
  'x-evo-session',
  'x-evo-profile',
  'x-evo-platform',
  'x-evo-version',
  'x-evo-version-code',
];
const mediaSources = new Map();
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
  const data = event.data;
  const reply = (value) => event.ports[0]?.postMessage(value);
  if (!isPwaClient(event.source) || !data || typeof data !== 'object') {
    reply({ ok: false, error: 'Solicitação de mídia não autorizada.' });
    return;
  }
  if (data.type === 'EVOTV_PING') {
    reply({ ok: true, version: SERVICE_WORKER_VERSION });
    return;
  }
  if (data.type === 'EVOTV_MEDIA_REMOVE') {
    if (MEDIA_ID.test(String(data.id || ''))) mediaSources.delete(data.id);
    reply({ ok: true });
    return;
  }
  if (data.type !== 'EVOTV_MEDIA_REGISTER') return;
  try {
    const id = String(data.id || '');
    const relayUrl = new URL(String(data.url || ''));
    if (!MEDIA_ID.test(id) || !RELAY_ORIGINS.has(relayUrl.origin) || !relayUrl.pathname.startsWith('/stream/')) {
      throw new Error('Endereço de mídia inválido.');
    }
    const inputHeaders = new Headers(data.headers || {});
    const headers = {};
    for (const name of REQUIRED_MEDIA_HEADERS) {
      const value = inputHeaders.get(name);
      if (!value || value.length > 8192) throw new Error('A sessão do perfil está incompleta.');
      headers[name] = value;
    }
    pruneMediaSources();
    if (mediaSources.size >= 12) mediaSources.delete(mediaSources.keys().next().value);
    mediaSources.set(id, { url: relayUrl.href, headers, expiresAt: Date.now() + MEDIA_SESSION_MS });
    reply({ ok: true });
  } catch (error) {
    reply({ ok: false, error: error instanceof Error ? error.message : 'Não foi possível proteger a mídia.' });
  }
});

function isPwaClient(source) {
  try {
    return source && new URL(source.url).pathname.startsWith(new URL(PWA_ROOT).pathname);
  } catch {
    return false;
  }
}

function pruneMediaSources() {
  const now = Date.now();
  for (const [id, source] of mediaSources) {
    if (source.expiresAt <= now) mediaSources.delete(id);
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
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith(MEDIA_PATH)) {
    const id = url.pathname.slice(MEDIA_PATH.length).split('/')[0];
    event.respondWith(fetchProtectedMedia(request, id));
    return;
  }

  if (request.method !== 'GET') return;
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

async function fetchProtectedMedia(request, id) {
  pruneMediaSources();
  const source = mediaSources.get(id);
  if (!source || !['GET', 'HEAD'].includes(request.method)) {
    return Response.json(
      { code: 'MEDIA_LINK_EXPIRED', error: 'Este endereço temporário não pode ser reutilizado. Abra a mídia pelo EVOTV.' },
      { status: 410, headers: { 'cache-control': 'no-store' } },
    );
  }
  const headers = new Headers(source.headers);
  for (const name of ['range', 'if-range', 'accept']) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  if (source.lastFailure && Date.now() - source.lastFailure.at < 30_000) {
    return mediaFailureResponse(source.lastFailure);
  }
  try {
    const response = await fetch(source.url, {
      method: request.method,
      headers,
      mode: 'cors',
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'follow',
      signal: request.signal,
    });
    if (!response.ok) {
      const body = await response.clone().text();
      let message = `O proxy de mídia respondeu com HTTP ${response.status}.`;
      try {
        const data = JSON.parse(body);
        if (typeof data?.error === 'string' && data.error.trim()) message = data.error;
      } catch {
        // Respostas não JSON usam a mensagem segura acima.
      }
      source.lastFailure = { status: response.status, message, at: Date.now() };
    } else {
      delete source.lastFailure;
    }
    const responseHeaders = new Headers(response.headers);
    responseHeaders.set('cache-control', 'private, no-store');
    return new Response(request.method === 'HEAD' ? null : response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });
  } catch {
    source.lastFailure = {
      status: 502,
      message: 'Não foi possível conectar ao servidor seguro de mídia.',
      at: Date.now(),
    };
    return mediaFailureResponse(source.lastFailure);
  }
}

function mediaFailureResponse(failure) {
  return Response.json(
    { code: 'MEDIA_RELAY_FAILED', error: failure.message },
    { status: failure.status, headers: { 'cache-control': 'no-store' } },
  );
}
