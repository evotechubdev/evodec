import { APP_BACKEND_URL } from './auth-api.js';

const episodeRequests = new Map();

export async function episodesForSeries(_catalog, series, idToken, session, adult = false) {
  if (!idToken) throw new Error('Entre no app para carregar os episodios.');
  const seriesId = String(series?.series_id || '');
  if (!/^\d{1,20}$/.test(seriesId)) throw new Error('Serie IPTV invalida.');
  const cacheKey = `${seriesId}:${adult ? 'adult' : 'regular'}`;
  if (!episodeRequests.has(cacheKey)) {
    const request = fetch(`${APP_BACKEND_URL}/api/tv`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${idToken}`, accept: 'application/json', 'content-type': 'application/json', 'x-evo-platform': 'web',
        'x-evo-session': session?.sessionToken || '', 'x-evo-profile': String(session?.profile || ''),
      },
      body: JSON.stringify({ action: 'get_series_info', extra: { series_id: seriesId }, adult: adult === true }),
      credentials: 'omit', cache: 'no-store',
    }).then(async response => {
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(String(data?.error || `Episodios indisponiveis (${response.status}).`));
      if (!data?.episodes || typeof data.episodes !== 'object') throw new Error('Resposta de episodios IPTV invalida.');
      return Object.entries(data.episodes).flatMap(([season, items]) => Array.isArray(items)
        ? items.map((episode, index) => ({
          ...episode,
          stream_id: String(episode?.id || episode?.stream_id || ''),
          id: String(episode?.id || episode?.stream_id || ''),
          series_id: seriesId,
          season: String(episode?.season || season || '1'),
          episode_num: String(episode?.episode_num ?? index + 1),
          title: String(episode?.title || episode?.info?.name || `Episodio ${episode?.episode_num ?? index + 1}`),
          container_extension: String(episode?.container_extension || 'mp4'),
          plot: String(episode?.info?.plot || episode?.info?.description || ''),
        })).filter(episode => /^\d{1,20}$/.test(episode.stream_id))
        : []);
    }).catch(error => { episodeRequests.delete(cacheKey); throw error; });
    episodeRequests.set(cacheKey, request);
  }
  return episodeRequests.get(cacheKey);
}

export function clearSeriesCatalogCache() {
  episodeRequests.clear();
}
