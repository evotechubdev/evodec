import fs from 'node:fs/promises';

const LINKS_FILE = new URL('../data/reelshort-links.txt', import.meta.url);
const CATALOG_FILE = new URL('../data/reelshort-series.json', import.meta.url);
const MAX_LINKS = 20;
const CONCURRENCY = 6;
const HEADERS = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/141.0 Safari/537.36',
  'accept-language': 'pt-BR,pt;q=0.9',
  accept: 'text/html,application/xhtml+xml',
};

const slugify = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 100);

async function fetchPage(url, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(30_000), redirect: 'follow' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return { text: await response.text(), url: response.url || url };
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise(resolve => setTimeout(resolve, 500 * attempt));
    }
  }
  throw new Error(`Não foi possível consultar ${url}: ${lastError?.message || 'falha de rede'}`);
}

const fetchText = async url => (await fetchPage(url)).text;

function resolveInputUrl(rawUrl) {
  const input = new URL(rawUrl);
  if (input.protocol !== 'https:') throw new Error('O link precisa usar HTTPS.');
  if (['www.reelshort.com', 'reelshort.com'].includes(input.hostname) && /^\/pt\/movie\//.test(input.pathname)) {
    input.search = ''; input.hash = '';
    return input;
  }
  if (input.hostname === 'fedoq.com' && input.pathname.startsWith('/impression/')) {
    const embedded = input.searchParams.get('pl');
    if (!embedded) throw new Error('O link de anúncio não contém a página da mininovela.');
    return resolveInputUrl(embedded);
  }
  if (input.hostname === 'reelshort.dramafren.org') {
    const id = input.searchParams.get('id') || '';
    if (!/^[a-f0-9]{24}$/i.test(id)) throw new Error('O link Dramafren não contém um identificador válido.');
    return new URL(`https://www.reelshort.com/pt/movie/${id.toLowerCase()}`);
  }
  throw new Error('Use uma página oficial ReelShort ou um link de detalhe/watch do reelshort.dramafren.org.');
}

function nextData(html) {
  const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/i);
  if (!match) throw new Error('A página não contém os dados esperados do ReelShort.');
  return JSON.parse(match[1])?.props?.pageProps?.data;
}

function videoMetadata(html) {
  const scripts = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi)];
  for (const match of scripts) {
    const value = JSON.parse(match[1]);
    const nodes = Array.isArray(value?.['@graph']) ? value['@graph'] : [value];
    const video = nodes.find(node => node?.['@type'] === 'VideoObject' && node?.contentUrl);
    if (video) return video;
  }
  throw new Error('O episódio não publicou uma fonte de vídeo utilizável.');
}

function durationLabel(value) {
  const match = String(value || '').match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/i);
  if (!match) return '';
  const seconds = (Number(match[1]) || 0) * 3600 + (Number(match[2]) || 0) * 60 + (Number(match[3]) || 0);
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}

function checkedPlaylist(value) {
  const url = new URL(String(value || ''));
  if (url.protocol !== 'https:' || url.hostname !== 'v-mps.crazymaplestudios.com' || !/\.m3u8$/i.test(url.pathname)) {
    throw new Error('O episódio não aponta para uma playlist oficial compatível.');
  }
  return url.href;
}

async function parallelMap(items, mapper) {
  const result = new Array(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      result[index] = await mapper(items[index], index);
    }
  }));
  return result;
}

async function importSeries(rawUrl) {
  let page = resolveInputUrl(rawUrl);
  const response = await fetchPage(page.href);
  page = new URL(response.url);
  const html = response.text;
  const data = nextData(html);
  if (!data?.book_id || !data?.book_title || !Array.isArray(data?.online_base)) throw new Error('Dados incompletos da mininovela.');
  const mark = slugify(data.book_mark?.text);
  const portugueseAudio = Number(data.is_dub) === 1 || mark.includes('brasileir') || /^pt(?:-|$)/i.test(String(data.original_lang || ''));
  if (!portugueseAudio) throw new Error(`${data.book_title} não está marcada com áudio em português.`);
  const movieSlug = page.pathname.split('/').filter(Boolean).at(-1);
  const firstVideo = videoMetadata(html);
  const chapters = data.online_base.filter(chapter => Number(chapter?.chapter_type) !== 2);
  if (!chapters.length) throw new Error(`${data.book_title} não possui episódios publicados.`);
  const episodes = await parallelMap(chapters, async (chapter, index) => {
    const number = Number(chapter.serial_number) || index + 1;
    let video = firstVideo;
    if (index > 0) {
      const episodeUrl = new URL(`/pt/episodes/episode-${number}-${movieSlug}-${chapter.chapter_id}`, page);
      video = videoMetadata(await fetchText(episodeUrl.href));
    }
    console.log(`  ${data.book_title}: episódio ${number}/${chapters.length}`);
    return {
      id: '',
      name: `Episódio ${number}`,
      number,
      duration: durationLabel(video.duration),
      playlistUrl: checkedPlaylist(video.contentUrl),
    };
  });
  const id = slugify(data.book_title) || `reelshort-${String(data.book_id).slice(-12)}`;
  for (const episode of episodes) episode.id = `${id}-episode-${String(episode.number).padStart(2, '0')}`;
  return {
    id,
    bookId: String(data.book_id),
    sourceUrl: page.href,
    name: String(data.book_title).trim(),
    imageUrl: String(data.book_pic || firstVideo.thumbnailUrl || '').trim(),
    synopsis: String(data.special_desc || firstVideo.description || '').trim(),
    status: Number(data.update_status) === 1 ? 'Concluída' : 'Em andamento',
    dubbed: Number(data.is_dub) === 1,
    defaultAudioLanguage: 'pt-BR',
    episodes,
  };
}

async function inputLinks() {
  const args = process.argv.slice(2).filter(value => !value.startsWith('--'));
  const text = args.length ? args.join('\n') : await fs.readFile(LINKS_FILE, 'utf8');
  const links = [...new Set(text.split(/\r?\n/).map(value => value.trim()).filter(value => value && !value.startsWith('#')))];
  if (!links.length) throw new Error('Cole de 1 a 20 links em data/reelshort-links.txt, um por linha.');
  if (links.length > MAX_LINKS) throw new Error(`Cada lote aceita no máximo ${MAX_LINKS} links.`);
  return links;
}

const links = await inputLinks();
const imported = [];
const rejected = [];
for (const [index, link] of links.entries()) {
  console.log(`[${index + 1}/${links.length}] Importando ${link}`);
  try {
    imported.push(await importSeries(link));
  } catch (error) {
    const reason = String(error?.message || 'falha desconhecida').replace(/[\r\n]+/g, ' ').slice(0, 300);
    rejected.push({ index: index + 1, reason });
    console.warn(`  REJEITADA: ${reason}`);
  }
}
if (!imported.length) {
  console.error(`Nenhuma mininovela foi importada. ${rejected.length} link(s) rejeitado(s); o catálogo anterior foi preservado.`);
  process.exitCode = 1;
} else {
  const previous = JSON.parse(await fs.readFile(CATALOG_FILE, 'utf8').catch(() => '[]'));
  const merged = new Map((Array.isArray(previous) ? previous : []).map(item => [String(item.bookId || item.id), item]));
  for (const item of imported) merged.set(item.bookId, item);
  const output = `${JSON.stringify([...merged.values()], null, 2)}\n`;
  const temporary = new URL('../data/reelshort-series.tmp.json', import.meta.url);
  await fs.writeFile(temporary, output, 'utf8');
  await fs.rename(temporary, CATALOG_FILE);
  console.log(`Concluído: ${imported.length} mininovela(s) atualizada(s); ${merged.size} no catálogo importado.`);
  if (rejected.length) {
    console.warn(`Ignoradas por segurança: ${rejected.length}. Linhas: ${rejected.map(item => item.index).join(', ')}.`);
  }
}
