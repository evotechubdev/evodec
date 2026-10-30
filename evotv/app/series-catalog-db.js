let catalogPromise;
const segmentPromises = new Map();

export function currentSeriesCatalog() {
  if (!catalogPromise) {
    catalogPromise = fetch('./data/series-offline.json')
      .then(async response => {
        if (!response.ok) throw new Error(`Catálogo de séries indisponível (${response.status}).`);
        const catalog = await response.json();
        if (!Array.isArray(catalog.series) || !Array.isArray(catalog.patterns) || !Array.isArray(catalog.segments)) {
          throw new Error('O índice de séries está incompleto.');
        }
        return catalog;
      }).catch(error => { catalogPromise = null; throw error; });
  }
  return catalogPromise;
}

export async function episodesForSeries(catalog, series) {
  const ids = Array.isArray(series?.segmentIds) ? series.segmentIds : [];
  const chunks = await Promise.all(ids.map((id) => {
    const segment = catalog.segments[Number(id) - 1];
    if (!segment || Number(segment.segment) !== Number(id)) throw new Error('Segmento de episódios inválido.');
    if (!segmentPromises.has(id)) {
      const request = fetch(`./data/${segment.file}`).then(async response => {
        if (!response.ok) throw new Error(`Episódios indisponíveis (${response.status}).`);
        const value = await response.json();
        if (!Array.isArray(value.episodes)) throw new Error('O segmento não contém episódios.');
        return value.episodes;
      }).catch(error => { segmentPromises.delete(id); throw error; });
      segmentPromises.set(id, request);
    }
    return segmentPromises.get(id);
  }));
  const seriesId = String(series.series_id);
  return chunks.flat().filter(episode => String(episode.series_id) === seriesId);
}
