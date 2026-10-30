const CATALOG_BACKEND_URL = 'https://multimideas-evo-backend-app.onrender.com';
let catalogPromise;
const segmentPromises = new Map();

async function catalogFetch(path, idToken) {
  if (!idToken) throw new Error('Entre no app para carregar o catalogo.');
  const response = await fetch(`${CATALOG_BACKEND_URL}${path}`, {
    headers: { authorization: `Bearer ${idToken}`, accept: 'application/json' },
    credentials: 'omit', cache: 'no-store',
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(String(data?.error || `Catalogo de series indisponivel (${response.status}).`));
  return data;
}

export function currentSeriesCatalog(idToken) {
  if (!catalogPromise) {
    catalogPromise = catalogFetch('/api/catalog/series', idToken)
      .then(catalog => {
        if (!Array.isArray(catalog.series) || !Array.isArray(catalog.patterns) || !Array.isArray(catalog.segments)) {
          throw new Error('O indice de series esta incompleto.');
        }
        return catalog;
      }).catch(error => { catalogPromise = null; throw error; });
  }
  return catalogPromise;
}

export async function episodesForSeries(catalog, series, idToken) {
  const ids = Array.isArray(series?.segmentIds) ? series.segmentIds : [];
  const chunks = await Promise.all(ids.map((id) => {
    const segmentNumber = Number(id);
    const segment = catalog.segments[segmentNumber - 1];
    const expectedFile = `series-offline/segment-${String(segmentNumber).padStart(4, '0')}.json`;
    if (!Number.isInteger(segmentNumber) || segmentNumber < 1 || !segment || segment.file !== expectedFile) {
      throw new Error('Segmento de episodios invalido.');
    }
    if (!segmentPromises.has(id)) {
      const request = catalogFetch(`/api/catalog/series/segments/${segmentNumber}`, idToken).then(value => {
        if (!Array.isArray(value.episodes)) throw new Error('O segmento nao contem episodios.');
        return value.episodes;
      }).catch(error => { segmentPromises.delete(id); throw error; });
      segmentPromises.set(id, request);
    }
    return segmentPromises.get(id);
  }));
  const seriesId = String(series.series_id);
  return chunks.flat().filter(episode => String(episode.series_id) === seriesId);
}

export function clearSeriesCatalogCache() {
  catalogPromise = null;
  segmentPromises.clear();
}
