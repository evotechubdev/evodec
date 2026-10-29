import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/index.js';

const env = {
  AUTH_BACKEND_ORIGIN: 'https://backend.example',
  ALLOWED_APP_ORIGINS: 'https://app.example,http://localhost:4173',
  MEDIA_TOKEN_KEY: 'test-only-media-token-key-with-at-least-32-characters',
};

test('usa o backend somente para autorizar e transmite a midia direto pelo Worker', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const calls = [];
  globalThis.fetch = async (input, init) => {
    calls.push({ target: String(input), init });
    if (calls.length === 1) {
      assert.equal(String(input), 'https://backend.example/open-stream/ticket/42.mp4');
      assert.equal(init.redirect, 'manual');
      return new Response(null, { status: 302, headers: { location: 'http://provider.example/movie/user/pass/42.mp4' } });
    }
    assert.equal(String(input), 'http://provider.example/movie/user/pass/42.mp4');
    assert.equal(new Headers(init.headers).get('range'), 'bytes=0-99');
    return new Response('video-bytes', {
      status: 206,
      headers: { 'content-type': 'video/mp4', 'content-range': 'bytes 0-10/100' },
    });
  };

  const response = await worker.fetch(new Request('https://proxy.example/open-stream/ticket/42.mp4', {
    headers: { origin: 'https://app.example', range: 'bytes=0-99' },
  }), env);
  assert.equal(response.status, 206);
  assert.equal(response.headers.get('access-control-allow-origin'), 'https://app.example');
  assert.equal(await response.text(), 'video-bytes');
  assert.equal(calls.length, 2);
});

test('usa retransmissao HTTPS do backend quando o provedor bloqueia a Cloudflare', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const calls = [];
  globalThis.fetch = async (input, init) => {
    calls.push(String(input));
    if (calls.length === 1) {
      return new Response(null, { status: 302, headers: { location: 'http://provider.example/live/u/p/7.ts' } });
    }
    if (calls.length === 2) {
      return new Response('blocked', { status: 403, headers: { 'content-type': 'text/plain' } });
    }
    if (String(input).startsWith('https://provider.example')) {
      return new Response('blocked', { status: 403, headers: { 'content-type': 'text/plain' } });
    }
    assert.equal(String(input), 'https://backend.example/stream/ticket/7.ts');
    assert.equal(new Headers(init.headers).get('range'), 'bytes=0-');
    return new Response('relayed-video', { headers: { 'content-type': 'video/mp2t' } });
  };

  const response = await worker.fetch(new Request('https://proxy.example/open-stream/ticket/7.ts', {
    headers: { origin: 'https://app.example', range: 'bytes=0-' },
  }), env);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'video/mp2t');
  assert.equal(await response.text(), 'relayed-video');
  assert.equal(calls[0], 'https://backend.example/open-stream/ticket/7.ts');
  assert.equal(calls[1], 'http://provider.example/live/u/p/7.ts');
  assert.equal(calls.at(-1), 'https://backend.example/stream/ticket/7.ts');
  assert.ok(calls.includes('https://provider.example/live/u/p/7.ts'));
  assert.ok(calls.includes('https://provider.example:8443/live/u/p/7.ts'));
});

test('prefere HTTPS do mesmo provedor quando a borda recusa a URL HTTP', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const calls = [];
  globalThis.fetch = async (input) => {
    calls.push(String(input));
    if (calls.length === 1) {
      return new Response(null, { status: 302, headers: { location: 'http://provider.example/live/u/p/9.ts' } });
    }
    if (calls.length === 2) return new Response('blocked', { status: 403 });
    assert.equal(String(input), 'https://provider.example/live/u/p/9.ts');
    return new Response('secure-video', { headers: { 'content-type': 'video/mp2t' } });
  };
  const response = await worker.fetch(new Request('https://proxy.example/open-stream/ticket/9.ts', {
    headers: { origin: 'https://app.example' },
  }), env);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'secure-video');
  assert.equal(calls.length, 3);
});

test('criptografa destinos HLS e mantem playlist e segmentos no HTTPS do Worker', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const calls = [];
  globalThis.fetch = async (input) => {
    calls.push(String(input));
    if (calls.length === 1) {
      return new Response(null, { status: 302, headers: { location: 'http://provider.example/live/u/p/7.m3u8' } });
    }
    if (calls.length === 2) {
      return new Response([
        '#EXTM3U',
        '#EXT-X-KEY:METHOD=AES-128,URI="keys/key.bin"',
        'parts/one.ts',
      ].join('\n'), { headers: { 'content-type': 'application/vnd.apple.mpegurl' } });
    }
    assert.equal(String(input), 'http://provider.example/live/u/p/parts/one.ts');
    return new Response('segment-bytes', { headers: { 'content-type': 'video/mp2t' } });
  };

  const playlistResponse = await worker.fetch(new Request('https://proxy.example/open-stream/ticket/7.m3u8', {
    headers: { origin: 'https://app.example' },
  }), env);
  const manifest = await playlistResponse.text();
  assert.match(manifest, /https:\/\/proxy\.example\/segment\/[A-Za-z0-9_-]+/);
  assert.doesNotMatch(manifest, /provider\.example|\/live\/u\/p/);
  const segmentUrl = manifest.split('\n').find(line => line.startsWith('https://proxy.example/segment/'));
  const segmentResponse = await worker.fetch(new Request(segmentUrl, {
    headers: { origin: 'https://app.example' },
  }), env);
  assert.equal(segmentResponse.status, 200);
  assert.equal(await segmentResponse.text(), 'segment-bytes');
});

test('aceita navegacao do player pelo Referer quando Origin nao existe', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => new Response(null, { status: 401, headers: { 'content-type': 'application/json' } });
  const response = await worker.fetch(new Request('https://proxy.example/open-stream/ticket/7.mp4', {
    headers: { referer: 'https://app.example/pwa/' },
  }), env);
  assert.equal(response.status, 401);
});

test('recusa uso fora do PWA e rotas arbitrarias', async () => {
  const noOrigin = await worker.fetch(new Request('https://proxy.example/open-stream/ticket/42.mp4'), env);
  assert.equal(noOrigin.status, 403);
  const arbitrary = await worker.fetch(new Request('https://proxy.example/arbitrary-target', {
    headers: { origin: 'https://app.example' },
  }), env);
  assert.equal(arbitrary.status, 404);
});

test('responde ao preflight apenas para origem autorizada', async () => {
  const response = await worker.fetch(new Request('https://proxy.example/open-stream/ticket/42.mp4', {
    method: 'OPTIONS', headers: { origin: 'https://app.example' },
  }), env);
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('access-control-allow-origin'), 'https://app.example');
});

test('exige o segredo que protege os segmentos', async () => {
  const response = await worker.fetch(new Request('https://proxy.example/open-stream/ticket/42.mp4', {
    headers: { origin: 'https://app.example' },
  }), { ...env, MEDIA_TOKEN_KEY: '' });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, 'PROXY_NOT_CONFIGURED');
});

test('health confirma rota direta na borda sem expor o provedor', async () => {
  const response = await worker.fetch(new Request('https://proxy.example/health'), env);
  assert.deepEqual(await response.json(), {
    ok: true,
    service: 'evotv-cloudflare-media-proxy',
    configured: true,
    providerHiddenByBackend: true,
    mediaRoute: 'direct-edge',
  });
});
