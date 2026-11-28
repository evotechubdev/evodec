const DRAMAFREN_ORIGIN = 'https://reelshort.dramafren.org';
const DRAMAFREN_PLAYBACK_ENDPOINTS = [
  'https://cdn-reelshortv2.dramafren.org/index.php',
  'https://cdn-reelshort.dramafren.org/index.php',
];
const PLAYLIST_HOST = 'v-mps.crazymaplestudios.com';
const BOOK_ID = /^[a-f0-9]{24}$/i;
const MAX_EPISODES = 1000;
const UPSTREAM_TIMEOUT_MS = 12_000;

function csv(value) {
  return String(value || '').split(',').map(item => item.trim()).filter(Boolean);
}

function allowedOrigins(env) {
  return new Set(csv(env.ALLOWED_PANEL_ORIGINS));
}

function allowedOrigin(origin, env) {
  if (allowedOrigins(env).has(origin)) return true;
  try {
    const url = new URL(origin);
    return url.protocol === 'http:'
      && !url.username && !url.password
      && ['localhost', '127.0.0.1'].includes(url.hostname);
  } catch {
    return false;
  }
}

function requestOrigin(request) {
  return String(request.headers.get('origin') || '');
}

function corsHeaders(origin, env) {
  const headers = new Headers({
    'access-control-allow-headers': 'Accept, Content-Type',
    'access-control-allow-methods': 'GET, OPTIONS',
    'access-control-max-age': '86400',
    'cache-control': 'private, no-store',
    vary: 'Origin',
  });
  if (allowedOrigin(origin, env)) headers.set('access-control-allow-origin', origin);
  return headers;
}

function jsonResponse(data, status, origin, env) {
  const headers = corsHeaders(origin, env);
  headers.set('content-type', 'application/json; charset=UTF-8');
  headers.set('x-content-type-options', 'nosniff');
  return new Response(JSON.stringify(data), { status, headers });
}

function jsonError(status, code, message, origin, env) {
  return jsonResponse({ code, error: message }, status, origin, env);
}

function validBookId(value) {
  const id = String(value || '').toLowerCase();
  return BOOK_ID.test(id) ? id : '';
}

function validEpisode(value) {
  const episode = Number(value);
  return Number.isInteger(episode) && episode >= 1 && episode <= MAX_EPISODES ? episode : 0;
}

function slugify(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 100);
}

async function upstreamFetch(target, init, request, timeoutMs = UPSTREAM_TIMEOUT_MS) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  request.signal.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // Deliberadamente nao encaminha Origin, cookie ou autorizacao do painel.
    return await fetch(target, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    request.signal.removeEventListener('abort', abort);
  }
}

function nextData(html) {
  const match = String(html || '').match(/<script[^>]*\bid=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!match) throw new Error('reelshort_metadata_missing');
  return JSON.parse(match[1])?.props?.pageProps?.data;
}

function safeImageUrl(value) {
  const url = new URL(String(value || ''));
  const hosts = new Set([
    'v-img.crazymaplestudios.com',
    'v-mps.crazymaplestudios.com',
    'sz-cpp-misc-prod.oss-cn-shenzhen.aliyuncs.com',
    'awscover.netshort.com',
  ]);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !hosts.has(url.hostname)) {
    throw new Error('reelshort_image_invalid');
  }
  return url.href;
}

function metadataPayload(data, sourceUrl) {
  if (!data?.book_id || !data?.book_title || !Array.isArray(data?.online_base)) {
    throw new Error('reelshort_metadata_incomplete');
  }
  const bookId = validBookId(data.book_id);
  if (!bookId) throw new Error('reelshort_book_invalid');
  const seen = new Set();
  const chapters = data.online_base.flatMap((chapter, index) => {
    if (Number(chapter?.chapter_type) === 2) return [];
    const number = Number(chapter?.serial_number) || index + 1;
    if (!validEpisode(number) || seen.has(number)) return [];
    seen.add(number);
    return [{ number }];
  });
  if (!chapters.length) throw new Error('reelshort_episodes_missing');
  const name = String(data.book_title).trim();
  const mark = slugify(data.book_mark?.text);
  const portugueseAudio = Number(data.is_dub) === 1
    || mark.includes('brasileir') || /^pt(?:-|$)/i.test(String(data.original_lang || ''));
  return {
    id: slugify(name) || `reelshort-${bookId.slice(-12)}`,
    bookId,
    sourceUrl,
    name: name.slice(0, 180),
    imageUrl: safeImageUrl(data.book_pic),
    synopsis: String(data.special_desc || '').trim().slice(0, 4000),
    status: Number(data.update_status) === 1 ? 'Concluída' : 'Em andamento',
    dubbed: Number(data.is_dub) === 1,
    ...(portugueseAudio ? { audioLanguages: ['pt-BR'], defaultAudioLanguage: 'pt-BR' } : {}),
    chapters,
  };
}

async function reelShortMetadata(bookId, request) {
  const target = `https://www.reelshort.com/pt/movie/${bookId}`;
  const response = await upstreamFetch(target, {
    method: 'GET',
    headers: {
      accept: 'text/html,application/xhtml+xml',
      'accept-language': 'pt-BR,pt;q=0.9',
      'user-agent': 'Mozilla/5.0 (compatible; EVOTV-DramaFren-Relay/1.0)',
    },
    redirect: 'follow',
  }, request, 20_000);
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new Error(`reelshort_http_${response.status}`);
  }
  const payload = metadataPayload(nextData(await response.text()), response.url || target);
  if (payload.bookId !== bookId) throw new Error('reelshort_book_mismatch');
  return payload;
}

function checkedPlaylist(value) {
  const url = new URL(String(value || ''));
  if (url.protocol !== 'https:' || url.username || url.password
    || url.hostname !== PLAYLIST_HOST || !/\.m3u8$/i.test(url.pathname)) {
    throw new Error('dramafren_playlist_invalid');
  }
  return url.href;
}

async function dramaFrenPlayback(bookId, episode, request) {
  const failures = [];
  const attempts = [1, 2].flatMap(server => DRAMAFREN_PLAYBACK_ENDPOINTS.map(address => ({ address, server })));
  for (const attempt of attempts) {
    const target = new URL(attempt.address);
    target.search = new URLSearchParams({
      action: 'playback', page: 'watch', id: bookId,
      ep: String(episode), server: String(attempt.server), lang: 'pt',
    });
    try {
      const response = await upstreamFetch(target, {
        method: 'GET',
        headers: { accept: 'application/json', 'user-agent': 'Mozilla/5.0 (compatible; EVOTV-DramaFren-Relay/1.0)' },
        redirect: 'follow',
      }, request);
      if (!response.ok) {
        failures.push(`HTTP ${response.status}`);
        await response.body?.cancel().catch(() => {});
        continue;
      }
      const data = await response.json();
      if (Number(data?.episode) !== episode) {
        failures.push('episodio divergente');
        continue;
      }
      const qualities = Array.isArray(data?.qualities)
        ? [...data.qualities].sort((left, right) => (Number.parseInt(right?.quality, 10) || 0) - (Number.parseInt(left?.quality, 10) || 0))
        : [];
      for (const candidate of [...qualities.map(item => item?.url), data?.videoUrl]) {
        try {
          return { episode, playlistUrl: checkedPlaylist(candidate), sourceProvider: 'dramafren' };
        } catch { /* tenta a proxima qualidade */ }
      }
      failures.push('playlist ausente');
    } catch (error) {
      if (request.signal.aborted) throw error;
      failures.push(error?.name === 'AbortError' ? 'timeout' : 'falha de rede');
    }
  }
  const error = new Error('dramafren_playback_unavailable');
  error.failures = [...new Set(failures)].slice(0, 4);
  throw error;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = requestOrigin(request);

    if (url.pathname === '/health') {
      return jsonResponse({
        ok: true,
        service: 'evotv-dramafren-relay',
        mode: 'anonymous-no-origin',
        seriesPerRequest: 1,
        panelBatchLimit: 20,
      }, 200, origin, env);
    }

    if (!allowedOrigin(origin, env)) {
      return jsonError(403, 'ORIGIN_FORBIDDEN', 'Origem do painel nao autorizada.', '', env);
    }
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(origin, env) });
    if (request.method !== 'GET') return jsonError(405, 'METHOD_NOT_ALLOWED', 'Metodo nao permitido.', origin, env);

    const bookId = validBookId(url.searchParams.get('id'));
    if (!bookId) return jsonError(400, 'BOOK_ID_INVALID', 'Identificador da mininovela invalido.', origin, env);

    try {
      if (url.pathname === '/v1/metadata') {
        return jsonResponse(await reelShortMetadata(bookId, request), 200, origin, env);
      }
      if (url.pathname === '/v1/playback') {
        const episode = validEpisode(url.searchParams.get('episode'));
        if (!episode) return jsonError(400, 'EPISODE_INVALID', 'Numero de episodio invalido.', origin, env);
        return jsonResponse(await dramaFrenPlayback(bookId, episode, request), 200, origin, env);
      }
      return jsonError(404, 'NOT_FOUND', 'Rota nao encontrada.', origin, env);
    } catch (error) {
      console.warn('dramafren_relay_failed', url.pathname, error?.message || 'unknown');
      const code = error?.message === 'dramafren_playback_unavailable'
        ? 'DRAMAFREN_PLAYBACK_UNAVAILABLE' : 'UPSTREAM_FAILED';
      return jsonError(502, code, code === 'DRAMAFREN_PLAYBACK_UNAVAILABLE'
        ? 'O DramaFren nao devolveu uma playlist valida para este episodio.'
        : 'Nao foi possivel consultar os metadados publicos da mininovela.', origin, env);
    }
  },
};
