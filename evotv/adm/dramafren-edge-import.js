export const DRAMAFREN_RELAY_ORIGIN = 'https://evotv-dramafren-relay.evotechubdev.workers.dev';

const BOOK_ID = /^[a-f0-9]{24}$/i;
const REQUEST_INTERVAL_MS = 250;
const RECOVERY_PASSES = 2;
const RECOVERY_DELAY_MS = 1_500;

const wait = (milliseconds, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) return reject(new DOMException('Importação cancelada.', 'AbortError'));
  const timeout = setTimeout(done, milliseconds);
  function done() { signal?.removeEventListener('abort', abort); resolve(); }
  function abort() { clearTimeout(timeout); signal?.removeEventListener('abort', abort); reject(new DOMException('Importação cancelada.', 'AbortError')); }
  signal?.addEventListener('abort', abort, { once: true });
});

async function relayRequest(path, signal) {
  const response = await fetch(`${DRAMAFREN_RELAY_ORIGIN}${path}`, {
    method: 'GET',
    headers: { accept: 'application/json' },
    credentials: 'omit',
    cache: 'no-store',
    signal,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `O relay Cloudflare respondeu HTTP ${response.status}.`);
  return data;
}

function inputBookId(rawUrl) {
  let url;
  try { url = new URL(String(rawUrl || '').trim()); }
  catch { throw new Error('Informe um link HTTPS válido para o piloto Cloudflare.'); }
  if (url.protocol !== 'https:') throw new Error('O link do piloto precisa usar HTTPS.');
  let id = '';
  if (url.hostname === 'reelshort.dramafren.org') id = url.searchParams.get('id') || '';
  else if (['reelshort.com', 'www.reelshort.com'].includes(url.hostname)) id = url.pathname.match(/([a-f0-9]{24})(?:\/)?$/i)?.[1] || '';
  if (!BOOK_ID.test(id)) throw new Error('O piloto aceita um link de detalhe/watch do ReelShort no DramaFren.');
  return id.toLowerCase();
}

function watchUrl(bookId, episode) {
  const url = new URL('https://reelshort.dramafren.org/index.php');
  url.search = new URLSearchParams({ page: 'watch', id: bookId, ep: String(episode), lang: 'pt' });
  return url.href;
}

function validatedMetadata(data, expectedBookId) {
  const bookId = String(data?.bookId || '').toLowerCase();
  const id = String(data?.id || '');
  const chapters = Array.isArray(data?.chapters) ? data.chapters : [];
  if (bookId !== expectedBookId || !/^[a-z0-9][a-z0-9-]{1,126}[a-z0-9]$/.test(id)
    || !String(data?.name || '').trim() || !chapters.length || chapters.length > 1000) {
    throw new Error('O relay devolveu metadados incompletos ou inválidos.');
  }
  const numbers = chapters.map(item => Number(item?.number));
  if (numbers.some(number => !Number.isInteger(number) || number < 1 || number > 1000)
    || new Set(numbers).size !== numbers.length) {
    throw new Error('A lista de episódios recebida do relay é inválida.');
  }
  return { ...data, id, bookId, chapters: numbers.map(number => ({ number })) };
}

async function episodeSource(bookId, number, signal) {
  const data = await relayRequest(`/v1/playback?id=${encodeURIComponent(bookId)}&episode=${number}`, signal);
  if (Number(data?.episode) !== number || data?.sourceProvider !== 'dramafren') {
    throw new Error('O relay devolveu dados de outro episódio.');
  }
  const playlist = new URL(String(data?.playlistUrl || ''));
  if (playlist.protocol !== 'https:' || playlist.hostname !== 'v-mps.crazymaplestudios.com'
    || !/\.m3u8$/i.test(playlist.pathname)) {
    throw new Error('O relay não devolveu uma playlist oficial compatível.');
  }
  return playlist.href;
}

export async function relayHealth(signal) {
  const data = await relayRequest('/health', signal);
  if (!data?.ok || data?.service !== 'evotv-dramafren-relay') throw new Error('Resposta inválida do relay Cloudflare.');
  return data;
}

export async function importOneSeriesViaRelay({
  link, streamingName, existingIds = [], signal, onProgress = () => {},
}) {
  const requestedBookId = inputBookId(link);
  onProgress({ episodeStage: 'metadata-requesting', processedEpisodes: 0, availableEpisodes: 0, unavailableEpisodes: 0 });
  const metadata = validatedMetadata(
    await relayRequest(`/v1/metadata?id=${encodeURIComponent(requestedBookId)}`, signal),
    requestedBookId,
  );
  const known = new Set(existingIds.map(value => String(value || '').toLowerCase()));
  if (known.has(metadata.id.toLowerCase()) || known.has(`book:${metadata.bookId}`)) {
    const error = new Error(`“${metadata.name}” já existe no catálogo.`);
    error.code = 'REELSHORT_ALREADY_EXISTS';
    throw error;
  }

  let processedEpisodes = 0;
  let availableEpisodes = 0;
  const results = new Array(metadata.chapters.length);
  const report = extra => onProgress({
    name: metadata.name,
    episodeTotal: metadata.chapters.length,
    processedEpisodes,
    availableEpisodes,
    unavailableEpisodes: processedEpisodes - availableEpisodes,
    sourceProvider: 'dramafren',
    ...extra,
  });

  for (let index = 0; index < metadata.chapters.length; index += 1) {
    const number = metadata.chapters[index].number;
    report({ episodeNumber: number, episodeStage: 'dramafren-requesting' });
    try {
      const playlistUrl = await episodeSource(metadata.bookId, number, signal);
      results[index] = { episode: { number, playlistUrl } };
      availableEpisodes += 1;
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      results[index] = { unavailable: { number, reason: error.message, pageUrl: watchUrl(metadata.bookId, number) } };
    }
    processedEpisodes += 1;
    report({ episodeNumber: number, episodeStage: 'complete' });
    if (index + 1 < metadata.chapters.length) await wait(REQUEST_INTERVAL_MS, signal);
  }

  for (let recoveryPass = 1; recoveryPass <= RECOVERY_PASSES; recoveryPass += 1) {
    const failedIndexes = results.flatMap((item, index) => item?.unavailable ? [index] : []);
    if (!failedIndexes.length) break;
    report({
      episodeNumber: metadata.chapters[failedIndexes[0]].number,
      episodeStage: `recovery-${recoveryPass}-waiting`,
      recoveryPass, recoveryPasses: RECOVERY_PASSES,
    });
    await wait(RECOVERY_DELAY_MS * recoveryPass, signal);
    for (const index of failedIndexes) {
      const number = metadata.chapters[index].number;
      report({ episodeNumber: number, episodeStage: `recovery-${recoveryPass}-dramafren-requesting`, recoveryPass, recoveryPasses: RECOVERY_PASSES });
      try {
        const playlistUrl = await episodeSource(metadata.bookId, number, signal);
        results[index] = { episode: { number, playlistUrl } };
        availableEpisodes += 1;
      } catch (error) {
        if (error?.name === 'AbortError') throw error;
        results[index] = { unavailable: { number, reason: error.message, pageUrl: watchUrl(metadata.bookId, number) } };
      }
      report({ episodeNumber: number, episodeStage: `recovery-${recoveryPass}-complete`, recoveryPass, recoveryPasses: RECOVERY_PASSES });
      await wait(REQUEST_INTERVAL_MS, signal);
    }
  }

  const unavailableEpisodes = results.flatMap(item => item?.unavailable ? [item.unavailable] : []);
  if (unavailableEpisodes.length) {
    const error = new Error(`Importação incompleta: ${availableEpisodes} de ${metadata.chapters.length} episódios localizados. Nada foi salvo.`);
    error.code = 'REELSHORT_INCOMPLETE';
    error.item = {
      id: metadata.id,
      name: metadata.name,
      availableEpisodes,
      totalEpisodes: metadata.chapters.length,
      unavailableEpisodes,
    };
    throw error;
  }

  const episodes = results.map(({ episode }) => ({
    id: `${metadata.id}-episode-${String(episode.number).padStart(2, '0')}`,
    name: `Episódio ${episode.number}`,
    number: episode.number,
    duration: '',
    playlistUrl: episode.playlistUrl,
  }));
  return {
    id: metadata.id,
    bookId: metadata.bookId,
    streamingName,
    sourceUrl: metadata.sourceUrl,
    name: metadata.name,
    imageUrl: metadata.imageUrl,
    synopsis: metadata.synopsis,
    status: metadata.status,
    dubbed: metadata.dubbed === true,
    ...(Array.isArray(metadata.audioLanguages) ? { audioLanguages: metadata.audioLanguages } : {}),
    ...(metadata.defaultAudioLanguage ? { defaultAudioLanguage: metadata.defaultAudioLanguage } : {}),
    episodes,
    importNotes: {
      publishedEpisodes: episodes.length,
      unavailableEpisodes: [],
      dramafrenEpisodes: episodes.map(item => item.number),
    },
  };
}
