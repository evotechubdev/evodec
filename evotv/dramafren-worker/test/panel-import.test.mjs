import test from 'node:test';
import assert from 'node:assert/strict';
import { importOneSeriesViaRelay, relayHealth } from '../../adm/dramafren-edge-import.js';

const bookId = '6a8752ac7c23cb02b40f062b';
const link = `https://reelshort.dramafren.org/index.php?page=detail&id=${bookId}&lang=pt`;

test('painel monta a serie completa antes de devolver para sincronizacao', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const calls = [];
  globalThis.fetch = async input => {
    const url = new URL(String(input));
    calls.push(url.pathname + url.search);
    if (url.pathname === '/v1/metadata') {
      return Response.json({
        id: 'serie-de-teste',
        bookId,
        sourceUrl: `https://www.reelshort.com/movie/serie-de-teste-${bookId}`,
        name: 'Série de Teste',
        imageUrl: 'https://v-img.crazymaplestudios.com/cover/test.webp',
        synopsis: 'Sinopse',
        status: 'Concluída',
        dubbed: true,
        audioLanguages: ['pt-BR'],
        defaultAudioLanguage: 'pt-BR',
        chapters: [{ number: 1 }, { number: 2 }],
      });
    }
    const episode = Number(url.searchParams.get('episode'));
    return Response.json({
      episode,
      playlistUrl: `https://v-mps.crazymaplestudios.com/video/episode-${episode}.m3u8`,
      sourceProvider: 'dramafren',
    });
  };

  const progress = [];
  const series = await importOneSeriesViaRelay({
    link,
    streamingName: 'REELSHORT',
    onProgress: value => progress.push(value),
  });
  assert.equal(series.name, 'Série de Teste');
  assert.equal(series.episodes.length, 2);
  assert.deepEqual(series.importNotes.dramafrenEpisodes, [1, 2]);
  assert.equal(series.episodes[1].id, 'serie-de-teste-episode-02');
  assert.equal(calls.filter(value => value.startsWith('/v1/playback')).length, 2);
  assert.equal(progress.at(-1).availableEpisodes, 2);
});

test('painel reconhece health e impede serie ja cadastrada', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async input => {
    const url = new URL(String(input));
    if (url.pathname === '/health') return Response.json({ ok: true, service: 'evotv-dramafren-relay' });
    return Response.json({
      id: 'serie-existente', bookId, name: 'Série Existente',
      sourceUrl: `https://www.reelshort.com/movie/serie-existente-${bookId}`,
      imageUrl: 'https://v-img.crazymaplestudios.com/cover/test.webp',
      chapters: [{ number: 1 }],
    });
  };
  assert.equal((await relayHealth()).ok, true);
  await assert.rejects(importOneSeriesViaRelay({
    link,
    streamingName: 'REELSHORT',
    existingIds: [`book:${bookId}`],
  }), /já existe no catálogo/);
});
