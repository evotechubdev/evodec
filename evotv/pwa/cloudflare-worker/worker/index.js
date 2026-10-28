const BACKEND_PREFIX = '/open-stream/';
const SEGMENT_PREFIX = '/segment/';
const FORWARDED_REQUEST_HEADERS = ['accept', 'if-range', 'range'];
const FORWARDED_RESPONSE_HEADERS = [
  'accept-ranges', 'cache-control', 'content-disposition', 'content-length',
  'content-range', 'content-type', 'etag', 'last-modified',
];
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

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
      ? url.origin : '';
  } catch { return ''; }
}

function validBackendPath(pathname, search) {
  if (!pathname.startsWith(BACKEND_PREFIX) || search.length > 2048
    || pathname.length > 8192 || pathname.includes('\\')) return '';
  try {
    const segments = pathname.split('/').filter(Boolean).map(segment => decodeURIComponent(segment));
    if (segments.length !== 3 || segments.some(segment => !segment || segment === '.' || segment === '..')) return '';
  } catch { return ''; }
  return pathname;
}

function validMediaUrl(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('invalid_media_target');
  }
  return url;
}

function backendRequestHeaders(request) {
  const headers = new Headers({
    accept: 'application/json',
    'accept-encoding': 'identity',
    'user-agent': 'EVOTV-Cloudflare-Media-Proxy/2.0',
  });
  const range = request.headers.get('range');
  if (range) headers.set('range', range);
  return headers;
}

function providerRequestHeaders(request) {
  const headers = new Headers({
    'accept-encoding': 'identity',
    'user-agent': 'VLC/3.0.23 LibVLC/3.0.23',
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
  const timer = setTimeout(() => controller.abort(), 60_000);
  try { return await fetch(target, { ...init, signal: controller.signal }); }
  finally {
    clearTimeout(timer);
    request.signal.removeEventListener('abort', abort);
  }
}

async function backendRedirect(request, backendOrigin, backendPath, search) {
  const response = await fetchWithHeaderTimeout(new URL(`${backendPath}${search}`, backendOrigin), {
    method: 'GET', headers: backendRequestHeaders(request), redirect: 'manual',
  }, request);
  if (!REDIRECT_STATUSES.has(response.status)) {
    if (!response.ok) console.warn('media_backend_status', response.status);
    return { response };
  }
  const location = response.headers.get('location');
  await response.body?.cancel().catch(() => {});
  if (!location) throw new Error('backend_redirect_missing');
  return { target: validMediaUrl(new URL(location, backendOrigin).href) };
}

async function backendRelay(request, backendOrigin, backendPath) {
  const relayPath = backendPath.replace(BACKEND_PREFIX, '/stream/');
  const response = await fetchWithHeaderTimeout(new URL(relayPath, backendOrigin), {
    method: request.method,
    headers: backendRequestHeaders(request),
    redirect: 'manual',
  }, request);
  if (!response.ok) console.warn('media_backend_fallback_status', response.status);
  return response;
}

async function openProvider(request, initialTarget) {
  let target = validMediaUrl(initialTarget);
  for (let redirects = 0; redirects <= 4; redirects += 1) {
    const response = await fetchWithHeaderTimeout(target, {
      method: request.method, headers: providerRequestHeaders(request), redirect: 'manual',
    }, request);
    if (!REDIRECT_STATUSES.has(response.status)) {
      if (!response.ok) console.warn('media_provider_status', response.status, response.headers.get('content-type') || 'unknown');
      return response;
    }
    const location = response.headers.get('location');
    await response.body?.cancel().catch(() => {});
    if (!location || redirects === 4) throw new Error('provider_redirect_invalid');
    target = validMediaUrl(new URL(location, target).href);
  }
  throw new Error('provider_redirect_invalid');
}

function base64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('segment_token_invalid');
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(normalized + '='.repeat((4 - normalized.length % 4) % 4));
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

async function tokenKey(env) {
  const secret = String(env.MEDIA_TOKEN_KEY || '');
  if (secret.length < 32) throw new Error('media_token_key_missing');
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(secret));
  return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

async function sealTarget(target, env) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const clear = encoder.encode(JSON.stringify({ target: validMediaUrl(target).href, exp: Date.now() + TOKEN_TTL_MS }));
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await tokenKey(env), clear));
  const token = new Uint8Array(iv.length + encrypted.length);
  token.set(iv);
  token.set(encrypted, iv.length);
  return base64Url(token);
}

async function openTarget(token, env) {
  const bytes = fromBase64Url(token);
  if (bytes.length < 29) throw new Error('segment_token_invalid');
  const clear = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: bytes.slice(0, 12) }, await tokenKey(env), bytes.slice(12),
  );
  const data = JSON.parse(decoder.decode(clear));
  if (!Number.isFinite(data.exp) || data.exp <= Date.now()) throw new Error('segment_token_expired');
  return validMediaUrl(data.target);
}

async function rewriteManifest(manifest, baseUrl, workerOrigin, env) {
  if (!manifest.trimStart().startsWith('#EXTM3U')) throw new Error('provider_not_hls');
  const localUrl = async value => `${workerOrigin}${SEGMENT_PREFIX}${await sealTarget(new URL(value, baseUrl).href, env)}`;
  const output = [];
  for (const line of manifest.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) output.push('');
    else if (trimmed.startsWith('#')) {
      let cursor = 0;
      let rewritten = '';
      const pattern = /URI="([^"]+)"/g;
      let match;
      while ((match = pattern.exec(line)) !== null) {
        rewritten += line.slice(cursor, match.index);
        rewritten += `URI="${await localUrl(match[1])}"`;
        cursor = match.index + match[0].length;
      }
      output.push(rewritten + line.slice(cursor));
    } else output.push(await localUrl(trimmed));
  }
  return output.join('\n');
}

async function mediaResponse(upstream, origin, env, request, finalUrl) {
  const headers = corsHeaders(origin, env);
  for (const name of FORWARDED_RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  headers.set('cache-control', 'private, no-store');
  headers.set('x-content-type-options', 'nosniff');
  const type = upstream.headers.get('content-type') || '';
  const isHls = /mpegurl/i.test(type) || /\.m3u8(?:$|\?)/i.test(String(finalUrl));
  if (request.method !== 'HEAD' && isHls) {
    const manifest = await rewriteManifest(
      await upstream.text(), upstream.url || finalUrl, new URL(request.url).origin, env,
    );
    headers.set('content-type', 'application/vnd.apple.mpegurl');
    headers.delete('content-length');
    headers.delete('etag');
    return new Response(manifest, { status: upstream.status, statusText: upstream.statusText, headers });
  }
  return new Response(request.method === 'HEAD' ? null : upstream.body, {
    status: upstream.status, statusText: upstream.statusText, headers,
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const backendOrigin = validBackendOrigin(env.AUTH_BACKEND_ORIGIN);
    if (url.pathname === '/health') {
      return Response.json({
        ok: true,
        service: 'evotv-cloudflare-media-proxy',
        configured: Boolean(backendOrigin && String(env.MEDIA_TOKEN_KEY || '').length >= 32),
        providerHiddenByBackend: true,
        mediaRoute: 'direct-edge',
      }, { headers: { 'cache-control': 'no-store' } });
    }

    const origin = requestAppOrigin(request);
    if (!allowedOrigins(env).has(origin)) {
      console.warn('media_origin_rejected', origin || 'missing', url.pathname.startsWith(BACKEND_PREFIX) ? 'open-stream' : 'other');
      return jsonError(403, 'ORIGIN_FORBIDDEN', 'Origem do aplicativo nao autorizada.', '', env);
    }
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(origin, env) });
    if (!['GET', 'HEAD'].includes(request.method)) {
      return jsonError(405, 'METHOD_NOT_ALLOWED', 'Metodo nao permitido.', origin, env);
    }
    if (!backendOrigin || String(env.MEDIA_TOKEN_KEY || '').length < 32) {
      return jsonError(503, 'PROXY_NOT_CONFIGURED', 'O proxy de midia ainda nao foi configurado.', origin, env);
    }

    try {
      let target;
      let backendPath = '';
      if (url.pathname.startsWith(BACKEND_PREFIX)) {
        backendPath = validBackendPath(url.pathname, url.search);
        if (!backendPath) return jsonError(404, 'NOT_FOUND', 'Rota nao encontrada.', origin, env);
        const opened = await backendRedirect(request, backendOrigin, backendPath, url.search);
        if (opened.response) return mediaResponse(opened.response, origin, env, request, backendOrigin);
        target = opened.target;
      } else if (url.pathname.startsWith(SEGMENT_PREFIX)) {
        const token = url.pathname.slice(SEGMENT_PREFIX.length);
        if (!token || token.includes('/')) return jsonError(404, 'NOT_FOUND', 'Rota nao encontrada.', origin, env);
        target = await openTarget(token, env);
      } else return jsonError(404, 'NOT_FOUND', 'Rota nao encontrada.', origin, env);

      const upstream = await openProvider(request, target);
      if (backendPath && (upstream.status === 401 || upstream.status === 403)) {
        console.warn('media_provider_denied_using_backend_fallback', upstream.status);
        await upstream.body?.cancel().catch(() => {});
        const fallback = await backendRelay(request, backendOrigin, backendPath);
        return await mediaResponse(fallback, origin, env, request, backendOrigin);
      }
      return await mediaResponse(upstream, origin, env, request, target);
    } catch (reason) {
      console.error('media_proxy_failed', reason instanceof Error ? reason.message : 'unknown');
      return jsonError(502, 'MEDIA_PROXY_FAILED', 'Nao foi possivel receber a midia do provedor.', origin, env);
    }
  },
};
