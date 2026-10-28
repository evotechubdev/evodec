import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/index.js';

const env = {
  AUTH_BACKEND_ORIGIN: 'https://backend.example',
  ALLOWED_APP_ORIGINS: 'https://app.example,http://localhost:4173',
};

test('transmite a mídia pelo backend sem revelar nem acessar o provedor no Worker', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const calls = [];
  globalThis.fetch = async (input, init) => {
    calls.push({ target: String(input), init });
    assert.equal(String(input), 'https://backend.example/stream/ticket/42.mp4');
    assert.equal(new Headers(init.headers).get('range'), 'bytes=0-99');
    return new Response('video-bytes', {
      status: 206,
      headers: { 'content-type': 'video/mp4', 'content-range': 'bytes 0-10/100' },
    });
  };

  const response = await worker.fetch(new Request('https://proxy.example/stream/ticket/42.mp4', {
    headers: { origin: 'https://app.example', range: 'bytes=0-99' },
  }), env);
  assert.equal(response.status, 206);
  assert.equal(response.headers.get('access-control-allow-origin'), 'https://app.example');
  assert.equal(response.headers.get('content-type'), 'video/mp4');
  assert.equal(await response.text(), 'video-bytes');
  assert.equal(calls.length, 1);
});

test('mantém os segmentos HLS sob a origem HTTPS do Worker', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => new Response([
    '#EXTM3U',
    '#EXT-X-KEY:METHOD=AES-128,URI="https://backend.example/segment/ticket/key"',
    'https://backend.example/segment/ticket/part',
  ].join('\n'), { headers: { 'content-type': 'application/vnd.apple.mpegurl' } });
  const response = await worker.fetch(new Request('https://proxy.example/stream/ticket/7.m3u8', {
    headers: { origin: 'https://app.example' },
  }), env);
  const manifest = await response.text();
  assert.match(manifest, /https:\/\/proxy\.example\/segment\/ticket\/key/);
  assert.match(manifest, /https:\/\/proxy\.example\/segment\/ticket\/part/);
  assert.doesNotMatch(manifest, /backend\.example/);
});

test('aceita navegação do player pelo Referer quando Origin não existe', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => new Response('media', { headers: { 'content-type': 'video/mp2t' } });
  const response = await worker.fetch(new Request('https://proxy.example/segment/ticket/sealed-target', {
    headers: { referer: 'https://app.example/pwa/' },
  }), env);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'media');
});

test('recusa uso fora do PWA e rotas arbitrárias', async () => {
  const noOrigin = await worker.fetch(new Request('https://proxy.example/stream/ticket/42.mp4'), env);
  assert.equal(noOrigin.status, 403);
  const arbitrary = await worker.fetch(new Request('https://proxy.example/arbitrary-target', {
    headers: { origin: 'https://app.example' },
  }), env);
  assert.equal(arbitrary.status, 404);
});

test('responde ao preflight apenas para uma origem autorizada', async () => {
  const response = await worker.fetch(new Request('https://proxy.example/stream/ticket/42.mp4', {
    method: 'OPTIONS',
    headers: { origin: 'https://app.example' },
  }), env);
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('access-control-allow-origin'), 'https://app.example');
});

test('health confirma que o provedor está oculto pelo backend', async () => {
  const response = await worker.fetch(new Request('https://proxy.example/health'), env);
  assert.deepEqual(await response.json(), {
    ok: true,
    service: 'evotv-cloudflare-media-proxy',
    configured: true,
    providerHiddenByBackend: true,
  });
});
