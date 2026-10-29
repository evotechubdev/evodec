(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.catalogOrganization = api;
})(typeof window === 'object' ? window : globalThis, () => {
  const CHANNEL_LIST_CATEGORY = 'evo_channel_list';
  const RECENT_CATEGORY = 'evo_recent';
  const CONTENT_FAVORITES_CATEGORY = 'evo_content_favorites';
  const MOVIE_RELEASES_CATEGORY = 'evo_movie_releases_2026';
  const FAVORITES_DEFAULT_NAME = 'Favoritos_Default';
  const FAVORITES_DEFAULT = Object.freeze([
    ['preferred:globo', 'TV Bahia', 'Globo'], ['preferred:sbt', 'SBT Bahia', 'SBT'],
    ['preferred:record', 'RecordTV Bahia', 'RecordTV'], ['preferred:band', 'Band Bahia', 'Band'],
    ['favorite:cultura', 'Cultura', 'Abertos'], ['favorite:futura', 'Futura', 'Abertos'],
    ['favorite:redetv', 'RedeTV!', 'Abertos'], ['favorite:tve-bahia', 'TVE Bahia', 'Abertos'],
    ['favorite:globoplay-novelas', 'Globoplay Novelas', 'Variedades'], ['favorite:ufc', 'UFC', 'UFC Fight Pass'],
    ['favorite:combate', 'Combate', 'Esportes'], ['favorite:fite', 'FITE+ Lutas', 'Esportes'],
    ['favorite:esporte-interativo', 'Esporte Interativo', 'Esportes'], ['favorite:ge-tv', 'GE TV', 'Esportes'],
    ['favorite:fifa', 'FIFA+', 'Esportes'], ['favorite:espn', 'ESPN', 'ESPN'],
    ['favorite:sportv', 'SporTV', 'SporTV'], ['favorite:premiere', 'Premiere', 'Premiere'],
    ['favorite:amazon', 'Amazon', 'Prime Video'], ['favorite:disney', 'Disney', 'Disney+'],
    ['favorite:copa', 'Copa', 'Prime Video'], ['favorite:brasileirao', 'Brasileirão', 'Brasileirão'],
    ['favorite:sportynet', 'SportyNet', 'Brasileirão'], ['favorite:tnt', 'TNT', 'Legendados'],
    ['favorite:megapix', 'Megapix', 'Legendados'], ['favorite:hbo', 'HBO', 'Legendados'],
    ['favorite:telecine', 'Telecine', 'Legendados'], ['favorite:cinemax', 'Cinemax', 'Legendados'],
    ['favorite:max', 'MAX', 'MAX'], ['favorite:paramount', 'Paramount', 'Paramount+'],
    ['favorite:discovery', 'Discovery', 'Documentários'], ['favorite:history', 'History', 'Documentários'],
    ['favorite:cartoon-network', 'Cartoon Network', 'Infantil'],
  ].map(([key, name, category]) => Object.freeze({ key, name, category: `Canais | ${category}` })));
  const favoriteFamilies = [
    ['favorite:globoplay-novelas', 'Globoplay Novelas', /^globoplay novelas\b/],
    ['favorite:esporte-interativo', 'Esporte Interativo', /^esporte interativo\b/],
    ['favorite:cartoon-network', 'Cartoon Network', /^cartoon(?: network)?(?:\s|$)/],
    ['favorite:tve-bahia', 'TVE Bahia', /^tve(?: bahia| ba| salvador)?(?:\s|$)/],
    ['favorite:ge-tv', 'GE TV', /^ge tv(?:\s|$)/],
    ['favorite:cultura', 'Cultura', /^(?:tv )?cultura\b/],
    ['favorite:futura', 'Futura', /^(?:tv )?futura\b/],
    ['favorite:redetv', 'RedeTV!', /^(?:rede\s*tv!?|redetv!)(?:\s|$)/],
    ['favorite:ufc', 'UFC', /^ufc\b/], ['favorite:combate', 'Combate', /^combate\b/],
    ['favorite:fite', 'FITE+ Lutas', /^fite\+(?:\s|$)/], ['favorite:fifa', 'FIFA+', /^fifa\+(?:\s|$)/],
    ['favorite:espn', 'ESPN', /^espn(?:\+)?(?:\s|$)/], ['favorite:sportv', 'SporTV', /^sportv(?:\s*\d+)?\b/],
    ['favorite:premiere', 'Premiere', /^premiere\b/], ['favorite:amazon', 'Amazon', /^amazon\b/],
    ['favorite:disney', 'Disney', /^disney(?:\+)?(?:\s|$)/], ['favorite:copa', 'Copa', /^copa\b/],
    ['favorite:brasileirao', 'Brasileirão', /^brasileirao\b/], ['favorite:sportynet', 'SportyNet', /^sportynet\b/],
    ['favorite:tnt', 'TNT', /^tnt\b/], ['favorite:megapix', 'Megapix', /^megapix\b/],
    ['favorite:hbo', 'HBO', /^hbo(?:\s*\d+)?\b/], ['favorite:telecine', 'Telecine', /^telecine\b/],
    ['favorite:cinemax', 'Cinemax', /^cinemax\b/], ['favorite:max', 'MAX', /^max(?:\s|$)/],
    ['favorite:paramount', 'Paramount', /^paramount(?:\+)?(?:\s|$)/], ['favorite:discovery', 'Discovery', /^discovery\b/],
    ['favorite:history', 'History', /^history\b/],
  ];
  const initialCategory = section => section === 'channels' ? CHANNEL_LIST_CATEGORY : section === 'movies' ? MOVIE_RELEASES_CATEGORY : RECENT_CATEGORY;
  const categoryLabel = section => section === 'channels' ? 'Canais Favoritos' : section === 'movies' ? 'Filmes | Lançamentos 2026' : 'Recém Adicionados';
  const categoryOrder = section => section === 'movies'
    ? [MOVIE_RELEASES_CATEGORY, RECENT_CATEGORY, CONTENT_FAVORITES_CATEGORY, 'all']
    : [initialCategory(section), 'all'];
  const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const qualityToken = /\b(?:\d{3,4}[x×]\d{3,4}|full[ ._-]*hd|fhd(?:60)?|uhd(?:60)?|4k(?:60)?|8k|hd(?:60)?|sd|ld|hq|lq|(?:2160|4320)p?(?:60)?|1080[pi]?(?:60)?|720p?(?:60)?|(?:480|576|360|240)p?|(?:30|50|60)\s*fps|h[ ._-]?26[45]|hevc|avc)\b/gi;
  const localities = [
    ['ba', /\b(?:ba|bahia|salvador)\b/g],
    ['br', /\b(?:br|brasil|nacional)\b/g],
    ['ac', /\b(?:ac|acre|rio branco)\b/g], ['al', /\b(?:al|alagoas|maceio)\b/g],
    ['ap', /\b(?:ap|amapa|macapa)\b/g], ['am', /\b(?:am|amazonas|manaus)\b/g],
    ['ce', /\b(?:ce|ceara|fortaleza)\b/g], ['df', /\b(?:df|distrito federal|brasilia)\b/g],
    ['es', /\b(?:es|espirito santo|vitoria)\b/g], ['go', /\b(?:go|goias|goiania)\b/g],
    ['ma', /\b(?:ma|maranhao|sao luis)\b/g], ['ms', /\b(?:ms|mato grosso do sul|campo grande)\b/g],
    ['mt', /\b(?:mt|mato grosso|cuiaba|cuaiba)\b/g], ['mg', /\b(?:mg|minas gerais|belo horizonte)\b/g],
    ['pa', /\b(?:pa|para|belem)\b/g], ['pb', /\b(?:pb|paraiba|joao pessoa)\b/g],
    ['pr', /\b(?:pr|parana|curitiba)\b/g], ['pe', /\b(?:pe|pernambuco|recife)\b/g],
    ['pi', /\b(?:pi|piaui|teresina)\b/g], ['rj', /\b(?:rj|rio|rio de janeiro|carioca|fluminense)\b/g],
    ['rn', /\b(?:rn|rio grande do norte|natal)\b/g], ['rs', /\b(?:rs|rio grande do sul|porto alegre)\b/g],
    ['ro', /\b(?:ro|rondonia|porto velho)\b/g], ['rr', /\b(?:rr|roraima|boa vista)\b/g],
    ['sc', /\b(?:sc|santa catarina|florianopolis)\b/g], ['sp', /\b(?:sp|sao paulo|paulista)\b/g],
    ['se', /\b(?:se|sergipe|aracaju)\b/g], ['to', /\b(?:to|tocantins|palmas)\b/g],
  ];

  function channelLocality(name, fallback) {
    const originalIdentity = normalize(name).replace(/[\[\](){}|·._-]/g, ' ').replace(/\s+/g, ' ').trim();
    let identity = originalIdentity;
    let region = '';
    for (const [key, pattern] of localities) {
      pattern.lastIndex = 0;
      if (!pattern.test(identity)) continue;
      if (!region || key === 'ba') region = key;
      pattern.lastIndex = 0;
      identity = identity.replace(pattern, ' ').replace(/\s+/g, ' ').trim();
    }
    // Bahia can be part of the station's actual brand (for example, "TV
    // Bahia"), not a regional duplicate marker. Do not collapse names that
    // would become only a generic word after removing the locality.
    if (!identity || /^(?:tv|canal|rede|radio|emissora)$/.test(identity)) return { familyKey: originalIdentity || fallback, region, regionRank: region === 'ba' ? 0 : region ? 2 : 1 };
    return { familyKey: identity || fallback, region, regionRank: region === 'ba' ? 0 : region ? 2 : 1 };
  }

  function channelDetails(item) {
    const original = String(item.name || '').trim();
    const metadata = normalize([original, item.quality, item.resolution, item.video_resolution].filter(value => typeof value === 'string').join(' '));
    let quality = /\b(?:8k|4320p?)\b/.test(metadata) ? 5
      : /\b(?:4k(?:60)?|uhd(?:60)?|2160p?(?:60)?)\b/.test(metadata) ? 4
      : /\b(?:fhd(?:60)?|full[ ._-]*hd|1080[pi]?(?:60)?)\b/.test(metadata) ? 3
      : /\b(?:hd(?:60)?|720p?(?:60)?)\b/.test(metadata) ? 2
      : /\b(?:sd|480p?|576p?)\b/.test(metadata) ? 1 : 0;
    const height = Number(item.height || item.video_height || /\b\d{3,4}[x×](\d{3,4})\b/.exec(metadata)?.[1]);
    if (Number.isFinite(height) && height >= 200 && height <= 8640) quality = Math.max(quality, height >= 4320 ? 5 : height >= 1800 ? 4 : height >= 1000 ? 3 : height >= 700 ? 2 : height >= 450 ? 1 : 0);
    const name = original.replace(qualityToken, ' ').replace(/[\[({]\s*[\])}]/g, ' ').replace(/\s*([|·])\s*(?=[|·]|$)/g, ' ')
      .replace(/^[\s|·._-]+|[\s|·._-]+$/g, '').replace(/\s+/g, ' ').trim() || original;
    // The provider categories keep every regional feed. The virtual channel
    // list also exposes a locality-free family identity so it can prefer the
    // Bahia/Salvador feed without mixing its quality variants with other states.
    const key = normalize(name).replace(/[\[\](){}|·._-]/g, ' ').replace(/\s+/g, ' ').trim();
    return { name, key: key || `stream:${item.stream_id}`, quality, ...channelLocality(name, key || `stream:${item.stream_id}`) };
  }

  function channelCollection(name, familyKey) {
    const key = normalize(name).replace(/[\[\](){}|·._-]/g, ' ').replace(/\s+/g, ' ').trim();
    if (String(familyKey).startsWith('preferred:')) {
      const preferred = { 'preferred:globo': 'TV Bahia', 'preferred:sbt': 'SBT Bahia', 'preferred:record': 'RecordTV Bahia', 'preferred:band': 'Band Bahia' };
      return { key: familyKey, name: preferred[familyKey] || String(name || '').trim(), nested: false, canonical: true };
    }
    for (const [favoriteKey, favoriteName, pattern] of favoriteFamilies) {
      if (pattern.test(key)) return { key: favoriteKey, name: favoriteName, nested: true, multipleOnly: true, canonical: true };
    }
    if (/^a\s+fazenda\b/.test(key)) return { key: 'program:a-fazenda', name: 'A Fazenda', nested: true };
    const camera = /^(.+?)\s+(?:cam(?:era)?|camera)\s*(?:n(?:o|umero)?\s*)?[-#:]?\s*(?:\d+|[a-z]+)\b/.exec(key);
    if (camera?.[1]) {
      const label = String(name || '').slice(0, camera[1].length).replace(/[\s|·._-]+$/g, '').trim();
      return { key: `cameras:${camera[1]}`, name: label || camera[1], nested: true };
    }
    {
      const token = key.split(' ')[0] || '';
      const root = token.replace(/\+$/, '').replace(/\d+$/, '');
      const generic = /^(?:tv|canal|rede|radio|emissora|the|a|o)$/.test(root);
      if (!generic && root.length >= 3) {
        const labels = { fifa: 'FIFA+', disney: 'Disney', hbo: 'HBO', sportv: 'SporTV', espn: 'ESPN', telecine: 'Telecine', premiere: 'Premiere', discovery: 'Discovery', cartoon: 'Cartoon Network', national: 'National Geographic', animal: 'Animal Planet', cinemax: 'Cinemax', paramount: 'Paramount', warner: 'Warner' };
        const originalToken = String(name || '').trim().split(/\s+/)[0] || root;
        const label = labels[root] || originalToken.replace(/\+$/, '').replace(/\d+$/, '') || root;
        return { key: `brand:${root}`, name: label, nested: true, multipleOnly: true };
      }
    }
    return { key: `channel:${familyKey}`, name: String(name || '').trim(), nested: false };
  }

  function timestamp(value) {
    if (value == null || value === '') return 0;
    if (typeof value === 'number' || /^\d+(?:\.\d+)?$/.test(String(value).trim())) {
      const number = Number(value);
      const ms = number < 100_000_000_000 ? number * 1000 : number;
      return Number.isFinite(ms) && ms > 0 && ms < 8_640_000_000_000_000 ? ms : 0;
    }
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:[T ]|$)/.test(value.trim())) return 0;
    let date = value.trim().replace(' ', 'T');
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(date)) date += 'Z';
    const ms = Date.parse(date);
    return Number.isFinite(ms) && ms > 0 ? ms : 0;
  }

  function recentTimestamp(item, section) {
    const fields = section === 'series'
      ? ['added', 'created_at', 'last_modified', 'updated_at', 'last_updated', 'last_episode_added', 'episode_added']
      : ['added', 'added_at', 'created_at', 'date_added'];
    let latest = 0;
    for (const data of [item, item.info]) if (data && typeof data === 'object') for (const key of fields) latest = Math.max(latest, timestamp(data[key]));
    // Some providers include episode metadata in the series list. Use it when
    // present, without issuing one request for every series in the catalog.
    if (section === 'series' && item.episodes && typeof item.episodes === 'object') {
      for (const season of Object.values(item.episodes)) for (const episode of Array.isArray(season) ? season : []) {
        for (const data of [episode, episode?.info]) if (data && typeof data === 'object') for (const key of ['added', 'added_at', 'created_at', 'last_modified', 'updated_at']) latest = Math.max(latest, timestamp(data[key]));
      }
    }
    return latest;
  }

  return { CHANNEL_LIST_CATEGORY, RECENT_CATEGORY, CONTENT_FAVORITES_CATEGORY, MOVIE_RELEASES_CATEGORY, FAVORITES_DEFAULT_NAME, FAVORITES_DEFAULT, initialCategory, categoryLabel, categoryOrder, channelDetails, channelCollection, recentTimestamp, timestamp };
});
