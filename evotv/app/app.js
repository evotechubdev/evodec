import { EvoAuthApi } from './auth-api.js';
import { SHOWS_CATALOG } from './shows-catalog.js';
import { clearLegacyCatalog, normalized } from './catalog-db.js';
import { clearSeriesCatalogCache, episodesForSeries } from './series-catalog-db.js';
import {
  clearProfilePins,
  clearRememberedAuth,
  deleteProfilePin,
  readProfilePin,
  readRememberedAuth,
  saveProfilePin,
  saveRememberedAuth,
} from './device-vault.js';

const PAGE_SIZE = 32;
const MEDIA_BACKEND_URL = 'https://multimideas-evo-backend-app.onrender.com';
const MEDIA_PROXY_ORIGIN = 'https://evotv-offline-media-proxy.evotechubdev.workers.dev';
const MEDIA_SOURCE_HOSTS = new Set(['89.222.120.168:34871', '89.222.120.168:30266']);
const TICKET_TIMEOUT_MS = 45_000;
const SAVED_LOGIN_KEY = 'evo_app_login_v1';
const MOVIE_RELEASES_CATEGORY = 'evo_movie_releases_2026';
const RECENT_CATEGORY = 'evo_recent';
const FAVORITES_CATEGORY = 'evo_content_favorites';
const SHOW_FAVORITES_CATEGORY = 'evo_show_favorites';
const ALL_CATEGORY = 'all';
const LIVE_FAVORITES_CATEGORY = 'evo_channel_list';
const LIVE_MAINTENANCE_CATEGORY = 'evo_live_maintenance';
const api = new EvoAuthApi();

let storedView = 'grid';
try { storedView = localStorage.getItem('evotv-catalog-view') === 'list' ? 'list' : 'grid'; } catch { /* opcional */ }

const state = {
  catalog: null, catalogLoad: null, categories: [], filtered: [],
  page: { offset: 0, hasMore: false, loading: false, generation: 0 }, searchTimer: 0,
  activeSection: 'movies', seriesCatalog: null, liveCatalog: null, showCatalog: SHOWS_CATALOG, activeSeries: null, activeSeriesEpisodes: [], seriesSeason: '', favoriteEpisodesOnly: false,
  selected: null, candidateIndex: 0, ticketController: null, mpegtsPlayer: null, playbackAttempt: 0,
  miniLivePlayers: new Map(), nextMiniLivePlayerId: 0, preserveLiveOnModalClose: false,
  restoreModalAfterPictureInPicture: false,
  liveFavorites: null, adultLiveFavorites: null,
  view: storedView, auth: null, account: null, session: null, pendingProfile: 0,
  busy: false, adultView: false, profileSettings: null, parentalSettings: null,
  parentalMode: 'settings', sessionWatcher: null, noticeTimer: null, rememberDevice: true,
  favorites: new Set(),
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const elements = {
  loginScreen: $('#login-screen'), profileScreen: $('#profile-screen'), appScreen: $('#app-screen'),
  loginForm: $('#login-form'), username: $('#username'), password: $('#password'), rememberLogin: $('#remember-login'),
  loginButton: $('#login-button'), loginError: $('#login-error'), profileGrid: $('#profile-grid'),
  profileUser: $('#profile-user'), profileError: $('#profile-error'), profilePinDialog: $('#profile-pin-dialog'),
  profilePinForm: $('#profile-pin-form'), profilePin: $('#profile-pin'), profilePinTitle: $('#profile-pin-title'),
  profilePinError: $('#profile-pin-error'), rememberProfilePin: $('#remember-profile-pin'), profileSettingsDialog: $('#profile-settings-dialog'),
  profileSettingsList: $('#profile-settings-list'), profileSettingsError: $('#profile-settings-error'),
  parentalDialog: $('#parental-dialog'), parentalTitle: $('#parental-title'), parentalDescription: $('#parental-description'),
  parentalForm: $('#parental-form'), parentalCurrentField: $('#parental-current-field'), parentalPinLabel: $('#parental-pin-label'),
  parentalPin: $('#parental-pin'), parentalOptions: $('#parental-options'), parentalProfiles: $('#parental-profiles'),
  parentalNewPinLabel: $('#parental-new-pin-label'), parentalNewPin: $('#parental-new-pin'),
  parentalError: $('#parental-error'), parentalSubmit: $('#parental-submit'),
  profileSettingsButton: $('#profile-settings'), parentalSettingsButton: $('#parental-settings'),
  switchProfile: $('#switch-profile'), logout: $('#logout-button'), accountType: $('#account-type'), serverLabel: $('#server-label'),
  adultNav: $('#adult-nav'), channelsNav: $('#channels-nav'), moviesNav: $('#movies-nav'), seriesNav: $('#series-nav'), showsNav: $('#shows-nav'), heading: $('#catalog-heading'), kicker: $('#section-kicker'),
  notice: $('#app-notice'), search: $('#catalog-search'), searchLabel: $('.pc-search-box'), category: $('#category-filter'), categoryStrip: $('#category-strip'),
  grid: $('#catalog-grid'), status: $('#app-status'), sentinel: $('#load-sentinel'),
  seriesDialog: $('#series-dialog'), seriesCover: $('#series-cover'), seriesTitle: $('#series-title'),
  seriesPlot: $('#series-plot'), seriesLoading: $('#series-loading'), seasonTabs: $('#season-tabs'), episodeList: $('#episode-list'),
  liveChoiceList: $('#live-choice-list'),
  closeSeries: $('#close-series'), favoriteSeries: $('#favorite-series'), favoriteEpisodesFilter: $('#favorite-episodes-filter'),
  modal: $('#media-modal'), modalTitle: $('#media-title'), modalMeta: $('#media-meta'),
  modalImage: $('#media-image'), modalSynopsis: $('#media-synopsis'), video: $('#media-player'), trailerPlayer: $('#trailer-player'), playerMessage: $('#player-message'),
  mediaKind: $('#media-kind'),
  play: $('#play-media'), trailer: $('#trailer-media'), close: $('#close-modal'), liveNow: $('#live-now'),
  miniLiveDock: $('#live-mini-dock'), viewButtons: $$('[data-view]'),
};

function showScreen(name) {
  elements.loginScreen.hidden = name !== 'login';
  elements.profileScreen.hidden = name !== 'profiles';
  elements.appScreen.hidden = name !== 'app';
}

function readableError(error) {
  if (['LIVE_STREAM_NOT_CONFIGURED', 'LIVE_PROVIDER_NOT_CONFIGURED', 'LIVE_LINK_MAP_UNAVAILABLE', 'LIVE_CHANNEL_LINK_MISSING'].includes(String(error?.message || error))) return 'O link RAUTH deste canal não está disponível no mapa privado do backend.';
  if (String(error?.message || error) === 'SERVICE_NOT_CONFIGURED') return 'O backend do app ainda não concluiu a configuração de mídia.';
  return String(error?.message || error || 'Não foi possível concluir a operação.').replace(/\bIPTV\b/gi, 'TV');
}

function setBusy(value) {
  state.busy = value;
  elements.loginButton.disabled = value;
  elements.profileGrid.querySelectorAll('button').forEach(button => { button.disabled = value; });
}

function notice(message) {
  window.clearTimeout(state.noticeTimer);
  elements.notice.textContent = message;
  elements.notice.hidden = false;
  state.noticeTimer = window.setTimeout(() => { elements.notice.hidden = true; }, 7000);
}

async function persistAuthOnDevice() {
  if (!state.rememberDevice || !state.auth) return;
  try { await saveRememberedAuth(state.auth); }
  catch { notice('Este navegador não disponibilizou o cofre protegido. O acesso será pedido novamente ao reabrir.'); }
}

async function forgetDevice(login = state.auth?.login || elements.username.value) {
  await clearRememberedAuth().catch(() => {});
  await clearProfilePins(login).catch(() => {});
  try { localStorage.removeItem(SAVED_LOGIN_KEY); } catch { /* opcional */ }
}

const profileName = (profile) => state.account?.profileNames?.[profile - 1]?.trim() || `Perfil ${profile}`;
const validParentalPin = (value) => /^\d{4,8}$/.test(value);
const isAdultCategory = (category) => /(^|\s)(adultos?|hentai|18)(\s|$)/.test(normalized(category?.category_name));
const isReleaseCategory = (category) => normalized(category?.category_name).replace(/[^a-z0-9]+/g, ' ').trim() === 'filmes lancamentos 2026';

function accountFingerprint(value) {
  let hash = 2166136261;
  for (const character of String(value || '').trim().toLowerCase()) {
    hash ^= character.codePointAt(0); hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function favoriteStorageKey() {
  const profile = Number(state.session?.profile || 0);
  return state.auth?.login && profile ? `evo:content-favorites:v1:${accountFingerprint(state.auth.login)}:profile:${profile}` : '';
}

function loadFavorites() {
  state.favorites = new Set();
  const key = favoriteStorageKey();
  if (!key) return;
  try {
    const parsed = JSON.parse(localStorage.getItem(key));
    if (parsed?.version === 1 && Array.isArray(parsed.items)) {
      state.favorites = new Set(parsed.items.map(String).filter(value => /^(?:\d{1,20}|series:\d{1,20}|(?:adult-)?episode:\d{1,20})$/.test(value)).slice(0, 1000));
    }
  } catch { /* favoritos são opcionais */ }
}

function saveFavorites() {
  const key = favoriteStorageKey();
  if (!key) return;
  try { localStorage.setItem(key, JSON.stringify({ version: 1, items: [...state.favorites] })); } catch { /* opcional */ }
}

function toggleFavorite(item) {
  const id = item?.episode_id != null
    ? `${state.adultView ? 'adult-' : ''}episode:${item.episode_id}`
    : item?.kind === 'series' ? `series:${item.series_id}` : String(item?.stream_id || '');
  if (!/^(?:\d{1,20}|series:\d{1,20}|(?:adult-)?episode:\d{1,20})$/.test(id)) return;
  if (state.favorites.has(id)) state.favorites.delete(id); else state.favorites.add(id);
  saveFavorites();
  if (elements.category.value === FAVORITES_CATEGORY
    || (state.activeSection === 'shows' && elements.category.value === SHOW_FAVORITES_CATEGORY)) applyFilters();
  else renderGrid();
}

function liveFavoritesStorageKey(adult = state.adultView) {
  const profile = Number(state.session?.profile || 0);
  if (!state.auth?.login || !profile) return '';
  const scope = adult ? 'adult-channel-favorites' : 'channel-favorites';
  return `evo:${scope}:v1:${accountFingerprint(state.auth.login)}:profile:${profile}`;
}

function cleanLiveFavoriteIds(items) {
  return [...new Set((Array.isArray(items) ? items : []).map(String).filter(id => /^\d{1,20}$/.test(id)))].slice(0, 1500);
}

function selectedLiveFavorites() {
  return state.adultView ? state.adultLiveFavorites : state.liveFavorites;
}

function setSelectedLiveFavorites(items) {
  const list = cleanLiveFavoriteIds(items);
  if (state.adultView) state.adultLiveFavorites = list;
  else state.liveFavorites = list;
  const key = liveFavoritesStorageKey();
  if (key) try { localStorage.setItem(key, JSON.stringify({ version: 1, items: list })); } catch { /* optional */ }
  return list;
}

function loadLiveFavorites() {
  for (const adult of [false, true]) {
    const key = liveFavoritesStorageKey(adult);
    let value = null;
    try {
      const parsed = key ? JSON.parse(localStorage.getItem(key)) : null;
      if (parsed?.version === 1 && Array.isArray(parsed.items)) value = cleanLiveFavoriteIds(parsed.items);
    } catch { /* favoritos sÃ£o opcionais */ }
    if (adult) state.adultLiveFavorites = value;
    else state.liveFavorites = value;
  }
}

function toggleLiveFavorite(item) {
  const id = String(item?.stream_id || '');
  if (!/^\d{1,20}$/.test(id)) return;
  const items = [...(selectedLiveFavorites() || [])];
  const index = items.indexOf(id);
  if (index >= 0) items.splice(index, 1);
  else items.push(id);
  setSelectedLiveFavorites(items);
  if (state.activeSection === 'live' && elements.category.value === LIVE_FAVORITES_CATEGORY) applyFilters();
  else renderGrid();
}

function moveLiveFavorite(id, offset) {
  const items = [...(selectedLiveFavorites() || [])];
  const from = items.indexOf(String(id));
  const to = from + Math.sign(Number(offset) || 0);
  if (from < 0 || to < 0 || to >= items.length) return;
  [items[from], items[to]] = [items[to], items[from]];
  setSelectedLiveFavorites(items);
  applyFilters();
}

function isEpisodeFavorite(episode) {
  return state.favorites.has(`${state.adultView ? 'adult-' : ''}episode:${episode.episode_id}`);
}

function synopsisFrom(item = {}) {
  return String(item.plot || item.description || item.overview || item.info?.plot || item.info?.description
    || item.movie_data?.plot || item.movie_data?.description || '').trim()
    || 'Sinopse não informada neste catálogo.';
}

function trailerFrom(item = {}) {
  const value = String(item.youtube_trailer || item.trailer || item.trailer_url || item.youtubeTrailer
    || item.info?.youtube_trailer || item.info?.trailer || item.movie_data?.youtube_trailer || '').trim();
  if (/^[a-zA-Z0-9_-]{6,20}$/.test(value)) return `https://www.youtube.com/watch?v=${encodeURIComponent(value)}`;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') throw new Error('TRAILER_INVALID');
    if (['youtu.be', 'www.youtu.be'].includes(url.hostname)) {
      const id = url.pathname.split('/').filter(Boolean)[0] || '';
      if (/^[a-zA-Z0-9_-]{6,20}$/.test(id)) return `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`;
    } else if (['youtube.com', 'www.youtube.com', 'm.youtube.com', 'www.youtube-nocookie.com'].includes(url.hostname)) {
      const id = url.searchParams.get('v')
        || (/^\/(?:embed|shorts|live)\/([^/]+)/.exec(url.pathname)?.[1] || '');
      if (/^[a-zA-Z0-9_-]{6,20}$/.test(id)) return `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`;
    }
  } catch { /* sem ID de vídeo não há link direto confiável */ }
  return '';
}

function safeImage(value) {
  try {
    const url = new URL(String(value || ''), location.href);
    return url.protocol === 'https:' ? url.href : '';
  } catch { return ''; }
}

function mediaSourceTarget(value) {
  try {
    const url = new URL(String(value || ''));
    if (url.protocol !== 'http:' || !MEDIA_SOURCE_HOSTS.has(url.host.toLowerCase())
      || url.username || url.password || url.search || url.hash
      || !['/s3v3/', '/1-filmes/'].some(prefix => url.pathname.startsWith(prefix))) return '';
    return url.href;
  } catch { return ''; }
}

function mediaCandidates(item) {
  if (item.kind === 'live') return /^\d{1,20}$/.test(String(item.stream_id || '')) ? [`live:${item.stream_id}`] : [];
  if (item.kind === 'show') return /^\d{1,20}$/.test(String(item.stream_id || '')) ? [`show:${item.stream_id}`] : [];
  const candidates = [];
  const direct = mediaSourceTarget(item.url_final);
  if (direct) candidates.push(direct);
  const extension = String(item.container_extension || 'mp4').replace(/[^a-z0-9]/gi, '') || 'mp4';
  const id = String(item.stream_id || '');
  const sourcePatterns = item.kind === 'series' ? state.seriesCatalog?.patterns || [] : state.catalog?.patterns || [];
  const patterns = [...sourcePatterns].sort((left, right) => {
    if (left.id === item.url_padrao) return -1;
    if (right.id === item.url_padrao) return 1;
    return Number(right.count || 0) - Number(left.count || 0);
  });
  for (const pattern of patterns) {
    if (!pattern.template.includes('{id}')) continue;
    const url = pattern.template.replaceAll('{id}', id).replaceAll('{ext}', extension);
    const target = mediaSourceTarget(url);
    if (target && !candidates.includes(target)) candidates.push(target);
  }
  return candidates;
}

function renderCategoryFilters() {
  if (state.activeSection === 'live') {
    if (!state.liveCatalog) return;
    const source = state.liveCatalog.categories.filter(category =>
      String(category.category_id) === LIVE_MAINTENANCE_CATEGORY
      || isAdultCategory(category) === state.adultView);
    const categories = [
      { category_id: LIVE_FAVORITES_CATEGORY, category_name: 'Canais Favoritos' },
      { category_id: ALL_CATEGORY, category_name: state.adultView ? 'Todos os canais adultos' : 'Todos os canais' },
      ...source,
    ];
    const previous = elements.category.value;
    elements.category.replaceChildren(...categories.map(category => {
      const option = document.createElement('option'); option.value = String(category.category_id); option.textContent = category.category_name; return option;
    }));
    elements.category.value = categories.some(category => String(category.category_id) === previous)
      ? previous : state.adultView ? ALL_CATEGORY : LIVE_FAVORITES_CATEGORY;
    if (selectedLiveFavorites() === null) elements.category.value = LIVE_FAVORITES_CATEGORY;
    elements.categoryStrip.replaceChildren(...categories.map(category => {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'pc-category-button';
      button.dataset.category = String(category.category_id); button.textContent = category.category_name;
      button.addEventListener('click', () => { elements.category.value = button.dataset.category; applyFilters(); });
      return button;
    }));
    return;
  }
  if (state.activeSection === 'shows') {
    if (!state.showCatalog) return;
    const categories = [
      ...state.showCatalog.categories.filter(category => isAdultCategory(category) === state.adultView),
      { category_id: SHOW_FAVORITES_CATEGORY, category_name: 'Shows Favoritos' },
    ];
    const previous = elements.category.value;
    elements.category.replaceChildren(...categories.map(category => {
      const option = document.createElement('option');
      option.value = String(category.evo_show_category_key || category.category_id);
      option.textContent = category.category_name || 'Shows';
      return option;
    }));
    elements.category.value = categories.some(category => String(category.evo_show_category_key || category.category_id) === previous)
      ? previous : String(categories[0]?.evo_show_category_key || categories[0]?.category_id || '');
    elements.categoryStrip.replaceChildren(...categories.map(category => {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'pc-category-button';
      button.dataset.category = String(category.evo_show_category_key || category.category_id);
      button.textContent = category.category_name || 'Shows';
      button.addEventListener('click', () => { elements.category.value = button.dataset.category; applyFilters(); });
      return button;
    }));
    return;
  }
  if (state.activeSection === 'series') {
    if (!state.seriesCatalog) return;
    const source = state.seriesCatalog.categories.filter(category => isAdultCategory(category) === state.adultView);
    const categories = [
      { category_id: RECENT_CATEGORY, category_name: 'Recém Adicionadas' },
      { category_id: ALL_CATEGORY, category_name: state.adultView ? 'Todas as séries adultas' : 'Todas as séries' },
      { category_id: FAVORITES_CATEGORY, category_name: state.adultView ? 'Favoritas adultas' : 'Favoritas' },
      ...source,
    ];
    elements.category.replaceChildren(...categories.map(category => {
      const option = document.createElement('option'); option.value = String(category.category_id); option.textContent = category.category_name; return option;
    }));
    elements.category.value = RECENT_CATEGORY;
    elements.categoryStrip.replaceChildren(...categories.map(category => {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'pc-category-button';
      button.dataset.category = String(category.category_id); button.textContent = category.category_name;
      button.addEventListener('click', () => { elements.category.value = button.dataset.category; applyFilters(); });
      return button;
    }));
    return;
  }
  if (!state.catalog) return;
  const sourceCategories = state.categories.filter(category => isAdultCategory(category) === state.adultView);
  const categories = state.adultView
    ? [{ category_id: FAVORITES_CATEGORY, category_name: 'Favoritos Adultos' }, { category_id: RECENT_CATEGORY, category_name: 'Recém Adicionados' }, { category_id: ALL_CATEGORY, category_name: 'Todos' }, ...sourceCategories]
    : [
      { category_id: MOVIE_RELEASES_CATEGORY, category_name: 'Filmes | Lançamentos 2026' },
      { category_id: RECENT_CATEGORY, category_name: 'Recém Adicionados' },
      { category_id: FAVORITES_CATEGORY, category_name: 'Favoritos' },
      { category_id: ALL_CATEGORY, category_name: 'Todos' },
      ...sourceCategories.filter(category => !isReleaseCategory(category)),
    ];
  elements.category.replaceChildren();
  elements.category.append(...categories.map((category) => {
    const option = document.createElement('option'); option.value = String(category.category_id || '');
    option.textContent = category.category_name || 'Sem nome'; return option;
  }));
  elements.category.value = state.adultView ? RECENT_CATEGORY : MOVIE_RELEASES_CATEGORY;
  elements.categoryStrip.replaceChildren(...categories.map((category) => {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'pc-category-button';
    button.dataset.category = String(category.category_id || ''); button.textContent = category.category_name || 'Sem nome';
    button.addEventListener('click', () => { elements.category.value = button.dataset.category; applyFilters(); });
    return button;
  }));
}

function applyFilters() {
  if (!state.session || (state.activeSection === 'movies' && !state.catalog)
    || (state.activeSection === 'series' && !state.seriesCatalog)
    || (state.activeSection === 'shows' && !state.showCatalog)
    || (state.activeSection === 'live' && !state.liveCatalog)) return;
  const generation = ++state.page.generation;
  state.page.offset = 0; state.page.hasMore = false; state.page.loading = false;
  state.filtered = [];
  elements.grid.replaceChildren();
  elements.status.textContent = ''; elements.status.parentElement.hidden = true; elements.status.classList.remove('error');
  const category = elements.category.value;
  elements.categoryStrip.querySelectorAll('[data-category]').forEach(button => button.classList.toggle('active', button.dataset.category === category));
  renderGrid();
  void loadCatalogPage(generation, true);
}

function renderGrid() {
  const items = state.filtered;
  elements.grid.classList.toggle('list-view', state.view === 'list');
  elements.grid.replaceChildren(...items.map((item) => {
    const card = document.createElement('article'); card.className = 'catalog-card'; card.tabIndex = 0; card.setAttribute('role', 'button');
    card.setAttribute('aria-label', `Abrir ${item.name || (item.kind === 'series' ? 'série' : 'filme')}`); card.addEventListener('click', () => openItem(item));
    card.addEventListener('keydown', (event) => {
      if (event.target === card && ['Enter', ' '].includes(event.key)) { event.preventDefault(); openItem(item); }
    });
    const poster = document.createElement('span'); poster.className = 'catalog-poster';
    const image = document.createElement('img'); image.loading = 'lazy'; image.decoding = 'async'; image.alt = '';
    image.src = safeImage(item.stream_icon) || './assets/poster-placeholder.svg';
    image.addEventListener('error', () => {
      image.src = item.evo_show_kind ? './assets/fallback-shows.png' : './assets/poster-placeholder.svg';
    }, { once: true });
    const play = document.createElement('span'); play.className = 'poster-play'; poster.append(image, play);
    const copy = document.createElement('span'); copy.className = 'catalog-card-copy';
    const title = document.createElement('strong'); title.textContent = item.name || 'Sem título';
    const titleRow = document.createElement('span'); titleRow.className = 'catalog-title-row';
    const actions = document.createElement('span'); actions.className = 'catalog-title-actions';
    const favorite = document.createElement('button'); favorite.type = 'button'; favorite.className = 'content-favorite-toggle';
    const favoriteId = item.kind === 'series' ? `series:${item.series_id}` : String(item.stream_id || '');
    const channelFavorites = item.kind === 'live' ? selectedLiveFavorites() || [] : null;
    const active = item.kind === 'live' ? channelFavorites.includes(favoriteId) : state.favorites.has(favoriteId);
    favorite.classList.toggle('active', active);
    favorite.textContent = active ? '★' : '☆'; favorite.title = active ? 'Desfavoritar' : 'Favoritar';
    favorite.setAttribute('aria-label', `${favorite.title}: ${item.name || 'filme'}`); favorite.setAttribute('aria-pressed', String(active));
    favorite.addEventListener('click', (event) => {
      event.stopPropagation();
      if (item.kind === 'live') toggleLiveFavorite(item); else toggleFavorite(item);
    });
    actions.append(favorite);
    if (item.kind === 'live' && elements.category.value === LIVE_FAVORITES_CATEGORY) {
      for (const [offset, label, glyph] of [[-1, 'Mover canal para cima', '↑'], [1, 'Mover canal para baixo', '↓']]) {
        const move = document.createElement('button'); move.type = 'button'; move.className = 'channel-favorite-move';
        move.textContent = glyph; move.title = label; move.setAttribute('aria-label', `${label}: ${item.name || 'canal'}`);
        move.addEventListener('click', event => { event.stopPropagation(); moveLiveFavorite(favoriteId, offset); });
        actions.append(move);
      }
    }
    if (!['series', 'live'].includes(item.kind) && String(state.session?.accountType || state.account?.accountType || '').toUpperCase() === 'PREMIUM') {
      const download = document.createElement('button'); download.type = 'button'; download.className = 'content-download';
      download.title = 'Baixar filme · PREMIUM'; download.setAttribute('aria-label', `Baixar ${item.name || 'filme'}`);
      download.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 3h2v10.17l3.59-3.58L18 11l-6 6-6-6 1.41-1.41L11 13.17V3ZM5 19h14v2H5v-2Z"/></svg>';
      if (item.kind === 'show') {
        download.title = 'Baixar show PREMIUM';
        download.setAttribute('aria-label', `Baixar show: ${item.name || ''}`);
      }
      download.addEventListener('click', (event) => { event.stopPropagation(); void downloadItem(item, download); });
      actions.append(download);
    }
    titleRow.append(title, actions);
    const meta = document.createElement('small'); meta.textContent = item.kind === 'series'
      ? `${item.category_name || 'Série'} · ${item.mappedEpisodeCount} episódios`
      : item.kind === 'live' ? (item.category_name || 'Canal')
        : item.category_name || 'Filme'; copy.append(titleRow, meta);
    card.append(poster, copy); return card;
  }));
  elements.sentinel.hidden = !state.page.hasMore;
}

async function loadCatalogPage(generation = state.page.generation, firstPage = false) {
  if (state.page.loading || (!firstPage && !state.page.hasMore)) return;
  const section = state.activeSection;
  const auth = state.auth;
  const offset = firstPage ? 0 : state.page.offset;
  const params = {
    offset, limit: PAGE_SIZE, query: elements.search.value.trim(), category: elements.category.value,
    adult: state.adultView, favoriteIds: state.favorites, liveFavoriteIds: selectedLiveFavorites(),
  };
  state.page.loading = true; renderGrid();
  try {
    let page;
    if (section === 'shows') page = showsCatalogPage(params);
    else {
      const idToken = await api.currentToken(auth);
      page = section === 'series' ? await seriesCatalogPage(idToken, params)
        : section === 'live' ? await liveCatalogPage(idToken, params)
          : await movieCatalogPage(idToken, params);
    }
    if (generation !== state.page.generation || section !== state.activeSection || auth !== state.auth) return;
    if (section === 'series') {
      page.items = page.items.map(item => ({ ...item, kind: 'series', stream_id: String(item.series_id), stream_icon: item.cover || '', mappedEpisodeCount: Number(item.mappedEpisodeCount || 0) }));
    } else if (section === 'live') {
      page.items = page.items.map(item => ({ ...item, kind: 'live', stream_id: String(item.stream_id) }));
    } else if (section === 'shows') {
      page.items = page.items.map(item => ({ ...item, kind: 'show', stream_id: String(item.stream_id) }));
    }
    state.filtered.push(...page.items);
    state.page.offset = offset + page.items.length;
    state.page.hasMore = Boolean(page.hasMore);
    elements.status.textContent = ''; elements.status.parentElement.hidden = true; elements.status.classList.remove('error');
  } catch (error) {
    if (generation !== state.page.generation) return;
    elements.status.textContent = `Nao foi possivel carregar conteudos (${readableError(error)}).`;
    elements.status.parentElement.hidden = false; elements.status.classList.add('error');
    if (firstPage) state.page.hasMore = false;
  } finally {
    if (generation === state.page.generation) { state.page.loading = false; renderGrid(); }
  }
}

function seriesCatalogPage(idToken, params) {
  return fetchCatalogPage('/api/catalog/series/page', idToken, params);
}

function movieCatalogPage(idToken, params) {
  return fetchCatalogPage('/api/catalog/movies/page', idToken, params);
}

function liveCatalogPage(idToken, params) {
  return fetchCatalogPage('/api/catalog/live/page', idToken, params);
}

function showsCatalogPage(params) {
  const categories = state.showCatalog.categories.filter(category => isAdultCategory(category) === params.adult);
  const allowed = new Set(categories.map(category => String(category.evo_show_category_key)));
  const query = normalized(params.query);
  const filtered = state.showCatalog.items.filter(item => {
    const key = String(item.evo_show_category_key || '');
    const inFavorites = state.favorites.has(String(item.stream_id || ''));
    const categoryMatch = params.category === SHOW_FAVORITES_CATEGORY
      ? inFavorites : params.category === ALL_CATEGORY || key === params.category;
    return allowed.has(key) && categoryMatch
      && (!query || normalized(item.name).includes(query));
  });
  const items = filtered.slice(params.offset, params.offset + params.limit);
  return { items, categories, offset: params.offset, limit: params.limit, hasMore: params.offset + items.length < filtered.length };
}

async function fetchCatalogPage(path, idToken, params) {
  const search = new URLSearchParams({
    offset: String(params.offset), limit: String(params.limit), q: params.query,
    category: params.category, adult: params.adult ? '1' : '0',
  });
  if (params.category === FAVORITES_CATEGORY && params.favoriteIds?.size) {
    search.set('favorites', [...params.favoriteIds].filter(id => /^\d{1,20}$/.test(id) || /^series:\d{1,20}$/.test(id)).join(','));
  }
  if (path === '/api/catalog/live/page' && params.category === LIVE_FAVORITES_CATEGORY
    && params.liveFavoriteIds !== null) {
    search.set('favorites', cleanLiveFavoriteIds(params.liveFavoriteIds).join(','));
  }
  if (path === '/api/catalog/live/page' && params.category === LIVE_FAVORITES_CATEGORY
    && params.liveFavoriteIds === null && params.favoriteIds?.size) {
    search.set('legacy_favorites', [...params.favoriteIds].filter(id => /^\d{1,20}$/.test(id)).join(','));
  }
  const response = await fetch(`${MEDIA_BACKEND_URL}${path}?${search}`, {
    headers: { authorization: `Bearer ${idToken}`, accept: 'application/json' }, credentials: 'omit', cache: 'no-store',
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(String(data?.error || `Falha no catalogo (${response.status}).`));
  if (!Array.isArray(data.items)) throw new Error('Resposta de pagina do catalogo invalida.');
  return data;
}

function openItem(item) {
  if (!state.session) return;
  if (item.kind === 'live') { openLiveChannel(item); return; }
  if (item.kind === 'series') { void openSeries(item); return; }
  stopPlayback(); state.selected = item; state.candidateIndex = 0;
  state.activeSeries = null; state.activeSeriesEpisodes = []; state.seriesSeason = ''; state.favoriteEpisodesOnly = false;
  elements.mediaKind.textContent = item.kind === 'show' ? 'SHOW' : 'FILME';
  elements.modalTitle.textContent = item.name || 'Sem título';
  elements.play.textContent = 'Reproduzir';
  elements.modalMeta.textContent = item.category_name || (item.kind === 'show' ? 'Shows' : 'Filme');
  elements.modalSynopsis.hidden = false;
  elements.modalSynopsis.textContent = synopsisFrom(item);
  elements.modalImage.src = safeImage(item.stream_icon) || './assets/poster-placeholder.svg';
  elements.playerMessage.textContent = '';
  const hasTrailer = item.kind !== 'show' && Boolean(trailerFrom(item));
  elements.trailer.dataset.url = hasTrailer ? trailerFrom(item) : '';
  elements.trailer.hidden = item.kind === 'show';
  elements.trailer.disabled = !hasTrailer;
  elements.trailer.classList.toggle('has-trailer', hasTrailer);
  elements.video.removeAttribute('src'); elements.video.load(); elements.video.hidden = true; elements.play.hidden = false;
  elements.modal.showModal();
}

function openLiveChannel(item) {
  const currentVideo = elements.video;
  if (state.selected?.kind === 'live' && state.mpegtsPlayer
    && document.pictureInPictureElement === currentVideo) {
    state.restoreModalAfterPictureInPicture = false;
    detachLivePlaybackToDock();
    if (document.pictureInPictureElement === currentVideo) {
      void document.exitPictureInPicture().catch(() => {});
    }
  }
  stopPlayback();
  if (elements.seriesDialog.open) closeSeriesDetails();
  state.selected = { ...item, kind: 'live' };
  state.candidateIndex = 0;
  elements.mediaKind.textContent = 'CANAL AO VIVO';
  elements.modalTitle.textContent = item.name || 'Canal';
  elements.modalMeta.textContent = item.category_name || 'Televisão ao vivo';
  elements.modalSynopsis.textContent = '';
  elements.modalSynopsis.hidden = true;
  elements.modalImage.src = safeImage(item.stream_icon) || './assets/poster-placeholder.svg';
  elements.playerMessage.textContent = '';
  elements.trailer.dataset.url = '';
  elements.trailer.hidden = true;
  elements.trailer.disabled = true;
  elements.trailer.classList.remove('has-trailer');
  elements.liveChoiceList.replaceChildren();
  const choices = Array.isArray(item.evo_live_choices) ? item.evo_live_choices : [];
  if (choices.length > 1) {
    elements.modalSynopsis.hidden = false;
    elements.modalSynopsis.textContent = 'Escolha o canal que deseja assistir.';
    elements.liveChoiceList.hidden = false;
    elements.play.hidden = true;
    choices.forEach((choice, index) => {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'live-choice-button';
      const title = document.createElement('strong'); title.textContent = choice.name || `Canal ${index + 1}`;
      const detail = document.createElement('small'); detail.textContent = liveQualityNames(choice.evo_live_variants) || 'Qualidade padrão';
      button.append(title, detail);
      button.addEventListener('click', () => openLiveChannel(choice));
      elements.liveChoiceList.append(button);
    });
    elements.video.hidden = true;
    if (!elements.modal.open) elements.modal.showModal();
    return;
  }
  elements.liveChoiceList.hidden = true;
  elements.video.removeAttribute('src');
  elements.video.load();
  elements.video.hidden = false;
  elements.play.hidden = true;
  elements.play.textContent = 'Assistir ao vivo';
  if (!elements.modal.open) elements.modal.showModal();
  void tryCandidate();
}

function liveQualityNames(variants = []) {
  const labels = ['Padrão', 'SD', 'HD', 'FHD', '4K', '8K'];
  return [...new Set(variants.map(item => labels[Number(item.quality)] || 'Padrão'))].join(' · ');
}

function syncSeriesFavoriteControls() {
  const series = state.activeSeries;
  const seriesFavorite = Boolean(series && state.favorites.has(`series:${series.series_id}`));
  elements.favoriteSeries.textContent = seriesFavorite ? '★ Série favoritada' : '☆ Favoritar série';
  elements.favoriteSeries.classList.toggle('active', seriesFavorite);
  elements.favoriteSeries.setAttribute('aria-pressed', String(seriesFavorite));
  elements.favoriteEpisodesFilter.classList.toggle('active', state.favoriteEpisodesOnly);
  elements.favoriteEpisodesFilter.setAttribute('aria-pressed', String(state.favoriteEpisodesOnly));
}

async function openSeries(series) {
  if (!state.session || !state.seriesCatalog) return;
  stopPlayback();
  state.selected = null;
  state.activeSeries = series;
  state.activeSeriesEpisodes = [];
  state.seriesSeason = '';
  state.favoriteEpisodesOnly = false;
  elements.seriesTitle.textContent = series.name || 'Série';
  elements.seriesCover.src = safeImage(series.cover) || './assets/poster-placeholder.svg';
  elements.seriesCover.classList.toggle('hidden', !safeImage(series.cover));
  elements.seriesPlot.textContent = synopsisFrom(series);
  elements.seriesLoading.hidden = false;
  elements.seriesLoading.textContent = 'Carregando temporadas...';
  elements.seasonTabs.replaceChildren();
  elements.episodeList.replaceChildren();
  syncSeriesFavoriteControls();
  elements.seriesDialog.showModal();

  try {
    const idToken = await api.currentToken(state.auth);
    const episodes = await episodesForSeries(state.seriesCatalog, series, idToken);
    if (!elements.seriesDialog.open || state.activeSeries !== series) return;
    state.activeSeriesEpisodes = episodes;
    renderSeriesDetails();
  } catch (error) {
    if (!elements.seriesDialog.open || state.activeSeries !== series) return;
    elements.seriesLoading.hidden = false;
    elements.seriesLoading.textContent = `Não foi possível carregar os episódios (${readableError(error)}).`;
  }
}

function renderSeriesDetails() {
  const seasons = [...new Set(state.activeSeriesEpisodes.map(episode => String(episode.season || '1')))]
    .sort((left, right) => (Number(left) || 0) - (Number(right) || 0) || left.localeCompare(right, 'pt-BR'));
  if (!seasons.length) {
    elements.seriesLoading.hidden = false;
    elements.seriesLoading.textContent = 'Nenhum episódio disponível para esta série.';
    elements.seasonTabs.replaceChildren();
    elements.episodeList.replaceChildren();
    return;
  }

  elements.seriesLoading.hidden = true;
  elements.seasonTabs.replaceChildren(...seasons.map((season, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `season-button${index === 0 ? ' active' : ''}`;
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-selected', String(index === 0));
    button.textContent = Number(season) === 0 ? 'Especiais' : `Temporada ${season}`;
    button.addEventListener('click', () => {
      elements.seasonTabs.querySelectorAll('.season-button').forEach(tab => {
        const active = tab === button;
        tab.classList.toggle('active', active);
        tab.setAttribute('aria-selected', String(active));
      });
      renderEpisodes(season);
    });
    return button;
  }));
  state.seriesSeason = seasons[0];
  renderEpisodes(seasons[0]);
}

function renderEpisodes(season = state.seriesSeason) {
  state.seriesSeason = String(season || '1');
  const episodes = state.activeSeriesEpisodes
    .filter(episode => String(episode.season || '1') === state.seriesSeason)
    .sort((left, right) => (Number(left.episode_num) || 0) - (Number(right.episode_num) || 0)
      || String(left.title || '').localeCompare(String(right.title || ''), 'pt-BR'))
    .filter(episode => !state.favoriteEpisodesOnly || isEpisodeFavorite(episode));

  elements.episodeList.replaceChildren(...episodes.map((episode, index) => {
    const number = String(episode.episode_num || index + 1);
    const row = document.createElement('div');
    row.className = 'episode-row';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'episode-button';
    const badge = document.createElement('span');
    badge.className = 'episode-number';
    badge.textContent = `E${number.padStart(2, '0')}`;
    const info = document.createElement('span');
    info.className = 'episode-info';
    const heading = document.createElement('strong');
    heading.textContent = episode.title || `Episódio ${number}`;
    const meta = document.createElement('small');
    meta.textContent = `Temporada ${state.seriesSeason}`;
    const play = document.createElement('span');
    play.className = 'episode-play';
    play.setAttribute('aria-hidden', 'true');
    info.append(heading, meta);
    button.append(badge, info, play);
    button.setAttribute('aria-label', `Reproduzir temporada ${state.seriesSeason}, episódio ${number}: ${heading.textContent}`);
    button.addEventListener('click', () => openSeriesEpisode(episode));

    const actions = document.createElement('span');
    actions.className = 'episode-actions';
    if (String(state.session?.accountType || state.account?.accountType || '').toUpperCase() === 'PREMIUM') {
      const download = document.createElement('button');
      download.type = 'button';
      download.className = 'content-download episode-download';
      download.title = 'Baixar episódio · PREMIUM';
      download.setAttribute('aria-label', `Baixar ${heading.textContent}`);
      download.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 3h2v10.17l3.59-3.58L18 11l-6 6-6-6 1.41-1.41L11 13.17V3ZM5 19h14v2H5v-2Z"/></svg>';
      download.addEventListener('click', () => { void downloadItem({ ...episode, kind: 'series', name: heading.textContent }, download); });
      actions.append(download);
    }
    const favorite = document.createElement('button');
    favorite.type = 'button';
    favorite.className = 'episode-favorite-toggle';
    const active = isEpisodeFavorite(episode);
    favorite.textContent = active ? '★' : '☆';
    favorite.classList.toggle('active', active);
    favorite.setAttribute('aria-label', active ? 'Desfavoritar episódio' : 'Favoritar episódio');
    favorite.setAttribute('aria-pressed', String(active));
    favorite.addEventListener('click', () => {
      toggleFavorite({ ...episode, episode_id: episode.episode_id });
      syncSeriesFavoriteControls();
      renderEpisodes(state.seriesSeason);
    });
    actions.append(favorite);
    row.append(button, actions);
    return row;
  }));
  if (!episodes.length && state.favoriteEpisodesOnly) {
    const empty = document.createElement('p');
    empty.className = 'series-empty';
    empty.textContent = 'Nenhum episódio favoritado nesta temporada.';
    elements.episodeList.append(empty);
  }
}

function openSeriesEpisode(episode) {
  const series = state.activeSeries;
  if (!series) return;
  const episodeTitle = episode.title || `Episódio ${episode.episode_num}`;
  state.selected = {
    ...episode,
    kind: 'series',
    name: series.name || episode.series_name || episodeTitle,
    cover: series.cover,
    plot: series.plot,
    seriesName: series.name || episode.series_name || 'Série',
  };
  state.candidateIndex = 0;
  closeSeriesDetails();
  stopPlayback();
  elements.mediaKind.textContent = 'SÉRIE';
  elements.modalTitle.textContent = state.selected.seriesName;
  elements.modalMeta.textContent = `Temporada ${episode.season} · Episódio ${episode.episode_num}`;
  elements.modalSynopsis.hidden = false;
  elements.modalSynopsis.textContent = synopsisFrom(series);
  elements.modalImage.src = safeImage(series.cover) || './assets/poster-placeholder.svg';
  elements.playerMessage.textContent = '';
  elements.trailer.dataset.url = trailerFrom(series);
  elements.trailer.hidden = false;
  elements.trailer.disabled = !elements.trailer.dataset.url;
  elements.trailer.classList.toggle('has-trailer', Boolean(elements.trailer.dataset.url));
  elements.video.removeAttribute('src');
  elements.video.load();
  elements.video.hidden = true;
  elements.play.hidden = false;
  elements.play.textContent = `Reproduzir episódio ${episode.episode_num}`;
  elements.modal.showModal();
  void tryCandidate();
}

function closeSeriesDetails() {
  if (elements.seriesDialog.open) elements.seriesDialog.close();
  state.activeSeries = null;
  state.activeSeriesEpisodes = [];
  state.seriesSeason = '';
  state.favoriteEpisodesOnly = false;
}

function stopPlayback() {
  state.playbackAttempt += 1; state.ticketController?.abort(); state.ticketController = null;
  state.restoreModalAfterPictureInPicture = false;
  if (document.pictureInPictureElement === elements.video) {
    void document.exitPictureInPicture().catch(() => {});
  }
  elements.liveNow.hidden = true;
  elements.liveNow.classList.remove('is-live');
  elements.liveNow.setAttribute('aria-pressed', 'false');
  if (state.mpegtsPlayer) {
    try { state.mpegtsPlayer.pause(); state.mpegtsPlayer.unload(); state.mpegtsPlayer.detachMediaElement(); state.mpegtsPlayer.destroy(); } catch { /* player already stopped */ }
    state.mpegtsPlayer = null;
  }
  elements.video.pause(); elements.video.removeAttribute('src'); elements.video.load();
  elements.trailerPlayer.removeAttribute('src'); elements.trailerPlayer.hidden = true;
}

function liveVideoRange(video) {
  for (const ranges of [video.buffered, video.seekable]) {
    if (ranges.length) {
      const index = ranges.length - 1;
      return { start: ranges.start(index), end: ranges.end(index) };
    }
  }
  return null;
}

function updateLiveNowButton(video, button) {
  const range = liveVideoRange(video);
  const isLive = Boolean(range && range.end - video.currentTime <= 8);
  button.classList.toggle('is-live', isLive);
  button.setAttribute('aria-pressed', String(isLive));
}

function seekVideoToLive(video, button) {
  const range = liveVideoRange(video);
  if (!range) return;
  try {
    video.currentTime = Math.max(range.start, range.end - 0.25);
    button.classList.add('is-live');
    button.setAttribute('aria-pressed', 'true');
    void video.play().catch(() => {});
  } catch { /* o navegador pode bloquear a busca durante o carregamento */ }
}

function bindMainVideoEvents(video) {
  const isCurrentVideo = (event) => event.currentTarget === elements.video;
  video.addEventListener('enterpictureinpicture', (event) => {
    if (!isCurrentVideo(event) || state.selected?.kind !== 'live' || !elements.modal.open) return;
    state.restoreModalAfterPictureInPicture = false;
    const pictureInPictureVideo = video;
    detachLivePlaybackToDock();
    if (document.pictureInPictureElement === pictureInPictureVideo) {
      void document.exitPictureInPicture().catch(() => {});
    }
  });
  video.addEventListener('leavepictureinpicture', (event) => {
    if (!isCurrentVideo(event) || !state.restoreModalAfterPictureInPicture) return;
    state.restoreModalAfterPictureInPicture = false;
    if (state.selected?.kind === 'live' && state.mpegtsPlayer && !elements.modal.open) {
      elements.modal.showModal();
    }
  });
  video.addEventListener('playing', (event) => {
    if (!isCurrentVideo(event)) return;
    elements.playerMessage.textContent = '';
    elements.playerMessage.classList.add('visually-hidden');
    elements.play.hidden = true;
    updateLiveNowButton(video, elements.liveNow);
  });
  video.addEventListener('waiting', (event) => {
    if (!isCurrentVideo(event) || state.selected?.kind !== 'live' || !state.mpegtsPlayer) return;
    elements.playerMessage.textContent = 'O canal está aguardando novos dados da transmissão…';
    elements.playerMessage.classList.remove('visually-hidden');
  });
  video.addEventListener('stalled', (event) => {
    if (!isCurrentVideo(event) || state.selected?.kind !== 'live' || !state.mpegtsPlayer) return;
    elements.playerMessage.textContent = 'A transmissão parou de enviar dados. Verifique a conexão com o serviço de canais.';
    elements.playerMessage.classList.remove('visually-hidden');
  });
  video.addEventListener('error', (event) => {
    if (!isCurrentVideo(event)) return;
    state.candidateIndex += 1;
    void tryCandidate();
  });
  for (const eventName of ['timeupdate', 'progress', 'seeking', 'seeked']) {
    video.addEventListener(eventName, (event) => {
      if (isCurrentVideo(event)) updateLiveNowButton(video, elements.liveNow);
    });
  }
}

function stopMiniLivePlayer(id) {
  const entry = state.miniLivePlayers.get(id);
  if (!entry) return;
  try { entry.player.pause(); entry.player.unload(); entry.player.detachMediaElement(); entry.player.destroy(); }
  catch { /* player already stopped */ }
  entry.video.pause(); entry.video.removeAttribute('src'); entry.video.load();
  entry.card.remove();
  state.miniLivePlayers.delete(id);
  elements.miniLiveDock.hidden = state.miniLivePlayers.size === 0;
}

function stopAllMiniLivePlayers() {
  for (const id of state.miniLivePlayers.keys()) stopMiniLivePlayer(id);
}

function makeLivePlayerDraggable(card, handle) {
  let drag = null;
  handle.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || event.target.closest('button')) return;
    const bounds = card.getBoundingClientRect();
    card.style.position = 'fixed';
    card.style.left = `${bounds.left}px`;
    card.style.top = `${bounds.top}px`;
    card.style.right = 'auto';
    card.style.bottom = 'auto';
    card.style.width = `min(420px, calc(100vw - 28px))`;
    card.style.zIndex = '21';
    drag = { pointerId: event.pointerId, x: event.clientX - bounds.left, y: event.clientY - bounds.top };
    handle.setPointerCapture(event.pointerId);
    event.preventDefault();
  });
  handle.addEventListener('pointermove', (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const maxLeft = Math.max(0, window.innerWidth - card.offsetWidth);
    const maxTop = Math.max(0, window.innerHeight - card.offsetHeight);
    card.style.left = `${Math.max(0, Math.min(maxLeft, event.clientX - drag.x))}px`;
    card.style.top = `${Math.max(0, Math.min(maxTop, event.clientY - drag.y))}px`;
  });
  const finishDrag = (event) => {
    if (drag?.pointerId !== event.pointerId) return;
    drag = null;
    if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
  };
  handle.addEventListener('pointerup', finishDrag);
  handle.addEventListener('pointercancel', finishDrag);
}

function detachLivePlaybackToDock() {
  if (state.selected?.kind !== 'live' || !state.mpegtsPlayer) return;
  const id = ++state.nextMiniLivePlayerId;
  const video = elements.video;
  const card = document.createElement('section');
  card.className = 'live-mini-player';
  card.setAttribute('aria-label', `Canal minimizado: ${state.selected.name || 'Canal'}`);
  const position = state.miniLivePlayers.size;
  const offset = Math.min(position * 34, Math.max(0, window.innerHeight - 320));
  card.style.position = 'fixed';
  card.style.right = `${14 + Math.min(offset, Math.max(0, window.innerWidth - 460))}px`;
  card.style.bottom = `${14 + offset}px`;
  card.style.width = 'min(420px, calc(100vw - 28px))';
  card.style.zIndex = String(21 + position);
  const header = document.createElement('header');
  header.className = 'live-mini-player-header';
  const title = document.createElement('strong');
  title.textContent = state.selected.name || 'Canal ao vivo';
  const actions = document.createElement('div');
  actions.className = 'live-mini-player-actions';
  const mute = document.createElement('button');
  mute.type = 'button';
  mute.textContent = video.muted ? 'Ativar som' : 'Silenciar';
  mute.setAttribute('aria-label', video.muted ? 'Ativar som do canal' : 'Silenciar canal');
  mute.addEventListener('click', () => {
    video.muted = !video.muted;
    mute.textContent = video.muted ? 'Ativar som' : 'Silenciar';
    mute.setAttribute('aria-label', video.muted ? 'Ativar som do canal' : 'Silenciar canal');
  });
  const liveNow = document.createElement('button');
  liveNow.type = 'button';
  liveNow.className = 'live-now-button';
  liveNow.setAttribute('aria-label', 'Ir para a transmissao ao vivo');
  liveNow.setAttribute('aria-pressed', 'false');
  const liveDot = document.createElement('span');
  liveDot.className = 'live-now-dot';
  liveDot.setAttribute('aria-hidden', 'true');
  liveNow.append(liveDot, document.createTextNode('Ao Vivo'));
  liveNow.addEventListener('click', () => seekVideoToLive(video, liveNow));
  for (const eventName of ['timeupdate', 'progress', 'seeking', 'seeked']) {
    video.addEventListener(eventName, () => updateLiveNowButton(video, liveNow));
  }
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'live-mini-player-close';
  close.textContent = '×';
  close.setAttribute('aria-label', `Parar ${state.selected.name || 'canal'}`);
  close.addEventListener('click', () => stopMiniLivePlayer(id));
  actions.append(liveNow, mute, close);
  header.append(title, actions);
  makeLivePlayerDraggable(card, header);
  const surface = document.createElement('div');
  surface.className = 'live-mini-player-surface';
  card.append(header, surface);

  const replacement = document.createElement('video');
  replacement.id = 'media-player';
  replacement.controls = true;
  replacement.playsInline = true;
  replacement.setAttribute('controlslist', 'nodownload');
  replacement.hidden = true;
  video.id = '';
  video.classList.add('live-mini-player-video');
  video.hidden = false;
  video.disablePictureInPicture = true;
  video.replaceWith(replacement);
  surface.append(video);
  elements.video = replacement;
  elements.liveNow.hidden = true;
  bindMainVideoEvents(replacement);

  elements.miniLiveDock.append(card);
  elements.miniLiveDock.hidden = false;
  state.miniLivePlayers.set(id, { player: state.mpegtsPlayer, video, card });
  state.mpegtsPlayer = null;
  if (elements.modal.open) {
    state.preserveLiveOnModalClose = true;
    elements.modal.close();
  }
}

async function mediaTicket(source, signal, download = false) {
  if (location.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(location.hostname)) {
    throw new Error('HTTPS_REQUIRED');
  }
  const liveMatch = /^live:(\d{1,20})$/.exec(String(source));
  const headers = { 'content-type': 'application/json' };
  let endpoint = '/api/media-ticket';
  let body = { target: source, download };
  const showMatch = /^show:(\d{1,20})$/.exec(String(source));
  if (liveMatch || showMatch) {
    const idToken = await api.currentToken(state.auth);
    endpoint = showMatch ? '/api/show-ticket' : '/api/live-ticket';
    headers.authorization = `Bearer ${idToken}`;
    body = showMatch ? { stream_id: showMatch[1], download } : { stream_id: liveMatch[1] };
  } else if (download) {
    const idToken = await api.currentToken(state.auth);
    headers.authorization = `Bearer ${idToken}`;
  }
  const response = await fetch(`${MEDIA_BACKEND_URL}${endpoint}`, {
    method: 'POST', mode: 'cors', credentials: 'omit', cache: 'no-store',
    headers, body: JSON.stringify(body), signal,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(String(data?.code || `HTTP_${response.status}`));
  const playbackUrl = new URL(String(data?.playbackUrl || ''));
  if (playbackUrl.protocol !== 'https:' || playbackUrl.origin !== MEDIA_PROXY_ORIGIN
    || !playbackUrl.pathname.startsWith('/open-stream/') || playbackUrl.search || playbackUrl.hash) {
    throw new Error('INVALID_PLAYBACK_URL');
  }
  return playbackUrl.href;
}

function createLivePlayer(playbackUrl, attempt, isLive = true) {
  const mpegts = window.mpegts;
  if (!mpegts?.getFeatureList?.().mseLivePlayback) throw new Error('LIVE_MPEGTS_UNSUPPORTED');
  const player = mpegts.createPlayer({
    type: 'mpegts',
    isLive,
    cors: true,
    withCredentials: false,
    url: playbackUrl,
  }, {
    enableWorker: false,
    enableStashBuffer: true,
    stashInitialSize: 2 * 1024 * 1024,
    isLive,
    lazyLoad: false,
    liveBufferLatencyChasing: isLive,
    liveSync: isLive,
    autoCleanupSourceBuffer: true,
    autoCleanupMaxBackwardDuration: 120,
    autoCleanupMinBackwardDuration: 60,
  });
  state.mpegtsPlayer = player;
  const video = elements.video;
  let pausedByUser = false;
  let hasStartedPlayback = false;
  video.addEventListener('pause', () => {
    if (hasStartedPlayback) pausedByUser = true;
  });
  video.addEventListener('play', () => { hasStartedPlayback = true; pausedByUser = false; });
  const startPlayback = () => {
    if (attempt !== state.playbackAttempt || pausedByUser || (hasStartedPlayback && video.paused)) return;
    if (pausedByUser) return;
    void video.play().catch(() => {
      if (attempt !== state.playbackAttempt) return;
      elements.playerMessage.textContent = isLive
        ? 'Toque em reproduzir no video para iniciar o canal.'
        : 'Toque em reproduzir no video para iniciar o show.';
      elements.playerMessage.classList.remove('visually-hidden');
    });
  };
  player.on(mpegts.Events.MEDIA_INFO, startPlayback);
  player.on(mpegts.Events.ERROR, (type, detail) => {
    if (attempt !== state.playbackAttempt) return;
    elements.playerMessage.classList.remove('visually-hidden');
    const mediaLabel = state.selected?.kind === 'show' ? 'O show' : 'A transmissao do canal';
    elements.playerMessage.textContent = `${mediaLabel} encontrou um erro (${String(type || 'desconhecido')}${detail ? `: ${String(detail)}` : ''}).`;
  });
  player.attachMediaElement(elements.video);
  player.load();
  startPlayback();
  return player;
}

async function tryCandidate() {
  if (!state.selected || !state.session) return;
  stopPlayback(); const attempt = state.playbackAttempt;
  const source = mediaCandidates(state.selected)[state.candidateIndex];
  if (!source) {
    elements.playerMessage.classList.remove('visually-hidden');
    elements.playerMessage.textContent = 'Nenhum dos endereços disponíveis respondeu neste navegador.';
    if (state.selected.kind === 'show') {
      elements.playerMessage.textContent = 'A grava\u00e7\u00e3o n\u00e3o p\u00f4de ser carregada. Verifique o link .ts do show no backend.';
    }
    elements.video.hidden = true; elements.play.hidden = false; return;
  }
  elements.playerMessage.textContent = ''; elements.play.hidden = true;
  const controller = new AbortController(); state.ticketController = controller;
  const timer = window.setTimeout(() => controller.abort(), TICKET_TIMEOUT_MS);
  try {
    const playbackUrl = await mediaTicket(source, controller.signal);
    if (attempt !== state.playbackAttempt || !state.session) return;
    state.ticketController = null; elements.playerMessage.textContent = ''; elements.playerMessage.classList.add('visually-hidden');
    elements.video.crossOrigin = 'anonymous'; elements.video.hidden = false;
    if (state.selected.kind === 'live') {
      createLivePlayer(playbackUrl, attempt, true);
      elements.liveNow.hidden = false;
      elements.liveNow.classList.remove('is-live');
      elements.liveNow.setAttribute('aria-pressed', 'false');
    } else if (state.selected.kind === 'show') {
      elements.liveNow.hidden = true;
      elements.video.controls = true;
      const transportStream = /\.(?:ts|mpegts)$/i.test(new URL(playbackUrl).pathname);
      if (transportStream) {
        createLivePlayer(playbackUrl, attempt, false);
      } else {
        // The .ts channel entrypoint can redirect to a recorded MP4. The
        // ticket now points at that final file so the native player can seek.
        elements.video.src = playbackUrl;
        elements.video.load(); void playShowVideo(attempt);
      }
    } else {
      elements.video.src = playbackUrl;
      elements.video.load(); void elements.video.play().catch(() => {});
    }
  } catch (error) {
    if (attempt !== state.playbackAttempt) return;
    state.ticketController = null; elements.video.hidden = true; elements.play.hidden = false;
    const aborted = error instanceof DOMException && error.name === 'AbortError';
    elements.playerMessage.classList.remove('visually-hidden');
    elements.playerMessage.textContent = aborted ? 'O serviço demorou para responder. Tente novamente.'
      : `O serviço HTTPS ainda não conseguiu preparar esta mídia (${readableError(error)}).`;
  } finally { window.clearTimeout(timer); }
}

async function playShowVideo(attempt = state.playbackAttempt) {
  try {
    await elements.video.play();
    if (attempt !== state.playbackAttempt) return;
    elements.playerMessage.textContent = '';
    elements.playerMessage.classList.add('visually-hidden');
    elements.play.hidden = true;
  } catch (error) {
    if (attempt !== state.playbackAttempt) return;
    elements.play.hidden = false;
    elements.playerMessage.textContent = error?.name === 'NotAllowedError'
      ? 'A grava\u00e7\u00e3o est\u00e1 carregada. Toque em Reproduzir para iniciar o show.'
      : 'O show est\u00e1 carregado. Use os controles do v\u00eddeo para iniciar a reprodu\u00e7\u00e3o.';
    elements.playerMessage.classList.remove('visually-hidden');
  }
}

async function downloadItem(item, button) {
  if (!item || String(state.session?.accountType || state.account?.accountType || '').toUpperCase() !== 'PREMIUM') return;
  const source = mediaCandidates(item)[0];
  if (!source) return;
  button.disabled = true;
  try {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), TICKET_TIMEOUT_MS);
    const url = await mediaTicket(source, controller.signal, true).finally(() => window.clearTimeout(timer));
    const servedName = decodeURIComponent(new URL(url).pathname.split('/').pop() || '').replace(/^download-/i, '');
    const extensionPosition = servedName.lastIndexOf('.');
    const servedExtension = extensionPosition >= 0 ? servedName.slice(extensionPosition + 1) : '';
    const extension = String(servedExtension || item.container_extension || item.extension || 'mp4').replace(/[^a-z0-9]/gi, '').toLowerCase() || 'mp4';
    const fallbackName = item.kind === 'show' ? 'show' : 'filme';
    const filename = String(item.name || fallbackName).replace(/[\\/:*?"<>|]/g, '_').trim() || fallbackName;
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${filename}.${extension}`;
    anchor.rel = 'noopener'; document.body.append(anchor); anchor.click(); anchor.remove();
  } catch (error) { notice(`Não foi possível iniciar o download (${readableError(error)}).`); }
  finally { button.disabled = false; }
}

function renderProfiles() {
  elements.profileGrid.replaceChildren();
  elements.profileUser.textContent = `${state.account.screens} ${state.account.screens === 1 ? 'perfil disponível' : 'perfis disponíveis'}`;
  for (let profile = 1; profile <= state.account.screens; profile += 1) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'profile-card';
    button.innerHTML = '<span class="profile-avatar"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10Zm0-2a3 3 0 1 1 0-6 3 3 0 0 1 0 6Zm0 3c-5 0-8 2.5-8 5v3h16v-3c0-2.5-3-5-8-5Zm-6 5c0-.92 1.9-3 6-3s6 2.08 6 3v1H6v-1Z"/></svg></span><strong></strong><small></small>';
    button.querySelector('strong').textContent = profileName(profile); button.querySelector('small').textContent = `Perfil ${profile}`;
    button.addEventListener('click', () => { void requestProfilePin(profile); }); elements.profileGrid.append(button);
  }
}

function showProfilePinDialog(profile, message = '') {
  state.pendingProfile = profile; elements.profilePin.value = ''; elements.profilePinError.textContent = message;
  elements.rememberProfilePin.checked = true;
  elements.profilePinTitle.textContent = `Entrar em ${profileName(profile)}`; elements.profilePinDialog.showModal(); elements.profilePin.focus();
}

async function requestProfilePin(profile) {
  if (state.busy) return;
  state.pendingProfile = profile; setBusy(true); elements.profileError.textContent = 'Abrindo perfil protegido…';
  const rememberedPin = await readProfilePin(state.auth?.login, profile).catch(() => '');
  setBusy(false); elements.profileError.textContent = '';
  if (rememberedPin) return selectProfileWithPin(profile, rememberedPin, true, true);
  showProfilePinDialog(profile);
}

async function selectProfileWithPin(profile, pin, rememberPin, fromVault = false) {
  if (state.busy || !state.auth || !profile) return;
  setBusy(true); elements.profilePinError.textContent = ''; elements.profileError.textContent = 'Conectando ao perfil…';
  try {
    state.session = await api.selectProfile(state.auth, profile, pin);
    state.account.accountType = state.session.accountType || state.account.accountType;
    loadFavorites();
    loadLiveFavorites();
    if (rememberPin) {
      try { await saveProfilePin(state.auth.login, profile, pin); }
      catch { notice('O perfil foi aberto, mas este aparelho não disponibilizou o cofre protegido para o PIN.'); }
    }
    else await deleteProfilePin(state.auth.login, profile).catch(() => {});
    await persistAuthOnDevice();
    state.pendingProfile = 0; elements.profilePin.value = '';
    if (elements.profilePinDialog.open) elements.profilePinDialog.close();
    updateSessionUi(); showScreen('app'); void enterMovieView(false); startSessionWatcher();
  } catch (error) {
    state.session = null;
    if (fromVault) {
      await deleteProfilePin(state.auth.login, profile).catch(() => {});
      showProfilePinDialog(profile, 'O PIN salvo não é mais válido. Digite o PIN atual.');
    } else elements.profilePinError.textContent = readableError(error);
  } finally { elements.profileError.textContent = ''; setBusy(false); }
}

function updateSessionUi() {
  const principal = state.session?.profile === 1;
  elements.accountType.textContent = state.session?.accountType || state.account?.accountType || 'STANDARD';
  elements.serverLabel.textContent = state.session ? profileName(state.session.profile) : 'Perfil';
  elements.profileSettingsButton.hidden = !principal; elements.parentalSettingsButton.hidden = !principal;
  const hiddenAdults = !state.session?.adultVisible || state.session?.parental?.adultMode === 'hidden';
  elements.adultNav.hidden = hiddenAdults;
}

function startSessionWatcher() {
  state.sessionWatcher?.abort();
  if (!state.auth || !state.session) return;
  const controller = new AbortController(); state.sessionWatcher = controller;
  const session = state.session;
  api.watchSession(state.auth, session, controller.signal).then((ended) => {
    if (!ended || controller.signal.aborted || state.session !== session) return;
    endLocalProfile(); showScreen('profiles'); renderProfiles(); elements.profileError.textContent = `${ended.message} Selecione o perfil para continuar.`;
  }).catch(() => {});
}

function endLocalProfile() {
  state.sessionWatcher?.abort(); state.sessionWatcher = null; stopPlayback(); stopAllMiniLivePlayers();
  if (elements.modal.open) elements.modal.close();
  state.session = null; state.adultView = false; state.selected = null; state.filtered = []; state.favorites = new Set();
  state.liveFavorites = null; state.adultLiveFavorites = null; elements.grid.replaceChildren();
}

async function releaseProfile() {
  const session = state.session; endLocalProfile();
  if (state.auth && session) await api.releaseProfile(state.auth, session);
}

async function returnToProfiles(message = '') {
  if (state.busy) return;
  setBusy(true); await releaseProfile(); renderProfiles(); elements.profileError.textContent = message; showScreen('profiles'); setBusy(false);
}

async function logout() {
  if (state.busy) return;
  const login = state.auth?.login || elements.username.value;
  setBusy(true); await releaseProfile(); await forgetDevice(login);
  state.catalog = null; state.catalogLoad = null; state.categories = []; state.seriesCatalog = null; state.liveCatalog = null; state.showCatalog = SHOWS_CATALOG;
  state.page.generation += 1; state.page.offset = 0; state.page.hasMore = false; state.page.loading = false; state.filtered = [];
  clearSeriesCatalogCache(); clearLegacyCatalog();
  state.auth = null; state.account = null; state.rememberDevice = false; elements.password.value = '';
  elements.rememberLogin.checked = false;
  elements.loginError.textContent = ''; showScreen('login'); setBusy(false);
}

async function loadMovieCatalog() {
  if (state.catalog) return state.catalog;
  if (state.catalogLoad) return state.catalogLoad;
  const auth = state.auth;
  state.catalogLoad = (async () => {
    const idToken = await api.currentToken(auth);
    const catalog = await movieCatalogPage(idToken, { offset: 0, limit: 1, query: '', category: ALL_CATEGORY, adult: false, favoriteIds: state.favorites });
    if (state.auth !== auth) throw new Error('A sessao mudou durante o carregamento.');
    state.catalog = { patterns: catalog.patterns || [] };
    state.categories = Array.isArray(catalog.categories) ? [...catalog.categories] : [];
    return state.catalog;
  })().finally(() => { state.catalogLoad = null; });
  return state.catalogLoad;
}

async function enterMovieView(adult = false) {
  state.activeSection = 'movies';
  state.adultView = adult;
  elements.moviesNav.classList.toggle('active', !adult); elements.seriesNav.classList.remove('active'); elements.showsNav.classList.remove('active'); elements.channelsNav.classList.remove('active'); elements.adultNav.classList.toggle('active', adult);
  elements.heading.textContent = adult ? 'Filmes Adulto' : 'Filmes';
  elements.kicker.textContent = adult ? 'CONTEUDO ADULTO 18+' : 'CATALOGO ON DEMAND';
  elements.searchLabel.setAttribute('aria-label', adult ? 'Buscar filmes adultos' : 'Buscar filmes');
  elements.search.placeholder = adult ? 'Buscar filmes adultos...' : 'Buscar filmes...'; elements.search.value = '';
  if (!state.session) return;
  if (!state.catalog) {
    elements.status.textContent = 'Carregando catalogo de filmes...'; elements.status.parentElement.hidden = false;
    try { await loadMovieCatalog(); }
    catch (error) {
      if (state.activeSection !== 'movies') return;
      elements.status.textContent = `Nao foi possivel carregar filmes (${readableError(error)}).`;
      elements.status.classList.add('error'); return;
    }
  }
  if (state.activeSection !== 'movies' || !state.session) return;
  renderCategoryFilters(); applyFilters();
}
async function enterSeriesView() {
  if (!state.session) return;
  state.activeSection = 'series';
  elements.moviesNav.classList.remove('active'); elements.seriesNav.classList.add('active'); elements.showsNav.classList.remove('active'); elements.channelsNav.classList.remove('active'); elements.adultNav.classList.toggle('active', state.adultView);
  elements.heading.textContent = state.adultView ? 'Séries Adulto' : 'Séries'; elements.kicker.textContent = state.adultView ? 'SÉRIES · CONTEÚDO ADULTO 18+' : 'SÉRIES E EPISÓDIOS';
  elements.searchLabel.setAttribute('aria-label', state.adultView ? 'Buscar séries adultas' : 'Buscar séries');
  elements.search.placeholder = state.adultView ? 'Buscar séries adultas...' : 'Buscar séries...'; elements.search.value = '';
  elements.status.textContent = 'Carregando catálogo de séries…'; elements.status.parentElement.hidden = false;
  try {
    const idToken = await api.currentToken(state.auth);
    if (!state.seriesCatalog) {
      const catalog = await seriesCatalogPage(idToken, { offset: 0, limit: 1, query: '', category: ALL_CATEGORY, adult: false, favoriteIds: state.favorites });
      state.seriesCatalog = { categories: catalog.categories || [], segments: catalog.segments || [], patterns: [] };
    }
    if (state.activeSection !== 'series' || !state.session) return;
    elements.status.textContent = '';
    elements.status.parentElement.hidden = true;
    elements.status.classList.remove('error');
    renderCategoryFilters(); applyFilters();
  } catch (error) {
    elements.status.textContent = `Não foi possível carregar séries (${readableError(error)}).`;
    elements.status.parentElement.hidden = false;
    elements.status.classList.add('error');
  }
}

async function enterLiveView() {
  if (!state.session) return;
  state.activeSection = 'live';
  elements.channelsNav.classList.add('active');
  elements.moviesNav.classList.remove('active'); elements.seriesNav.classList.remove('active'); elements.showsNav.classList.remove('active');
  elements.adultNav.classList.toggle('active', state.adultView);
  elements.heading.textContent = state.adultView ? 'Canais Adulto' : 'Canais';
  elements.kicker.textContent = state.adultView ? 'CANAIS AO VIVO · CONTEÚDO 18+' : 'TELEVISÃO AO VIVO';
  elements.searchLabel.setAttribute('aria-label', state.adultView ? 'Buscar canais adultos' : 'Buscar canais');
  elements.search.placeholder = state.adultView ? 'Buscar canais adultos...' : 'Buscar canais...';
  elements.search.value = '';
  elements.status.textContent = 'Carregando catálogo de canais...';
  elements.status.parentElement.hidden = false; elements.status.classList.remove('error');
  try {
    const idToken = await api.currentToken(state.auth);
    if (!state.liveCatalog || selectedLiveFavorites() === null) {
      const catalog = await liveCatalogPage(idToken, {
        offset: 0, limit: PAGE_SIZE, query: '', category: LIVE_FAVORITES_CATEGORY, adult: state.adultView,
        favoriteIds: state.favorites, liveFavoriteIds: selectedLiveFavorites(),
      });
      state.liveCatalog = { categories: catalog.categories || [] };
      if (selectedLiveFavorites() === null) {
        setSelectedLiveFavorites(catalog.liveFavoriteIds || catalog.items.map(item => item.stream_id));
      }
    }
    if (state.activeSection !== 'live' || !state.session) return;
    elements.status.textContent = ''; elements.status.parentElement.hidden = true;
    renderCategoryFilters(); applyFilters();
  } catch (error) {
    if (state.activeSection !== 'live') return;
    elements.status.textContent = `Não foi possível carregar canais (${readableError(error)}).`;
    elements.status.parentElement.hidden = false; elements.status.classList.add('error');
  }
}

function enterShowsView() {
  if (!state.session) return;
  state.activeSection = 'shows';
  elements.showsNav.classList.add('active');
  elements.channelsNav.classList.remove('active'); elements.moviesNav.classList.remove('active');
  elements.seriesNav.classList.remove('active'); elements.adultNav.classList.toggle('active', state.adultView);
  elements.heading.textContent = 'Shows';
  elements.kicker.textContent = 'APRESENTAÇÕES ON DEMAND';
  elements.searchLabel.setAttribute('aria-label', 'Buscar shows');
  elements.search.placeholder = 'Buscar shows...'; elements.search.value = '';
  elements.status.textContent = 'Carregando catálogo de shows...';
  elements.status.parentElement.hidden = false; elements.status.classList.remove('error');
  try {
    state.showCatalog ||= SHOWS_CATALOG;
    if (state.activeSection !== 'shows' || !state.session) return;
    elements.status.textContent = ''; elements.status.parentElement.hidden = true;
    elements.status.classList.remove('error');
    if (!state.showCatalog.categories.length) {
      elements.category.replaceChildren(); elements.categoryStrip.replaceChildren();
      state.filtered = []; renderGrid();
      elements.status.textContent = 'Este catálogo ainda não tem shows disponíveis.';
      elements.status.parentElement.hidden = false;
      return;
    }
    renderCategoryFilters(); applyFilters();
  } catch (error) {
    if (state.activeSection !== 'shows') return;
    elements.status.textContent = `Não foi possível carregar shows (${readableError(error)}).`;
    elements.status.parentElement.hidden = false; elements.status.classList.add('error');
  }
}

function renderProfileSettings() {
  elements.profileSettingsList.replaceChildren(...state.profileSettings.profiles.map((profile) => {
    const row = document.createElement('div'); row.className = 'profile-settings-row'; row.dataset.profile = String(profile.profile);
    const number = document.createElement('strong'); number.textContent = String(profile.profile);
    const nameLabel = document.createElement('label'); nameLabel.className = 'field'; nameLabel.innerHTML = '<span>NOME</span>';
    const name = document.createElement('input'); name.className = 'profile-setting-name'; name.value = profile.name; name.maxLength = 60; name.required = true; nameLabel.append(name);
    const pinLabel = document.createElement('label'); pinLabel.className = 'field'; pinLabel.innerHTML = '<span>NOVO PIN · OPCIONAL</span>';
    const pin = document.createElement('input'); pin.className = 'profile-setting-pin'; pin.type = 'password'; pin.maxLength = 128; pin.autocomplete = 'new-password'; pinLabel.append(pin);
    row.append(number, nameLabel, pinLabel); return row;
  }));
}

function renderParentalProfiles() {
  elements.parentalProfiles.replaceChildren(...state.parentalSettings.profiles.map((profile) => {
    const row = document.createElement('label'); row.className = 'parental-profile';
    const name = document.createElement('span'); name.textContent = `${profile.name}${profile.profile === 1 ? ' · principal' : ''}`;
    const select = document.createElement('select'); select.dataset.profile = String(profile.profile);
    for (const [value, label] of [['free', 'Liberado'], ['pin', 'Pedir PIN'], ['hidden', 'Oculto e bloqueado']]) {
      const option = document.createElement('option'); option.value = value; option.textContent = label; select.append(option);
    }
    select.value = profile.adultMode; row.append(name, select); return row;
  }));
}

async function openProfileSettings() {
  if (state.busy || state.session?.profile !== 1) return;
  setBusy(true);
  try {
    const settings = await api.profileSettings(state.auth, state.session);
    state.profileSettings = { ...settings, profiles: settings.profiles.map(item => ({ ...item, pin: '' })) };
    renderProfileSettings(); elements.profileSettingsError.textContent = ''; elements.profileSettingsDialog.showModal();
  } catch (error) { notice(readableError(error)); }
  finally { setBusy(false); }
}

async function openParentalSettings() {
  if (state.busy || state.session?.profile !== 1) return;
  setBusy(true);
  try {
    state.parentalMode = 'settings'; state.parentalSettings = await api.parentalSettings(state.auth, state.session);
    renderParentalProfiles(); elements.parentalTitle.textContent = 'Controle parental';
    elements.parentalDescription.textContent = 'Escolha o acesso adulto de cada perfil. O mesmo PIN protege estas configurações.';
    elements.parentalOptions.hidden = false; elements.parentalCurrentField.hidden = !state.parentalSettings.configured;
    elements.parentalPin.disabled = !state.parentalSettings.configured; elements.parentalPin.required = state.parentalSettings.configured;
    elements.parentalNewPin.required = !state.parentalSettings.configured;
    elements.parentalNewPinLabel.textContent = state.parentalSettings.configured ? 'Novo PIN · opcional' : 'Definir PIN · 4 a 8 números';
    elements.parentalSubmit.textContent = 'SALVAR PERMISSÕES'; elements.parentalPin.value = ''; elements.parentalNewPin.value = '';
    elements.parentalError.textContent = ''; elements.parentalDialog.showModal();
  } catch (error) { notice(readableError(error)); }
  finally { setBusy(false); }
}

async function openAdultSection() {
  if (!state.session?.adultVisible || state.session?.parental?.adultMode === 'hidden') return notice('Conteúdo adulto oculto neste perfil.');
  if (state.session.adultAllowed || state.session.parental?.adultMode === 'free') return enterMovieView(true);
  if (state.busy) return;
  setBusy(true);
  try {
    const controls = await api.parental(state.auth, state.session);
    state.parentalMode = 'unlock'; state.session.parental = controls;
    elements.parentalTitle.textContent = 'Liberar conteúdo adulto';
    elements.parentalDescription.textContent = controls.configured ? 'Digite o PIN definido pelo perfil principal.' : 'O perfil principal ainda não definiu um PIN.';
    elements.parentalOptions.hidden = true; elements.parentalCurrentField.hidden = false; elements.parentalPin.disabled = false;
    elements.parentalPin.required = true; elements.parentalPinLabel.textContent = 'PIN'; elements.parentalSubmit.textContent = 'LIBERAR';
    elements.parentalPin.value = ''; elements.parentalNewPin.value = ''; elements.parentalError.textContent = '';
    elements.parentalSubmit.disabled = !controls.configured; elements.parentalDialog.showModal(); elements.parentalPin.focus();
  } catch (error) { notice(readableError(error)); }
  finally { setBusy(false); }
}

elements.loginForm.addEventListener('submit', async (event) => {
  event.preventDefault(); if (state.busy) return;
  const login = elements.username.value.trim(); const password = elements.password.value;
  if (!login || !password) { elements.loginError.textContent = 'Informe login e senha para continuar.'; return; }
  setBusy(true); elements.loginError.textContent = ''; elements.loginButton.firstElementChild.textContent = 'ENTRANDO...';
  try {
    state.auth = await api.signIn(login, password); state.account = await api.account(state.auth);
    state.rememberDevice = elements.rememberLogin.checked;
    if (state.rememberDevice) {
      try { localStorage.setItem(SAVED_LOGIN_KEY, state.auth.login); } catch { /* opcional */ }
      await persistAuthOnDevice();
    } else await forgetDevice(state.auth.login);
    elements.password.value = ''; renderProfiles(); elements.profileError.textContent = ''; showScreen('profiles');
  } catch (error) { state.auth = null; state.account = null; elements.loginError.textContent = readableError(error); }
  finally { elements.loginButton.firstElementChild.textContent = 'ENTRAR'; setBusy(false); }
});

elements.profilePinForm.addEventListener('submit', async (event) => {
  event.preventDefault(); if (state.busy || !state.auth || !state.pendingProfile) return;
  const pin = elements.profilePin.value;
  if (pin.length < 4 || pin.length > 128) { elements.profilePinError.textContent = 'Digite o PIN deste perfil (4 a 128 caracteres).'; return; }
  void selectProfileWithPin(state.pendingProfile, pin, elements.rememberProfilePin.checked);
});

elements.rememberLogin.addEventListener('change', () => {
  state.rememberDevice = elements.rememberLogin.checked;
  if (!state.rememberDevice) void forgetDevice();
});

elements.profileSettingsButton.addEventListener('click', () => { void openProfileSettings(); });
elements.parentalSettingsButton.addEventListener('click', () => { void openParentalSettings(); });

elements.profileSettingsDialog.querySelector('form').addEventListener('submit', async (event) => {
  event.preventDefault(); if (state.busy || !state.profileSettings) return;
  const profiles = $$('#profile-settings-list .profile-settings-row').map(row => ({
    profile: Number(row.dataset.profile), name: row.querySelector('.profile-setting-name').value.trim(), pin: row.querySelector('.profile-setting-pin').value,
  }));
  if (profiles.some(item => !item.name)) { elements.profileSettingsError.textContent = 'Defina o nome de todos os perfis.'; return; }
  if (profiles.some(item => item.pin && item.pin.length < 4)) { elements.profileSettingsError.textContent = 'Use PINs com 4 a 128 caracteres.'; return; }
  setBusy(true); elements.profileSettingsError.textContent = '';
  try {
    const result = await api.saveProfileSettings(state.auth, state.session, { revision: state.profileSettings.revision, profiles });
    await clearProfilePins(state.auth.login).catch(() => {});
    await persistAuthOnDevice();
    state.account.profileNames = result.profileNames; elements.profileSettingsDialog.close(); endLocalProfile(); renderProfiles();
    elements.profileError.textContent = 'Perfis atualizados. Digite o PIN para continuar.'; showScreen('profiles');
  } catch (error) { elements.profileSettingsError.textContent = readableError(error); }
  finally { setBusy(false); }
});

elements.parentalForm.addEventListener('submit', async (event) => {
  event.preventDefault(); if (state.busy || !state.session) return;
  const currentPin = elements.parentalPin.value; const newPin = elements.parentalNewPin.value;
  if (!validParentalPin(currentPin) && (state.parentalMode === 'unlock' || elements.parentalPin.required)) {
    elements.parentalError.textContent = 'Informe o PIN de 4 a 8 números.'; return;
  }
  if (state.parentalMode === 'settings' && (elements.parentalNewPin.required || newPin) && !validParentalPin(newPin)) {
    elements.parentalError.textContent = 'Defina um PIN de 4 a 8 números.'; return;
  }
  setBusy(true); elements.parentalError.textContent = '';
  try {
    if (state.parentalMode === 'unlock') {
      Object.assign(state.session, await api.unlockParental(state.auth, state.session, currentPin));
      await persistAuthOnDevice();
      elements.parentalDialog.close(); updateSessionUi(); enterMovieView(true); startSessionWatcher(); notice('Conteúdo adulto liberado.');
    } else {
      const profiles = $$('#parental-profiles select').map(select => ({ profile: Number(select.dataset.profile), adultMode: select.value }));
      await api.saveParental(state.auth, state.session, { profiles, expectedRevision: state.parentalSettings.revision, currentPin, newPin });
      await persistAuthOnDevice();
      elements.parentalDialog.close(); endLocalProfile(); renderProfiles(); elements.profileError.textContent = 'Permissões salvas. Escolha o perfil novamente.'; showScreen('profiles');
    }
  } catch (error) { elements.parentalError.textContent = readableError(error); }
  finally { setBusy(false); elements.parentalSubmit.disabled = false; }
});

$$('[data-close-dialog]').forEach(button => button.addEventListener('click', () => {
  if (state.busy) return; const dialog = button.closest('dialog'); if (dialog?.open) dialog.close();
}));
elements.backToLogin = $('#back-to-login');
elements.backToLogin.addEventListener('click', () => { void logout(); });
elements.switchProfile.addEventListener('click', () => { void returnToProfiles(); });
elements.logout.addEventListener('click', () => { void logout(); });
elements.channelsNav.addEventListener('click', () => { void enterLiveView(); });
elements.moviesNav.addEventListener('click', () => enterMovieView(false));
elements.seriesNav.addEventListener('click', () => { void enterSeriesView(); });
elements.showsNav.addEventListener('click', () => { void enterShowsView(); });
elements.adultNav.addEventListener('click', () => { void openAdultSection(); });
elements.closeSeries.addEventListener('click', closeSeriesDetails);
elements.seriesDialog.addEventListener('cancel', (event) => { event.preventDefault(); closeSeriesDetails(); });
elements.seriesDialog.addEventListener('click', (event) => {
  if (event.target === elements.seriesDialog) closeSeriesDetails();
});
elements.favoriteSeries.addEventListener('click', () => {
  if (!state.activeSeries) return;
  toggleFavorite({ ...state.activeSeries, kind: 'series' });
  syncSeriesFavoriteControls();
});
elements.favoriteEpisodesFilter.addEventListener('click', () => {
  state.favoriteEpisodesOnly = !state.favoriteEpisodesOnly;
  syncSeriesFavoriteControls();
  renderEpisodes(state.seriesSeason);
});
$$('.future-section').forEach(button => button.addEventListener('click', () => notice(`${button.dataset.future} já está estruturado e será ativado quando o catálogo correspondente for adicionado.`)));

bindMainVideoEvents(elements.video);
elements.liveNow.addEventListener('click', () => seekVideoToLive(elements.video, elements.liveNow));
elements.play.addEventListener('click', () => {
  if (state.selected?.kind === 'show' && elements.video.getAttribute('src')) {
    void playShowVideo();
    return;
  }
  void tryCandidate();
});
elements.trailer.addEventListener('click', () => {
  const url = elements.trailer.dataset.url;
  if (!url) return;
  window.open(url, '_blank', 'noopener,noreferrer');
});
elements.close.addEventListener('click', () => elements.modal.close());
elements.modal.addEventListener('close', () => {
  if (state.preserveLiveOnModalClose) {
    state.preserveLiveOnModalClose = false;
    return;
  }
  if (state.selected?.kind === 'live' && state.mpegtsPlayer) {
    detachLivePlaybackToDock();
    return;
  }
  stopPlayback();
});
elements.search.addEventListener('input', () => {
  window.clearTimeout(state.searchTimer);
  state.searchTimer = window.setTimeout(applyFilters, 250);
});
elements.category.addEventListener('change', applyFilters);
elements.viewButtons.forEach(button => {
  button.classList.toggle('active', button.dataset.view === state.view);
  button.addEventListener('click', () => {
    state.view = button.dataset.view === 'list' ? 'list' : 'grid';
    try { localStorage.setItem('evotv-catalog-view', state.view); } catch { /* opcional */ }
    elements.viewButtons.forEach(item => item.classList.toggle('active', item === button)); renderGrid();
  });
});
elements.categoryStrip.addEventListener('wheel', (event) => {
  if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
  event.preventDefault(); elements.categoryStrip.scrollLeft += event.deltaY;
}, { passive: false });
const loadOnScroll = () => {
  if (!state.page.hasMore || state.page.loading) return;
  const nearGridBottom = elements.grid.scrollTop + elements.grid.clientHeight >= elements.grid.scrollHeight - 200;
  const nearPageBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 200;
  if (nearGridBottom || nearPageBottom) void loadCatalogPage();
};
elements.grid.addEventListener('scroll', loadOnScroll, { passive: true });
window.addEventListener('scroll', loadOnScroll, { passive: true });

async function start() {
  if (location.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(location.hostname)) {
    const secureUrl = new URL(location.href);
    secureUrl.protocol = 'https:';
    location.replace(secureUrl.href);
    return;
  }
  clearLegacyCatalog();
  let fallbackLogin = '';
  try {
    fallbackLogin = localStorage.getItem(SAVED_LOGIN_KEY) || '';
    elements.username.value = fallbackLogin;
  } catch { /* armazenamento opcional */ }
  let restored = null;
  try { restored = await readRememberedAuth(); } catch { /* cofre indisponível */ }
  if (restored) {
    elements.username.value = restored.login; elements.rememberLogin.checked = true; state.rememberDevice = true;
    elements.loginError.textContent = 'Restaurando o acesso protegido neste aparelho…';
    try {
      state.auth = restored; state.account = await api.account(state.auth); await persistAuthOnDevice();
      renderProfiles(); elements.profileError.textContent = 'Acesso restaurado neste aparelho.'; showScreen('profiles');
    } catch {
      await forgetDevice(restored.login); state.auth = null; state.account = null; state.rememberDevice = true;
      elements.rememberLogin.checked = true; elements.loginError.textContent = 'O acesso salvo expirou. Entre novamente.'; showScreen('login');
    }
  } else {
    elements.rememberLogin.checked = true; state.rememberDevice = true; elements.username.value = fallbackLogin; showScreen('login');
  }
}

if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
void start();
