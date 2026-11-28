import { importOneSeriesViaRelay } from '../../adm/dramafren-import.js';

const input = String(process.argv[2] || '').trim();
if (!input) throw new Error('Informe um link ReelShort do DramaFren como argumento.');

const directFetch = globalThis.fetch;
globalThis.fetch = (target, init = {}) => directFetch(target, {
  ...init,
  headers: { ...(init.headers || {}), origin: 'https://evotechub.com.br' },
});

let lastProgress = -1;
const series = await importOneSeriesViaRelay({
  link: input,
  streamingName: 'REELSHORT',
  onProgress(progress) {
    const processed = Number(progress.processedEpisodes) || 0;
    if (processed === lastProgress) return;
    lastProgress = processed;
    if (processed % 10 === 0 || processed === progress.episodeTotal) {
      console.log(`progresso ${processed}/${progress.episodeTotal} fontes=${progress.availableEpisodes}`);
    }
  },
});

console.log(JSON.stringify({
  name: series.name,
  episodes: series.episodes.length,
  dramafrenEpisodes: series.importNotes.dramafrenEpisodes.length,
  firstEpisode: series.episodes[0]?.number,
  lastEpisode: series.episodes.at(-1)?.number,
}));
