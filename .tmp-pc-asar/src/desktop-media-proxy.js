// Shared media behavior with backend/src/media-proxy.js. No provider configuration is stored here.
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');

// Keep the streaming implementation shared with the backend while using Node's
// local HTTP server, without bundling a web framework in the desktop app.
function responseHelpers(res) {
  if (res.set) return;
  res.set = (name, value) => {
    for (const [key, entry] of typeof name === 'object' ? Object.entries(name) : [[name, value]]) res.setHeader(key, entry);
    return res;
  };
  res.type = (value) => res.set('content-type', value);
  res.status = (value) => { res.statusCode = value; return res; };
  res.send = (body) => { res.setHeader('content-length', Buffer.byteLength(body)); res.end(body); return res; };
  res.json = (value) => res.type('application/json; charset=utf-8').send(JSON.stringify(value));
}

class MediaProxyError extends Error {
  constructor(code, message, status = 502) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function mediaHeaders(res) {
  responseHelpers(res);
  res.set({
    'access-control-allow-origin': '*',
    'access-control-expose-headers': 'Content-Length, Content-Range, Accept-Ranges, Content-Type',
    'cache-control': 'private, no-store',
  });
}

function rewriteManifest(manifest, baseUrl, resourceUrl) {
  if (!manifest.trimStart().startsWith('#EXTM3U')) {
    throw new MediaProxyError('TV_NOT_MEDIA', 'O provedor não entregou uma playlist de vídeo.');
  }
  return manifest.split(/\r?\n/).map((line) => {
    const trimmed = line.trim();
    if (!trimmed) return '';
    if (trimmed.startsWith('#')) {
      return line.replace(/URI="([^"]+)"/g, (_match, uri) => `URI="${resourceUrl(new URL(uri, baseUrl).href)}"`);
    }
    return resourceUrl(new URL(trimmed, baseUrl).href);
  }).join('\n');
}

function contentType(upstream, target, originalTarget) {
  const type = (upstream.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (type && !['application/octet-stream', 'binary/octet-stream', 'application/force-download'].includes(type)) return type;
  const types = { mp4: 'video/mp4', m4v: 'video/mp4', mkv: 'video/x-matroska', webm: 'video/webm',
    ts: 'video/mp2t', m4s: 'video/iso.segment', m3u8: 'application/vnd.apple.mpegurl',
    aac: 'audio/aac', mp3: 'audio/mpeg', vtt: 'text/vtt' };
  for (const candidate of [target, originalTarget]) {
    const extension = new URL(candidate).pathname.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
    if (types[extension]) return types[extension];
  }
  return type || 'application/octet-stream';
}

function createMediaProxy({ secureFetch, publicUrl, seal, tokenTtl, registerStream = () => () => {}, userAgent = 'EvoPlayerBackend/1.0' }) {
  return async function proxy(req, res, target, streamTicket = '') {
    mediaHeaders(res);
    const controller = new AbortController();
    const unregister = streamTicket ? registerStream(streamTicket, controller) : () => {};
    const disconnect = () => { if (!res.writableFinished) controller.abort(); };
    res.once('close', disconnect);
    try {
      const headers = { 'user-agent': userAgent };
      // Node fetch appends Accept-Encoding: identity for Range automatically.
      // Supplying it here too produces "identity, identity" on the wire.
      if (req.headers.range) headers.range = req.headers.range;
      else headers['accept-encoding'] = 'identity';
      if (req.headers['if-range']) headers['if-range'] = req.headers['if-range'];
      const upstream = await secureFetch(target, { headers, signal: controller.signal }, 0, Boolean(streamTicket));
      // Manual redirect handling returns the final Response, whose URL is the correct
      // base for relative playlist, key, init-segment and media-segment paths.
      const finalUrl = upstream.url || target;
      if (!upstream.ok) {
        const range = upstream.headers.get('content-range');
        if (range) res.set('content-range', range);
        await upstream.body?.cancel();
        if (upstream.status === 416) return res.status(416).end();
        throw new MediaProxyError('TV_UPSTREAM_FAILED', `O provedor recusou a mídia (HTTP ${upstream.status}).`, 502);
      }
      const type = contentType(upstream, finalUrl, target);
      if (/mpegurl/i.test(type) || /\.m3u8$/i.test(new URL(finalUrl).pathname)) {
        const manifest = await upstream.text();
        const resourceUrl = (absolute) => `${publicUrl}/segment/${streamTicket}/${seal({ type: 'target', target: absolute }, tokenTtl)}`;
        const rewritten = rewriteManifest(manifest, finalUrl, resourceUrl);
        return res.type('application/vnd.apple.mpegurl').send(rewritten);
      }
      if (streamTicket && type !== 'text/vtt' && /^(text\/|application\/(json|xml|xhtml))/i.test(type)) {
        await upstream.body?.cancel();
        throw new MediaProxyError('TV_NOT_MEDIA', 'O provedor devolveu uma página de erro no lugar do vídeo.');
      }
      res.type(type).status(upstream.status);
      for (const name of ['content-range', 'accept-ranges', 'last-modified', 'etag']) {
        const value = upstream.headers.get(name);
        if (value) res.set(name, value);
      }
      // fetch transparently decompresses responses; a compressed Content-Length
      // must never be forwarded with the decompressed body.
      if (!upstream.headers.get('content-encoding')) {
        const length = upstream.headers.get('content-length');
        if (length) res.set('content-length', length);
      }
      if (req.method === 'HEAD') {
        await upstream.body?.cancel();
        return res.end();
      }
      if (!upstream.body) return res.end();
      await pipeline(Readable.fromWeb(upstream.body), res, { signal: controller.signal });
    } finally {
      unregister();
      res.off('close', disconnect);
    }
  };
}

function mediaError(res, error) {
  if (res.destroyed) return;
  if (res.headersSent) return res.destroy();
  mediaHeaders(res);
  const known = error instanceof MediaProxyError;
  res.status(known ? error.status : 502).json({
    code: known ? error.code : 'TV_PROXY_FAILED',
    error: known ? error.message : 'Não foi possível receber a mídia do provedor. Tente novamente.',
  });
}

module.exports = { createMediaProxy, mediaError };
