const CATALOG_BACKEND_URL = 'https://multimideas-evo-backend-app.onrender.com';
const episodeRequests = new Map();

export async function episodesForSeries(_catalog, series, idToken, session, adult = false) {
  if (!idToken) throw new Error('Entre no app para carregar os episodios.');
  const seriesId = String(series?.series_id || '');
  if (!/^\d{1,20}$/.test(seriesId)) throw new Error('Serie IPTV invalida.');
  const cacheKey = `${seriesId}:${adult ? 'adult' : 'regular'}`;
  if (!episodeRequests.has(cacheKey)) {
    const query = new URLSearchParams({ adult: adult ? '1' : '0' });
    const request = fetch(`${CATALOG_BACKEND_URL}/api/catalog/series/${encodeURIComponent(seriesId)}/episodes?${query}`, {
      headers: {
        authorization: `Bearer ${idToken}`, accept: 'application/json', 'x-evo-platform': 'web',
        'x-evo-session': session?.sessionToken || '', 'x-evo-profile': String(session?.profile || ''),
      },
      credentials: 'omit', cache: 'no-store',
    }).then(async response => {
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(String(data?.error || `Episodios indisponiveis (${response.status}).`));
      if (!Array.isArray(data.episodes)) throw new Error('Resposta de episodios IPTV invalida.');
      return data.episodes;
    }).catch(error => { episodeRequests.delete(cacheKey); throw error; });
    episodeRequests.set(cacheKey, request);
  }
  return episodeRequests.get(cacheKey);
}

export function clearSeriesCatalogCache() {
  episodeRequests.clear();
}
