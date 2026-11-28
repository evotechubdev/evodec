import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/index.js';

const env = {
  ALLOWED_PANEL_ORIGINS: 'https://evotechubdev.github.io,http://127.0.0.1:4173',
};
const origin = 'https://evotechubdev.github.io';
const bookId = '6a8752ac7c23cb02b40f062b';

function panelRequest(path, init = {}) {
  return new Request(`https://relay.example${path}`, {
    ...init,
    headers: { origin, ...(init.headers || {}) },
  });
}

function metadataHtml() {
  const data = {
    book_id: bookId,
    book_title: 'Série de Teste',
    book_pic: 'https://v-img.crazymaplestudios.com/cover/test.webp',
    special_desc: 'Sinopse pública.',
    update_status: 1,
    is_dub: 1,
    online_base: [
      { serial_number: 1, chapter_type: 0 },
      { serial_number: 2, chapter_type: 0 },
      { serial_number: 0, chapter_type: 2 },
    ],
  };
  return `<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { data } } })}</script></html>`;
}

test('health identifica o relay independente', async () => {
  const response = await worker.fetch(panelRequest('/health'), env);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    service: 'evotv-dramafren-relay',
    mode: 'anonymous-no-origin',
    maxSeriesPerImport: 1,
  });
});

test('recusa origens externas e metodos de escrita', async () => {
  const forbidden = await worker.fetch(new Request(`https://relay.example/v1/metadata?id=${bookId}`, {
    headers: { origin: 'https://attacker.example' },
  }), env);
  assert.equal(forbidden.status, 403);
  const method = await worker.fetch(panelRequest(`/v1/metadata?id=${bookId}`, { method: 'POST' }), env);
  assert.equal(method.status, 405);
});

test('responde ao preflight somente para o painel', async () => {
  const response = await worker.fetch(panelRequest('/v1/metadata', { method: 'OPTIONS' }), env);
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('access-control-allow-origin'), origin);
});

test('normaliza metadados oficiais e remove trailer', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (target, init) => {
    assert.equal(String(target), `https://www.reelshort.com/pt/movie/${bookId}`);
    assert.equal(new Headers(init.headers).has('origin'), false);
    return new Response(metadataHtml(), { status: 200 });
  };
  const response = await worker.fetch(panelRequest(`/v1/metadata?id=${bookId}`), env);
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.id, 'serie-de-teste');
  assert.equal(data.status, 'Concluída');
  assert.deepEqual(data.chapters, [{ number: 1 }, { number: 2 }]);
  assert.deepEqual(data.audioLanguages, ['pt-BR']);
});

test('consulta o DramaFren sem encaminhar Origin e escolhe a maior qualidade', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (target, init) => {
    const url = new URL(String(target));
    assert.equal(url.hostname, 'cdn-reelshortv2.dramafren.org');
    assert.equal(url.searchParams.get('ep'), '7');
    assert.equal(new Headers(init.headers).has('origin'), false);
    return Response.json({
      episode: 7,
      videoUrl: 'https://v-mps.crazymaplestudios.com/video/master.m3u8',
      qualities: [
        { quality: '480p', url: 'https://v-mps.crazymaplestudios.com/video/480.m3u8' },
        { quality: '1080p', url: 'https://v-mps.crazymaplestudios.com/video/1080.m3u8' },
      ],
    });
  };
  const response = await worker.fetch(panelRequest(`/v1/playback?id=${bookId}&episode=7`), env);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    episode: 7,
    playlistUrl: 'https://v-mps.crazymaplestudios.com/video/1080.m3u8',
    sourceProvider: 'dramafren',
  });
});

test('nao funciona como proxy para destinos arbitrarios', async () => {
  const response = await worker.fetch(panelRequest(`/https://attacker.example/?id=${bookId}`), env);
  assert.equal(response.status, 404);
});
