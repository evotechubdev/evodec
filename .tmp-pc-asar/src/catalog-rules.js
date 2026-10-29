const CATALOG = {
  channels: { list: 'get_live_streams', categories: 'get_live_categories', id: 'stream_id', kind: 'live' },
  movies: { list: 'get_vod_streams', categories: 'get_vod_categories', id: 'stream_id', kind: 'movie' },
  series: { list: 'get_series', categories: 'get_series_categories', id: 'series_id', kind: 'series' },
};
const normalized = (text) => String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');
const adultName = (text) => /(?:\badult[oa]s?\b|\bxxx\b|\bporn(?:o|os|ografia|ography)?\b|\bsex(?:o|y)?\b|\berotic[oa]s?\b|\b18\s*\+|\+\s*18\b)/i.test(normalized(text));
const flagged = (value) => value === true || value === 1 || value === '1';
const DUAL_AUDIO_CATEGORY = 'evo_dual_audio';
const { CHANNEL_LIST_CATEGORY, RECENT_CATEGORY, CONTENT_FAVORITES_CATEGORY, MOVIE_RELEASES_CATEGORY, FAVORITES_DEFAULT, initialCategory, categoryLabel, channelDetails, channelCollection, recentTimestamp } = require('./catalog-organization');
const dualLabel = text => /\b(?:dual[\s._-]*audio|multi[\s._-]*audio|bilingue)\b/.test(normalized(text));
function dualAudio(item, category) {
  if (flagged(item.is_dual_audio) || flagged(item.dual_audio) || dualLabel(item.name)
    || /(?:\[|\()\s*dual\s*(?:\]|\))|(?:^|[|·])\s*dual\s*(?:$|[|·])|\sdual(?:\s+(?:\d{3,4}p|4k|uhd|fhd|hd|hevc|h26[45]))*(?:\s+\(\d{4}\))?\s*$/i.test(item.name || '')
    || dualLabel(category) || /\bdual\b/i.test(String(category || ''))) return true;
  const raw = item.audio_languages ?? item.audioLanguages ?? item.audio_tracks;
  const languages = Array.isArray(raw) ? raw.map(track => typeof track === 'string' ? track : track?.language || track?.lang) : typeof raw === 'string' ? raw.split(/[,;|/+]/) : [];
  const aliases = { por: 'pt', portugues: 'pt', eng: 'en', english: 'en', ingles: 'en', spa: 'es', spanish: 'es', espanhol: 'es', fra: 'fr', fre: 'fr', french: 'fr', frances: 'fr' };
  const known = languages.map(value => normalized(value).trim().split(/[-_]/)[0]).map(value => aliases[value] || value).filter(value => /^(?:[a-z]{2}|[a-z]{3})$/.test(value) && !['und', 'unk', 'mul'].includes(value));
  return new Set(known).size > 1;
}
function contentAge(item) {
  for (const key of ['age_rating', 'parental_rating', 'content_rating', 'certification', 'mpaa_rating']) {
    const value = normalized(item?.[key]);
    if (/^(livre|l|g|tv-y|tv-g)$/.test(value)) return 0;
    const match = /^(?:rated\s*)?(0|10|12|14|16|18)(?:\s*(?:anos|\+))?$/.exec(value);
    if (match) return Number(match[1]);
    if (/^(r|nc-17|tv-ma)$/.test(value)) return 18;
    if (/^(pg-13|tv-14)$/.test(value)) return 14;
    if (/^(pg|tv-pg)$/.test(value)) return 10;
  }
  return null;
}
function permitted(entry, grant, adultScope = false) {
  const controls = grant.parental || { enabled: true, maxAge: 18 };
  if (adultScope !== entry.adult) return false;
  if (entry.adult && (!grant.adultAllowed || controls.adultMode === 'hidden' || controls.adultVisible === false)) return false;
  if (controls.enabled && !grant.adultAllowed && controls.maxAge < 18 && (entry.age == null || entry.age > controls.maxAge)) return false;
  return true;
}
function preferredBahiaChannel(channel) {
  const key = channel.key;
  const preferred = [
    [/\btv\s+bahia\b/, 'TV Bahia', 'globo'],
    [/\bsbt\s+(?:ba|bahia|salvador)\b/, 'SBT Bahia', 'sbt'],
    [/\brecord\s*(?:tv\s*)?(?:ba|bahia|salvador)\b/, 'RecordTV Bahia', 'record'],
    [/\bband\s+(?:ba|bahia|salvador)\b/, 'Band Bahia', 'band'],
  ];
  for (const [pattern, name, family] of preferred) if (pattern.test(key)) return { ...channel, name, key: `preferred:${family}`, familyKey: `preferred:${family}`, region: 'ba', regionRank: 0 };
  if (/\bglobo(?:news)?\b|\bsbt\b|\brecord(?:\s*tv)?\b|\bband(?:\s*(?:news|sports))?\b/.test(key)) return null;
  return channel;
}
const categoryIdentity = name => normalized(name).replace(/[^a-z0-9+!]+/g, ' ').trim().replace(/^canais /, '');
const movieReleases2026 = name => /^(?:filmes )?lancamentos 2026$/.test(categoryIdentity(name));
const defaultCollections = new Map(FAVORITES_DEFAULT.map(item => [item.key, item]));
const defaultCategories = new Set(FAVORITES_DEFAULT.map(item => categoryIdentity(item.category)));
function favoriteDetails(entry, data) {
  const channel = preferredBahiaChannel(entry.channel) || entry.channel;
  let description = channelCollection(channel.name, channel.familyKey);
  const preset = defaultCollections.get(description.key);
  const sourceCategory = categoryIdentity(data.categoryNames.get(String(entry.item.category_id)));
  // Scope other sources by their stable category name, never by provider IDs.
  // In particular, Disney+ sports and the subtitled feeds must not be merged
  // with children's Disney channels or dubbed movie feeds.
  if (preset && data.namedChannelCategories && sourceCategory !== categoryIdentity(preset.category)) {
    description = { ...description, key: `category:${sourceCategory}:${description.key}` };
  }
  if (channel.region && !['ba', 'br'].includes(channel.region)) {
    description = { ...description, key: `region:${channel.region}:${description.key}` };
  }
  return { channel, description };
}
class ContentCatalog {
  constructor(load) { this.load = load; this.sections = new Map(); this.episodes = new Map(); }
  async section(section) {
    const config = CATALOG[section];
    if (!config) throw new Error('Catálogo inválido.');
    // Finish both lookups before permitting a retry; failed category metadata
    // must not leave an older in-flight request attached to the next attempt.
    const loaded = await Promise.allSettled([this.load(config.list), this.load(config.categories)]);
    const failed = loaded.find(result => result.status === 'rejected');
    if (failed) throw failed.reason;
    const [items, categories] = loaded.map(result => result.value);
    const prior = this.sections.get(section);
    if (prior?.source === items && prior.categorySource === categories) return prior;
    const adultCategories = new Set(categories.filter((item) => flagged(item.is_adult) || adultName(item.category_name)).map((item) => String(item.category_id)));
    const categoryNames = new Map(categories.map(category => [String(category.category_id), category.category_name]));
    const entries = items.map((item) => ({ item, adult: flagged(item.is_adult) || adultCategories.has(String(item.category_id)) || /(?:\[(?:adultos?|18\+|\+18)\]|\(\+18\))/i.test(item.name || ''), dualAudio: ['movies', 'series'].includes(section) && dualAudio(item, categoryNames.get(String(item.category_id))), age: contentAge(item), search: normalized(item.name), channel: section === 'channels' ? channelDetails(item) : null, recent: section === 'channels' ? 0 : recentTimestamp(item, section) }));
    const result = { source: items, categorySource: categories, categories, adultCategories, categoryNames,
      movieReleaseCategoryIds: new Set(categories.filter(item => movieReleases2026(item.category_name)).map(item => String(item.category_id))),
      namedChannelCategories: categories.some(item => defaultCategories.has(categoryIdentity(item.category_name))),
      entries, index: new Map(entries.map((entry) => [String(entry.item[config.id]), entry])) };
    this.sections.set(section, result);
    return result;
  }
  async categories(section, grant, adultScope) {
    if (adultScope && (grant.parental?.adultMode === 'hidden' || grant.parental?.adultVisible === false)) throw Object.assign(new Error('Conteúdo adulto indisponível neste perfil.'), { code: 'ADULT_BLOCKED', status: 403 });
    if (adultScope && !grant.adultAllowed) throw Object.assign(new Error('Digite o PIN definido no perfil principal para abrir Adultos.'), { code: 'PARENTAL_LOCKED', status: 403 });
    const data = await this.section(section);
    const entries = data.entries.filter((entry) => permitted(entry, grant, adultScope));
    const visible = new Set(entries.map(entry => String(entry.item.category_id)));
    let categories = data.categories.filter((item) => visible.has(String(item.category_id)));
    if (section === 'movies') {
      categories = categories.filter(item => !data.movieReleaseCategoryIds.has(String(item.category_id))
        && String(item.category_id) !== RECENT_CATEGORY
        && normalized(item.category_name).trim() !== normalized('Recém Adicionados'));
      categories.unshift({ category_id: RECENT_CATEGORY, category_name: 'Recém Adicionados' });
    }
    if (['movies', 'series'].includes(section) && entries.some(entry => entry.dualAudio)) {
      categories = categories.filter(item => normalized(item.category_name).trim() !== 'dual audio');
      categories.unshift({ category_id: DUAL_AUDIO_CATEGORY, category_name: 'Dual Áudio' });
    }
    const primary = initialCategory(section);
    categories = categories.filter(item => String(item.category_id) !== primary && normalized(item.category_name).trim() !== normalized(categoryLabel(section)));
    categories.unshift({ category_id: primary, category_name: categoryLabel(section) });
    return categories;
  }
  async page(section, grant, { category = 'all', query = '', page = 1, limit = 48, adult = false, favorites } = {}) {
    const config = CATALOG[section];
    if (!config) throw new Error('Catálogo inválido.');
    if (adult && (grant.parental?.adultMode === 'hidden' || grant.parental?.adultVisible === false)) throw Object.assign(new Error('Conteúdo adulto indisponível neste perfil.'), { code: 'ADULT_BLOCKED', status: 403 });
    if (adult && !grant.adultAllowed) throw Object.assign(new Error('Digite o PIN definido no perfil principal para abrir Adultos.'), { code: 'PARENTAL_LOCKED', status: 403 });
    const data = await this.section(section);
    const search = normalized(query.trim());
    const special = category === CHANNEL_LIST_CATEGORY || category === RECENT_CATEGORY || category === CONTENT_FAVORITES_CATEGORY || category === MOVIE_RELEASES_CATEGORY;
    if ((category === CHANNEL_LIST_CATEGORY && section !== 'channels')
      || (category === MOVIE_RELEASES_CATEGORY && section !== 'movies')
      || ([RECENT_CATEGORY, CONTENT_FAVORITES_CATEGORY].includes(category) && !['movies', 'series'].includes(section))) throw new Error('Categoria indisponível nesta seção.');
    let entries = data.entries.filter((entry) => permitted(entry, grant, adult) && (special || category === 'all' || (category === DUAL_AUDIO_CATEGORY ? ['movies', 'series'].includes(section) && entry.dualAudio : String(entry.item.category_id) === category)));
    if (category === CHANNEL_LIST_CATEGORY) {
      const families = new Map();
      for (const sourceEntry of entries) {
        if (!/^\d+$/.test(String(sourceEntry.item.stream_id))) continue;
        const { channel, description } = favoriteDetails(sourceEntry, data);
        const entry = { ...sourceEntry, channel, collection: description, search: `${sourceEntry.search}\n${normalized(channel.name)}` };
        const familyKey = `${description.key}|${channel.familyKey}`;
        let family = families.get(familyKey);
        if (!family) families.set(familyKey, family = []);
        if (!family.some(candidate => String(candidate.item.stream_id) === String(entry.item.stream_id))) family.push(entry);
      }
      const choices = [...families.values()].map(family => {
        const regions = new Map();
        for (const entry of family) {
          let region = regions.get(entry.channel.region);
          if (!region) regions.set(entry.channel.region, region = []);
          region.push(entry);
        }
        const group = [...regions.values()].sort((a, b) => {
          const rank = a[0].channel.regionRank - b[0].channel.regionRank;
          if (rank) return rank;
          if (b.length !== a.length) return b.length - a.length;
          return Math.max(...b.map(entry => entry.channel.quality)) - Math.max(...a.map(entry => entry.channel.quality));
        })[0];
        group.sort((a, b) => b.channel.quality - a.channel.quality);
        const first = group[0];
        const localitySearch = first.channel.region === 'ba' ? `${first.channel.familyKey} bahia ba salvador` : '';
        return { ...first, search: [...group.map(entry => entry.search), localitySearch].join('\n'), item: { ...first.item, name: first.channel.name,
          evo_live_variants: group.map(entry => ({ stream_id: entry.item.stream_id, quality: entry.channel.quality,
            container_extension: entry.item.container_extension || 'ts' })) } };
      });
      const collections = new Map();
      for (const choice of choices) {
        const description = choice.collection;
        let collection = collections.get(description.key);
        if (!collection) collections.set(description.key, collection = { description, choices: [] });
        collection.choices.push(choice);
      }
      entries = [...collections.values()].map(({ description, choices: channelChoices }) => {
        if (!description.nested || (description.multipleOnly && channelChoices.length < 2)) {
          const first = channelChoices[0];
          return { ...first, item: { ...first.item, ...(description.canonical ? { name: description.name } : {}), evo_favorite_key: description.key, evo_favorite_name: description.name } };
        }
        const first = channelChoices[0];
        const selectable = channelChoices.map(choice => ({
          stream_id: choice.item.stream_id,
          name: choice.item.name,
          stream_icon: choice.item.stream_icon,
          category_id: choice.item.category_id,
          container_extension: choice.item.container_extension || 'ts',
          evo_live_variants: choice.item.evo_live_variants,
        }));
        return { ...first, search: [description.name, ...channelChoices.map(choice => choice.search)].join('\n'),
          item: { ...first.item, name: description.name, evo_favorite_key: description.key, evo_favorite_name: description.name, evo_live_choices: selectable } };
      });
      const requested = Array.isArray(favorites) ? favorites : FAVORITES_DEFAULT.map(item => item.key);
      const order = new Map(requested.filter(key => typeof key === 'string' && key.length <= 160 && /^[a-z0-9:+! _-]+$/.test(key)).slice(0, 256).map((key, index) => [key, index]));
      entries = entries.filter(entry => order.has(entry.item.evo_favorite_key)).sort((a, b) => order.get(a.item.evo_favorite_key) - order.get(b.item.evo_favorite_key));
    } else if (category === MOVIE_RELEASES_CATEGORY) {
      entries = entries.filter(entry => data.movieReleaseCategoryIds.has(String(entry.item.category_id)))
        .sort((a, b) => b.recent - a.recent || Number(b.item[config.id] || 0) - Number(a.item[config.id] || 0));
    } else if (category === RECENT_CATEGORY) entries.sort((a, b) => b.recent - a.recent);
    else if (category === CONTENT_FAVORITES_CATEGORY) {
      const selected = new Set((Array.isArray(favorites) ? favorites : []).map(String));
      entries = entries.filter(entry => selected.has(String(entry.item[config.id])));
    }
    if (search) entries = entries.filter(entry => entry.search.includes(search));
    const start = (page - 1) * limit;
    const items = entries.slice(start, start + limit).map((entry) => {
      if (section !== 'channels' || category === CHANNEL_LIST_CATEGORY) return entry.item;
      const { description } = favoriteDetails(entry, data);
      return { ...entry.item, evo_favorite_key: description.key, evo_favorite_name: description.name };
    });
    return { items, page, limit, total: entries.length, hasMore: start + limit < entries.length };
  }
  async authorize(kind, id, grant, seriesId) {
    let entry;
    if (kind === 'series') {
      const owner = this.episodes.get(String(id));
      if (!owner || (seriesId && String(seriesId) !== owner.seriesId)) throw Object.assign(new Error('Abra os episódios da série novamente.'), { status: 404, code: 'EPISODE_UNKNOWN' });
      entry = (await this.section('series')).index.get(owner.seriesId);
    } else entry = (await this.section(kind === 'movie' ? 'movies' : 'channels')).index.get(String(id));
    if (!entry) throw Object.assign(new Error('Conteúdo não encontrado no catálogo.'), { status: 404, code: 'CONTENT_UNKNOWN' });
    if (!permitted(entry, grant, entry.adult)) throw Object.assign(new Error('Conteúdo bloqueado pelo controle parental deste perfil.'), { status: 403, code: 'PARENTAL_LOCKED' });
    return entry;
  }
  rememberEpisodes(seriesId, details) {
    for (const episode of Object.values(details?.episodes || {}).flat()) {
      if (episode?.id != null) this.episodes.set(String(episode.id), { seriesId: String(seriesId) });
    }
    while (this.episodes.size > 100_000) this.episodes.delete(this.episodes.keys().next().value);
  }
}

module.exports = { CATALOG, DUAL_AUDIO_CATEGORY, CONTENT_FAVORITES_CATEGORY, MOVIE_RELEASES_CATEGORY, normalized, contentAge, permitted, ContentCatalog };
