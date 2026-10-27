import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extraCatalog,
  extraContent,
  EXTRA_CATEGORY_ID,
  EXTRA_PLATFORM_CATEGORY_ID,
  EXTRA_SERIES_ID,
  EXTRA_SERIES_IDS,
} from '../src/extra-content.js';

test('extra catalog exposes submenu, platform, imported series and every episode without upstream URLs', () => {
  const catalog = extraCatalog();
  assert.deepEqual(catalog.submenus, [{ id: EXTRA_CATEGORY_ID, name: 'Mininovelas Verticais' }]);
  assert.deepEqual(catalog.categories, [{ id: EXTRA_PLATFORM_CATEGORY_ID, name: 'ReelShort', submenuId: EXTRA_CATEGORY_ID }]);
  assert.equal(catalog.series.length, EXTRA_SERIES_IDS.length);
  assert.deepEqual(catalog.series.map(series => series.id), EXTRA_SERIES_IDS);

  const arena = catalog.series.find(series => series.id === EXTRA_SERIES_ID);
  assert.equal(arena.name, 'Deus da Arena');
  assert.equal(arena.categoryId, EXTRA_PLATFORM_CATEGORY_ID);
  assert.equal(arena.totalEpisodes, 57);
  assert.equal(arena.episodes.length, 57);
  assert.equal(arena.episodes[0].name, 'Episódio 1');
  assert.equal(arena.episodes[56].number, 57);

  const triplets = catalog.series.find(series => series.id === 'o-arrependimento-final-dos-trigemeos');
  assert.equal(triplets.name, 'O Arrependimento Final dos Trigêmeos');
  assert.equal(triplets.categoryId, EXTRA_PLATFORM_CATEGORY_ID);
  assert.equal(triplets.totalEpisodes, 51);
  assert.equal(triplets.episodes.length, 51);
  assert.deepEqual(triplets.audioLanguages, ['pt-BR']);
  assert.equal(triplets.defaultAudioLanguage, 'pt-BR');
  assert.equal(triplets.dubbed, true);
  assert.equal(triplets.episodes[0].duration, '4:17');
  assert.equal(triplets.episodes[50].number, 51);

  const billionaire = catalog.series.find(series => series.id === 'a-vida-secreta-do-meu-marido-bilionario');
  assert.equal(billionaire.name, 'A vida secreta do meu marido bilionário');
  assert.equal(billionaire.totalEpisodes, 68);
  assert.equal(billionaire.episodes.length, 68);
  assert.equal(billionaire.episodes[0].number, 1);
  assert.equal(billionaire.episodes[67].number, 68);
  assert.deepEqual(billionaire.audioLanguages, ['pt-BR']);
  assert.equal(billionaire.defaultAudioLanguage, 'pt-BR');

  assert.equal(catalog.items.length, catalog.series.reduce((total, series) => total + series.episodes.length, 0));
  assert.ok(catalog.series.every(series => /^https:\/\/v-img\.crazymaplestudios\.com\//.test(series.imageUrl)));
  assert.equal(JSON.stringify(catalog).includes('v-mps.crazymaplestudios.com'), false);
  assert.equal(JSON.stringify(catalog).includes('playlistUrl'), false);
});

test('all extra episode sources resolve only inside the backend', () => {
  for (const [seriesId, total] of [['deus-da-arena', 57], ['o-arrependimento-final-dos-trigemeos', 51]]) {
    for (let number = 1; number <= total; number += 1) {
      const id = `${seriesId}-episode-${String(number).padStart(2, '0')}`;
      const item = extraContent(id);
      assert.ok(item, id);
      assert.equal(item.number, number);
      assert.match(item.playlistUrl, /^https:\/\/v-mps\.crazymaplestudios\.com\//);
    }
    assert.equal(extraContent(seriesId), null);
  }
  assert.equal(extraContent('missing'), null);
});
