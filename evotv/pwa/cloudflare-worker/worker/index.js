const PROXY_PREFIXES = ['/stream/', '/segment/'];
const FORWARDED_REQUEST_HEADERS = ['accept', 'if-range', 'range'];
const FORWARDED_RESPONSE_HEADERS = [
  'accept-ranges',
  'cache-control',
  'content-disposition',
  'content-length',
  'content-range',
  'content-type',
  'etag',
  'last-modified',
];
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

function csv(value) {
  return String(value || '').split(',').map(item => item.trim()).filter(Boolean);
}

function allowedOrigins(env) {
  return new Set(csv(env.ALLOWED_APP_ORIGINS));
}

function requestAppOrigin(request) {
  const origin = request.headers.get('origin');
  if (origin && origin !== 'null') return origin;
  const referer = request.headers.get('referer');
  if (!referer) return '';
  try { return new URL(referer).origin; } catch { return ''; }
}

function corsHeaders(origin, env) {
  const headers = new Headers({
    'access-control-allow-headers': 'Accept, If-Range, Range',
    'access-control-allow-methods': 'GET, HEAD, OPTIONS',
    'access-control-expose-headers': 'Accept-Ranges, Content-Length, Content-Range, Content-Type',
    'cache-control': 'private, no-store',
    vary: 'Origin',
  });
  if (allowedOrigins(env).has(origin)) headers.set('access-control-allow-origin', origin);
  return headers;
}

function jsonError(status, code, message, origin, env) {
  return Response.json({ code, error: message }, { status, headers: corsHeaders(origin, env) });
}

function validBackendOrigin(value) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash
      ? url.origin
      : '';
  } catch {
    return '';
  }
}

function validBackendPath(pathname, search) {
  const prefix = PROXY_PREFIXES.find(candidate => pathname.startsWith(candidate));
  if (!prefix || search.length > 2048 || pathname.length > 8192 || pathname.includes('\\')) return '';
  try {
    const segments = pathname.split('/').filter(Boolean).map(segment => decodeURIComponent(segment));
    if (segments.length < 3 || segments.some(segment => !segment || segment === '.' || segment === '..')) return '';
  } catch {
    return '';
  }
  return pathname;
}

function backendRequestHeaders(request) {
  const headers = new Headers({
    'accept-encoding': 'identity',
    'user-agent': 'EVOTV-Cloudflare-Media-Proxy/1.0',
  });
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  return headers;
}

async function fetchWithHeaderTimeout(target, init, request) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  request.signal.addEventListener('abort', abort, { once: true });
  // O Render pode precisar de mais de 20 segundos para sair do estado ocioso.
  const timer = setTimeout(() => controller.abort(), 60_000);
  try {
    return await fetch(target, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    request.signal.removeEventListener('abort', abort);
  }
}

async function openBackend(request, target) {
  const response = await fetchWithHeaderTimeout(target, {
    method: request.method,
    headers: backendRequestHeaders(request),
    redirect: 'manual',
  }, request);
  if (!REDIRECT_STATUSES.has(response.status)) return response;
  await response.body?.cancel().catch(() => {});
  throw new Error('backend_redirect_forbidden');
}

function rewriteManifest(manifest, backendOrigin, workerOrigin) {
  return manifest
    .split(`${backendOrigin}/stream/`).join(`${workerOrigin}/stream/`)
    .split(`${backendOrigin}/segment/`).join(`${workerOrigin}/segment/`);
}

async function mediaResponse(upstream, origin, env, request, backendOrigin) {
  const headers = corsHeaders(origin, env);
  for (const name of FORWARDED_RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  headers.set('cache-control', 'private, no-store');
  headers.set('x-content-type-options', 'nosniff');
  const type = upstream.headers.get('content-type') || '';
  if (request.method !== 'HEAD' && /mpegurl/i.test(type)) {
    const manifest = rewriteManifest(await upstream.text(), backendOrigin, new URL(request.url).origin);
    headers.delete('content-length');
    headers.delete('etag');
    return new Response(manifest, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers,
    });
  }
  return new Response(request.method === 'HEAD' ? null : upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/health') {
      return Response.json({
        ok: true,
        service: 'evotv-cloudflare-media-proxy',
        configured: Boolean(validBackendOrigin(env.AUTH_BACKEND_ORIGIN)),
        providerHiddenByBackend: true,
      }, { headers: { 'cache-control': 'no-store' } });
    }

    const origin = requestAppOrigin(request);
    if (!allowedOrigins(env).has(origin)) {
      return jsonError(403, 'ORIGIN_FORBIDDEN', 'Origem do aplicativo não autorizada.', '', env);
    }
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin, env) });
    }
    if (!['GET', 'HEAD'].includes(request.method)) {
      return jsonError(405, 'METHOD_NOT_ALLOWED', 'Método não permitido.', origin, env);
    }

    const backendPath = validBackendPath(url.pathname, url.search);
    const backendOrigin = validBackendOrigin(env.AUTH_BACKEND_ORIGIN);
    if (!backendPath) return jsonError(404, 'NOT_FOUND', 'Rota não encontrada.', origin, env);
    if (!backendOrigin) {
      return jsonError(503, 'PROXY_NOT_CONFIGURED', 'O proxy de mídia ainda não foi configurado.', origin, env);
    }

    const backendUrl = new URL(`${backendPath}${url.search}`, backendOrigin);
    try {
      const upstream = await openBackend(request, backendUrl);
      return await mediaResponse(upstream, origin, env, request, backendOrigin);
    } catch (reason) {
      console.error('media_proxy_failed', reason instanceof Error ? reason.message : 'unknown');
      return jsonError(502, 'MEDIA_PROXY_FAILED', 'Não foi possível abrir a mídia pelo backend.', origin, env);
    }
  },
};
