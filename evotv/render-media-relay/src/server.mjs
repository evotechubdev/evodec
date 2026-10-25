import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import http from 'node:http';
import net from 'node:net';
import { once } from 'node:events';
import { pathToFileURL } from 'node:url';

const DEFAULT_ALLOWED_ORIGIN = 'https://evotechubdev.github.io';
const DEFAULT_BACKEND_ORIGIN = 'https://multimideas-evo-backend.onrender.com';
const RELAY_RELEASE = '5';
const SESSION_HEADERS = [
  'x-evo-session',
  'x-evo-profile',
  'x-evo-platform',
  'x-evo-version',
  'x-evo-version-code',
];
const MEDIA_CACHE_MS = 12 * 60 * 60 * 1000;
const MEDIA_CACHE_MAX = 1_000;
const BACKEND_TIMEOUT_MS = 30_000;
const OPEN_TIMEOUT_MS = 10_000;
const REDIRECT_LIMIT = 3;
const PLAYLIST_LIMIT = 1024 * 1024;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const PLAYER_ATTEMPTS = [
  { userAgent: 'VLC/3.0.21 LibVLC/3.0.21', forceRange: false },
  { userAgent: 'VLC/3.0.21 LibVLC/3.0.21', forceRange: true },
  { userAgent: 'VLC/3.0.23 LibVLC/3.0.23', forceRange: false },
  { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/149.0.0.0 Safari/537.36', forceRange: false },
];
const EXPOSED_HEADERS = [
  'content-type',
  'content-length',
  'content-range',
  'accept-ranges',
  'etag',
  'last-modified',
];

export function createRelayServer(options = {}) {
  const allowedOrigin = normalizeOrigin(options.allowedOrigin || process.env.ALLOWED_ORIGIN || DEFAULT_ALLOWED_ORIGIN);
  const backendOrigin = normalizeOrigin(options.backendOrigin || process.env.AUTH_BACKEND_ORIGIN || DEFAULT_BACKEND_ORIGIN);
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const assertTarget = options.assertTarget || assertPublicHttpUrl;
  const resolvedTargets = new Map();

  return http.createServer(async (request, response) => {
    setSecurityHeaders(response);
    try {
      const requestUrl = new URL(request.url || '/', 'http://relay.invalid');
      if (requestUrl.pathname === '/health') {
        return sendJson(response, 200, {
          ok: true,
          service: 'evotv-render-media-relay',
          release: RELAY_RELEASE,
          region: process.env.RENDER_REGION || 'configured-by-render',
        });
      }

      const origin = normalizeOptionalOrigin(request.headers.origin);
      if (origin !== allowedOrigin) return sendError(response, 403, 'ORIGIN_FORBIDDEN', 'Origem não autorizada.');
      setCorsHeaders(response, allowedOrigin);
      if (request.method === 'OPTIONS') {
        response.writeHead(204);
        return response.end();
      }
      if (!['GET', 'HEAD'].includes(request.method || '')) {
        return sendError(response, 405, 'METHOD_NOT_ALLOWED', 'Método não permitido.');
      }

      const match = /^\/stream\/([A-Za-z0-9_-]+)\/([0-9]+\.[A-Za-z0-9]{1,8})$/.exec(requestUrl.pathname);
      if (!match) return sendError(response, 404, 'NOT_FOUND', 'Rota não encontrada.');
      const sessionValues = requireSessionHeaders(request);
      const openUrl = decodeSource(match[1]);
      validateBackendTicket(openUrl, backendOrigin, match[2]);
      pruneCache(resolvedTargets);

      const cacheKey = sha256(`${openUrl}\0${sessionValues.join('\0')}`);
      let cached = resolvedTargets.get(cacheKey);
      if (!cached) {
        const target = await resolveSignedTarget(openUrl, fetchImpl, assertTarget);
        cached = { target, expiresAt: Date.now() + MEDIA_CACHE_MS };
        resolvedTargets.set(cacheKey, cached);
        while (resolvedTargets.size > MEDIA_CACHE_MAX) resolvedTargets.delete(resolvedTargets.keys().next().value);
      }

      await streamProvider(request, response, cached.target, fetchImpl, assertTarget);
    } catch (reason) {
      if (response.headersSent) {
        response.destroy();
        return;
      }
      const failure = publicFailure(reason);
      sendError(response, failure.status, failure.code, failure.message);
    }
  });
}

function normalizeOrigin(value) {
  const url = new URL(String(value));
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('invalid origin');
  }
  return url.origin;
}

function normalizeOptionalOrigin(value) {
  try { return value ? normalizeOrigin(value) : ''; }
  catch { return ''; }
}

function requireSessionHeaders(request) {
  return SESSION_HEADERS.map((name) => {
    const value = String(request.headers[name] || '');
    if (!value || value.length > 8_192) throw failure(401, 'SESSION_REQUIRED', 'Abra a mídia pelo perfil ativo no EVOTV.');
    return value;
  });
}

function decodeSource(value) {
  try {
    const decoded = Buffer.from(value, 'base64url').toString('utf8');
    if (!decoded || decoded.length > 8_192) throw new Error();
    return decoded;
  } catch {
    throw failure(401, 'STREAM_TICKET_INVALID', 'A autorização da mídia é inválida.');
  }
}

function validateBackendTicket(value, backendOrigin, file) {
  let url;
  try { url = new URL(value); }
  catch { throw failure(401, 'STREAM_TICKET_INVALID', 'A autorização da mídia é inválida.'); }
  const parts = url.pathname.split('/').filter(Boolean);
  if (url.origin !== backendOrigin || url.protocol !== 'https:' || url.username || url.password || url.search || url.hash
    || parts.length !== 3 || parts[0] !== 'open-stream' || !parts[1] || parts[2] !== file) {
    throw failure(401, 'STREAM_TICKET_INVALID', 'A autorização da mídia é inválida.');
  }
}

async function resolveSignedTarget(openUrl, fetchImpl, assertTarget) {
  let response;
  try {
    response = await fetchWithTimeout(fetchImpl, openUrl, {
      method: 'GET',
      redirect: 'manual',
      headers: { accept: '*/*', 'user-agent': PLAYER_ATTEMPTS[0].userAgent },
    }, BACKEND_TIMEOUT_MS);
  } catch {
    throw failure(502, 'AUTH_BACKEND_UNREACHABLE', 'O relay não conseguiu validar a autorização no backend.');
  }
  await response.body?.cancel().catch(() => {});
  if (!REDIRECT_STATUSES.has(response.status)) {
    throw failure(response.status === 410 ? 410 : 502, 'STREAM_TICKET_REJECTED', 'O backend recusou ou não conseguiu resolver a autorização da mídia.');
  }
  const location = response.headers.get('location');
  if (!location) throw failure(502, 'STREAM_TARGET_MISSING', 'O backend não retornou o destino da mídia.');
  const target = new URL(location, openUrl);
  await assertTarget(target);
  return target.href;
}

async function streamProvider(request, response, target, fetchImpl, assertTarget) {
  let lastStatus = 0;
  let lastError;
  try {
    const authStatus = await authorizeProvider(target, fetchImpl, assertTarget);
    console.log('provider_account_check', `status=${authStatus}`);
  } catch (reason) {
    console.warn('provider_account_check_failed', `error=${reason instanceof Error ? reason.name : 'UnknownError'}`);
  }
  for (let index = 0; index < PLAYER_ATTEMPTS.length; index++) {
    const attempt = PLAYER_ATTEMPTS[index];
    try {
      const opened = await openProvider(target, request, response, attempt, fetchImpl, assertTarget);
      lastStatus = opened.upstream.status;
      if (!opened.upstream.ok || opened.upstream.status === 416) {
        console.warn('provider_attempt_rejected', `attempt=${index + 1} status=${opened.upstream.status} range=${attempt.forceRange ? 'forced' : request.headers.range ? 'client' : 'none'}`);
        await opened.reader?.cancel().catch(() => {});
        opened.cleanup();
        continue;
      }
      copyMediaHeaders(opened.upstream, response);
      response.writeHead(opened.upstream.status);
      if (request.method === 'HEAD') {
        opened.cleanup();
        return response.end();
      }
      if (!response.write(opened.first)) await once(response, 'drain');
      try {
        while (true) {
          const chunk = await opened.reader.read();
          if (chunk.done) break;
          if (!response.write(chunk.value)) await once(response, 'drain');
        }
        response.end();
      } finally {
        opened.cleanup();
      }
      return;
    } catch (reason) {
      console.warn('provider_attempt_failed', `attempt=${index + 1} error=${reason instanceof Error ? reason.name : 'UnknownError'}`);
      lastError = reason;
    }
  }
  try {
    const hls = await streamHlsFallback(request, response, target, fetchImpl, assertTarget);
    if (hls.started) {
      console.log('provider_hls_fallback', `status=started segments=${hls.segments}`);
      return;
    }
    console.warn('provider_hls_fallback_rejected', `status=${hls.status}`);
  } catch (reason) {
    console.warn('provider_hls_fallback_failed', `error=${reason instanceof Error ? reason.name : 'UnknownError'}`);
    if (response.headersSent) throw reason;
    lastError = reason;
  }
  if (lastStatus) throw failure(502, 'IPTV_UPSTREAM_FAILED', `O provedor recusou a mídia (HTTP ${lastStatus}).`);
  if (lastError?.name === 'AbortError' || lastError?.name === 'TimeoutError') {
    throw failure(502, 'IPTV_UPSTREAM_TIMEOUT', 'O servidor IPTV não iniciou a transmissão a tempo.');
  }
  throw failure(502, 'IPTV_UPSTREAM_UNREACHABLE', 'O relay não conseguiu abrir a conexão com o servidor IPTV.');
}

async function authorizeProvider(target, fetchImpl, assertTarget) {
  const media = new URL(target);
  const match = /\/(?:live|movie|series)\/([^/]+)\/([^/]+)\/[^/]+$/.exec(media.pathname);
  if (!match) return 0;
  const basePath = media.pathname.slice(0, match.index).replace(/\/$/, '');
  const accountUrl = new URL(`${basePath}/player_api.php`, media.origin);
  accountUrl.searchParams.set('username', decodeURIComponent(match[1]));
  accountUrl.searchParams.set('password', decodeURIComponent(match[2]));
  await assertTarget(accountUrl);
  const result = await fetchWithTimeout(fetchImpl, accountUrl, {
    method: 'GET',
    redirect: 'manual',
    headers: {
      accept: 'application/json',
      'accept-encoding': 'identity',
      'user-agent': PLAYER_ATTEMPTS[0].userAgent,
    },
  }, 8_000);
  const status = result.status;
  await result.body?.cancel().catch(() => {});
  return status;
}

async function streamHlsFallback(request, response, target, fetchImpl, assertTarget) {
  if (request.method !== 'GET') return { started: false, status: 0, segments: 0 };
  const hlsTarget = new URL(target);
  if (!/\.ts$/i.test(hlsTarget.pathname)) return { started: false, status: 0, segments: 0 };
  hlsTarget.pathname = hlsTarget.pathname.replace(/\.ts$/i, '.m3u8');

  let playlistUrl = hlsTarget.href;
  let playlist;
  for (let depth = 0; depth < 3; depth++) {
    playlist = await fetchPlaylist(playlistUrl, fetchImpl, assertTarget);
    if (!playlist.ok) return { started: false, status: playlist.status, segments: 0 };
    const parsed = parsePlaylist(playlist.text, playlist.url);
    if (!parsed.master) break;
    if (!parsed.resources.length) return { started: false, status: 502, segments: 0 };
    playlistUrl = parsed.resources[0];
  }

  const seen = new Set();
  let started = false;
  let segmentCount = 0;
  let firstPlaylist = true;
  while (!response.destroyed && !response.writableEnded) {
    if (!playlist?.ok) playlist = await fetchPlaylist(playlistUrl, fetchImpl, assertTarget);
    if (!playlist.ok) {
      if (!started) return { started: false, status: playlist.status, segments: 0 };
      throw new Error(`HLS playlist failed with ${playlist.status}`);
    }
    const parsed = parsePlaylist(playlist.text, playlist.url);
    if (parsed.master) {
      if (!parsed.resources.length) throw new Error('HLS master playlist is empty');
      playlistUrl = parsed.resources[0];
      playlist = null;
      continue;
    }
    const pending = parsed.resources.filter((resource) => !seen.has(resource));
    const selected = firstPlaylist && !parsed.endList ? pending.slice(-2) : pending;
    firstPlaylist = false;
    for (const resource of selected) {
      const opened = await openProvider(
        resource,
        request,
        response,
        { ...PLAYER_ATTEMPTS[0], ignoreClientRange: true },
        fetchImpl,
        assertTarget,
      );
      if (!opened.upstream.ok || !opened.first) {
        const status = opened.upstream.status;
        await opened.reader?.cancel().catch(() => {});
        opened.cleanup();
        if (!started) return { started: false, status, segments: 0 };
        throw new Error(`HLS segment failed with ${status}`);
      }
      if (!started) {
        response.setHeader('content-type', 'video/mp2t');
        response.setHeader('cache-control', 'private, no-store');
        response.writeHead(200);
        started = true;
      }
      try {
        if (!response.write(opened.first)) await once(response, 'drain');
        while (true) {
          const chunk = await opened.reader.read();
          if (chunk.done) break;
          if (!response.write(chunk.value)) await once(response, 'drain');
        }
      } finally {
        opened.cleanup();
      }
      seen.add(resource);
      segmentCount++;
      while (seen.size > 500) seen.delete(seen.values().next().value);
    }
    if (parsed.endList) {
      if (started) response.end();
      return { started, status: started ? 200 : 502, segments: segmentCount };
    }
    await waitForPlaylist(Math.max(800, Math.min(4_000, parsed.targetDuration * 500)), response);
    playlist = null;
  }
  return { started, status: started ? 200 : 499, segments: segmentCount };
}

async function fetchPlaylist(initialTarget, fetchImpl, assertTarget) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OPEN_TIMEOUT_MS);
  try {
    let current = new URL(initialTarget);
    for (let redirects = 0; redirects <= REDIRECT_LIMIT; redirects++) {
      await assertTarget(current);
      const response = await fetchImpl(current, {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          accept: 'application/vnd.apple.mpegurl, application/x-mpegURL, */*',
          'accept-encoding': 'identity',
          'user-agent': PLAYER_ATTEMPTS[0].userAgent,
        },
      });
      if (REDIRECT_STATUSES.has(response.status)) {
        const location = response.headers.get('location');
        await response.body?.cancel().catch(() => {});
        if (!location || redirects === REDIRECT_LIMIT) throw new Error('HLS redirect rejected');
        current = new URL(location, current);
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        return { ok: false, status: response.status, url: current.href, text: '' };
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength > PLAYLIST_LIMIT) throw new Error('HLS playlist too large');
      const text = new TextDecoder().decode(bytes);
      if (!text.trimStart().startsWith('#EXTM3U')) throw new Error('HLS playlist invalid');
      return { ok: true, status: response.status, url: current.href, text };
    }
    throw new Error('HLS redirects exceeded');
  } finally {
    clearTimeout(timer);
  }
}

function parsePlaylist(text, baseUrl) {
  const lines = text.split(/\r?\n/);
  const resources = [];
  let targetDuration = 4;
  let master = false;
  let endList = false;
  for (const line of lines) {
    const value = line.trim();
    if (!value) continue;
    if (value.startsWith('#EXT-X-STREAM-INF')) master = true;
    else if (value.startsWith('#EXT-X-ENDLIST')) endList = true;
    else if (value.startsWith('#EXT-X-TARGETDURATION:')) {
      targetDuration = Number.parseFloat(value.slice(value.indexOf(':') + 1)) || targetDuration;
    } else if (!value.startsWith('#')) resources.push(new URL(value, baseUrl).href);
  }
  return { resources, targetDuration, master, endList };
}

function waitForPlaylist(milliseconds, response) {
  return new Promise((resolve) => {
    const timer = setTimeout(done, milliseconds);
    function done() {
      clearTimeout(timer);
      response.off('close', done);
      resolve();
    }
    response.once('close', done);
  });
}

async function openProvider(initialTarget, request, response, attempt, fetchImpl, assertTarget) {
  const controller = new AbortController();
  const close = () => controller.abort();
  request.once('aborted', close);
  response.once('close', close);
  const timer = setTimeout(() => controller.abort(), OPEN_TIMEOUT_MS);
  const cleanup = () => {
    clearTimeout(timer);
    request.off('aborted', close);
    response.off('close', close);
  };
  try {
    let current = new URL(initialTarget);
    for (let redirectCount = 0; redirectCount <= REDIRECT_LIMIT; redirectCount++) {
      await assertTarget(current);
      const headers = {
        accept: '*/*',
        'accept-encoding': 'identity',
        'user-agent': attempt.userAgent,
      };
      if (!attempt.ignoreClientRange && request.headers.range) headers.range = String(request.headers.range);
      else if (attempt.forceRange) headers.range = 'bytes=0-';
      if (request.headers['if-range']) headers['if-range'] = String(request.headers['if-range']);
      const upstream = await fetchImpl(current, {
        method: request.method,
        headers,
        redirect: 'manual',
        signal: controller.signal,
      });
      if (REDIRECT_STATUSES.has(upstream.status)) {
        const location = upstream.headers.get('location');
        await upstream.body?.cancel().catch(() => {});
        if (!location || redirectCount === REDIRECT_LIMIT) throw new Error('provider redirect rejected');
        current = new URL(location, current);
        continue;
      }
      if (request.method === 'HEAD' || !upstream.ok || upstream.status === 416) {
        clearTimeout(timer);
        return { upstream, reader: null, first: null, cleanup };
      }
      const reader = upstream.body?.getReader();
      if (!reader) throw new Error('provider body missing');
      const first = await reader.read();
      if (first.done || !first.value?.byteLength) {
        await reader.cancel().catch(() => {});
        throw new Error('provider body empty');
      }
      clearTimeout(timer);
      return { upstream, reader, first: first.value, cleanup };
    }
    throw new Error('provider redirects exceeded');
  } catch (reason) {
    cleanup();
    throw reason;
  }
}

async function fetchWithTimeout(fetchImpl, url, init, timeoutMs = OPEN_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetchImpl(url, { ...init, signal: controller.signal }); }
  finally { clearTimeout(timer); }
}

async function assertPublicHttpUrl(input) {
  const url = input instanceof URL ? input : new URL(input);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || !url.hostname) {
    throw failure(502, 'IPTV_TARGET_REJECTED', 'O destino retornado para a mídia não é permitido.');
  }
  if (url.hostname.toLowerCase() === 'localhost') throw failure(502, 'IPTV_TARGET_REJECTED', 'O destino retornado para a mídia não é permitido.');
  const addresses = net.isIP(url.hostname)
    ? [{ address: url.hostname }]
    : await dns.lookup(url.hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) {
    throw failure(502, 'IPTV_TARGET_REJECTED', 'O destino retornado para a mídia não é permitido.');
  }
}

function isPrivateAddress(value) {
  if (net.isIPv4(value)) {
    const [a, b] = value.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
      || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  if (net.isIPv6(value)) {
    const normalized = value.toLowerCase();
    return normalized === '::' || normalized === '::1' || normalized.startsWith('fc')
      || normalized.startsWith('fd') || /^fe[89ab]/.test(normalized)
      || normalized.startsWith('::ffff:127.') || normalized.startsWith('::ffff:10.')
      || normalized.startsWith('::ffff:192.168.');
  }
  return true;
}

function copyMediaHeaders(upstream, response) {
  for (const name of EXPOSED_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) response.setHeader(name, value);
  }
  response.setHeader('cache-control', 'private, no-store');
}

function pruneCache(cache) {
  const now = Date.now();
  for (const [key, value] of cache) if (value.expiresAt <= now) cache.delete(key);
}

function setSecurityHeaders(response) {
  response.setHeader('cache-control', 'private, no-store');
  response.setHeader('content-security-policy', "default-src 'none'");
  response.setHeader('referrer-policy', 'no-referrer');
  response.setHeader('x-content-type-options', 'nosniff');
}

function setCorsHeaders(response, origin) {
  response.setHeader('access-control-allow-origin', origin);
  response.setHeader('access-control-allow-methods', 'GET, HEAD, OPTIONS');
  response.setHeader('access-control-allow-headers', 'Range, If-Range, Accept, X-Evo-Session, X-Evo-Profile, X-Evo-Platform, X-Evo-Version, X-Evo-Version-Code');
  response.setHeader('access-control-expose-headers', 'Content-Length, Content-Range, Accept-Ranges, Content-Type');
  response.setHeader('vary', 'Origin');
}

function sendError(response, status, code, message) {
  return sendJson(response, status, { code, error: message });
}

function sendJson(response, status, value) {
  const body = Buffer.from(JSON.stringify(value));
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.setHeader('content-length', String(body.length));
  response.writeHead(status);
  response.end(body);
}

function failure(status, code, message) {
  return Object.assign(new Error(message), { status, code, public: true });
}

function publicFailure(reason) {
  if (reason?.public === true) return reason;
  console.error('relay_failure', reason instanceof Error ? reason.name : 'UnknownError');
  return failure(502, 'MEDIA_RELAY_FAILED', 'O relay não conseguiu abrir a mídia.');
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT || 10000);
  createRelayServer().listen(port, '0.0.0.0', () => console.log(`evotv_media_relay_ready port=${port}`));
}
