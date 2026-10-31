import { EvoAuthApi, FIREBASE_API_KEY } from './auth-api.js';
import { SHOWS_CATALOG } from './shows-catalog.js';
import { clearLegacyCatalog, normalized } from './catalog-db.js';
import { clearSeriesCatalogCache, episodesForSeries } from './series-catalog-db.js';
import {
  clearProfilePins,
  clearRememberedCredentials,
  clearRememberedAuth,
  deleteProfilePin,
  readProfilePin,
  readRememberedCredentials,
  saveProfilePin,
  saveRememberedCredentials,
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
let publicContactsCache = null;
let publicContactsRequest = null;

const state = {
  catalog: null, catalogLoad: null, categories: [], filtered: [],
  page: { offset: 0, hasMore: false, loading: false, generation: 0 }, searchTimer: 0,
  activeSection: 'live', seriesCatalog: null, liveCatalog: null, showCatalog: SHOWS_CATALOG, activeSeries: null, activeSeriesEpisodes: [], seriesSeason: '', favoriteEpisodesOnly: false,
  selected: null, candidateIndex: 0, ticketController: null, mpegtsPlayer: null, playbackAttempt: 0, screenPlaybackUrl: '',
  miniLivePlayers: new Map(), ownLiveScreens: new Map(), nextMiniLivePlayerId: 0, nextOwnScreenId: 0, preserveLiveOnModalClose: false,
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
  loginLogoButton: $('#login-logo-button'), contactsDialog: $('#contacts-dialog'), contactsStatus: $('#contacts-status'), contactLinks: $('#contact-links'),
  commercialContact: $('#commercial-contact'), commercialNumber: $('#commercial-number'), supportContact: $('#support-contact'), supportNumber: $('#support-number'),
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
  accountMenuToggle: $('#account-menu-toggle'), accountMenuPanel: $('#account-menu-panel'),
  profilePhotoButton: $('#profile-photo-button'), profilePhotoInput: $('#profile-photo-input'),
  accountAvatarPhoto: $('#account-avatar-photo'), accountAvatarFallback: $('.account-avatar-fallback'),
  accountMenuPhoto: $('#account-menu-photo'), accountMenuPhotoFallback: $('.account-menu-photo-fallback'),
  accountMenuProfileName: $('#account-menu-profile-name'), accountMenuType: $('#account-menu-type'), sidebarProfileName: $('#sidebar-profile-name'), paymentSystem: $('#payment-system'),
  switchProfile: $('#switch-profile'), logout: $('#logout-button'), accountType: $('#account-type'),
  adultNav: $('#adult-nav'), channelsNav: $('#channels-nav'), moviesNav: $('#movies-nav'), seriesNav: $('#series-nav'), showsNav: $('#shows-nav'), heading: $('#catalog-heading'),
  notice: $('#app-notice'), search: $('#catalog-search'), searchLabel: $('.pc-search-box'), category: $('#category-filter'), categoryStrip: $('#category-strip'),
  grid: $('#catalog-grid'), status: $('#app-status'), sentinel: $('#load-sentinel'),
  seriesDialog: $('#series-dialog'), seriesCover: $('#series-cover'), seriesTitle: $('#series-title'),
  seriesPlot: $('#series-plot'), seriesLoading: $('#series-loading'), seasonTabs: $('#season-tabs'), episodeList: $('#episode-list'),
  liveChoiceList: $('#live-choice-list'),
  closeSeries: $('#close-series'), favoriteSeries: $('#favorite-series'), favoriteEpisodesFilter: $('#favorite-episodes-filter'),
  modal: $('#media-modal'), modalTitle: $('#media-title'), modalMeta: $('#media-meta'),
  modalImage: $('#media-image'), modalSynopsis: $('#media-synopsis'), video: $('#media-player'), trailerPlayer: $('#trailer-player'), playerMessage: $('#player-message'),
  mediaKind: $('#media-kind'), playerSurface: $('.media-player-surface'), playerToolbar: $('#media-player-toolbar'),
  volumeButton: $('#media-volume-button'), volumeSlider: $('#media-volume'), maximizeScreen: $('#maximize-media-screen'),
  play: $('#play-media'), trailer: $('#trailer-media'), openLiveScreen: $('#open-live-screen'), close: $('#close-modal'),
  miniLiveDock: $('#live-mini-dock'), viewButtons: $$('[data-view]'),
};

function showScreen(name) {
  elements.loginScreen.hidden = name !== 'login';
  elements.profileScreen.hidden = name !== 'profiles';
  elements.appScreen.hidden = name !== 'app';
}

function setAccountMenuOpen(open, restoreFocus = false) {
  elements.accountMenuPanel.hidden = !open;
  elements.accountMenuToggle.setAttribute('aria-expanded', String(open));
  if (open) positionAccountMenuPanel();
  if (restoreFocus) elements.accountMenuToggle.focus();
}

function positionAccountMenuPanel() {
  const trigger = elements.accountMenuToggle.getBoundingClientRect();
  const menu = elements.accountMenuPanel.getBoundingClientRect();
  const gutter = 8;
  const left = Math.max(gutter, Math.min(trigger.left, window.innerWidth - menu.width - gutter));
  let top = trigger.top - menu.height - gutter;
  if (top < gutter) top = trigger.bottom + gutter;
  top = Math.max(gutter, Math.min(top, window.innerHeight - menu.height - gutter));
  elements.accountMenuPanel.style.left = `${left}px`;
  elements.accountMenuPanel.style.top = `${top}px`;
  elements.accountMenuPanel.style.right = 'auto';
}

function readableError(error) {
  if (['LIVE_STREAM_NOT_CONFIGURED', 'LIVE_PROVIDER_NOT_CONFIGURED', 'LIVE_LINK_MAP_UNAVAILABLE', 'LIVE_CHANNEL_LINK_MISSING'].includes(String(error?.message || error))) return 'Canal em Manuten\u00e7\u00e3o - Tente acessar outro canal correspondente fora de Manuten\u00e7\u00e3o.';
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
  await clearRememberedCredentials().catch(() => {});
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

async function loadPublicContacts() {
  if (publicContactsCache) return publicContactsCache;
  if (publicContactsRequest) return publicContactsRequest;
  publicContactsRequest = (async () => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 12_000);
    try {
      const url = `https://firestore.googleapis.com/v1/projects/multimideas-evotv/databases/(default)/documents/public/contatos?key=${FIREBASE_API_KEY}`;
      const response = await fetch(url, { headers: { accept: 'application/json' }, signal: controller.signal });
      if (!response.ok) throw new Error('CONTACTS_UNAVAILABLE');
      const document = await response.json();
      const fields = document?.fields || {};
      publicContactsCache = {
        commercial: typeof fields.whatsapp_comercial?.stringValue === 'string' ? fields.whatsapp_comercial.stringValue.trim() : '',
        support: typeof fields.whatsapp_suporte?.stringValue === 'string' ? fields.whatsapp_suporte.stringValue.trim() : '',
      };
      return publicContactsCache;
    } finally {
      window.clearTimeout(timeout);
      publicContactsRequest = null;
    }
  })();
  return publicContactsRequest;
}

function whatsappUrl(rawNumber) {
  const value = String(rawNumber || '').trim();
  let digits = value.replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('00')) digits = digits.slice(2);
  else if (!value.startsWith('+') && digits.length <= 11) digits = `55${digits}`;
  return `https://wa.me/${digits}`;
}

function formatBrazilianPhone(rawNumber) {
  let digits = String(rawNumber || '').replace(/\D/g, '');
  if (digits.startsWith('55') && (digits.length === 12 || digits.length === 13)) digits = digits.slice(2);
  if (digits.length === 11) return `(${digits.slice(0, 2)})${digits.slice(2, 7)}-${digits.slice(7)}`;
  if (digits.length === 10) return `(${digits.slice(0, 2)})${digits.slice(2, 6)}-${digits.slice(6)}`;
  return String(rawNumber || '').trim();
}

function setContactLink(link, numberElement, rawNumber) {
  const number = String(rawNumber || '').trim();
  const url = whatsappUrl(number);
  link.hidden = !number || !url;
  if (link.hidden) return;
  link.href = url;
  numberElement.textContent = formatBrazilianPhone(number);
}

async function openContactsDialog() {
  if (!elements.contactsDialog.open) elements.contactsDialog.showModal();
  elements.contactsStatus.textContent = 'Carregando contatos…';
  elements.contactsStatus.hidden = false;
  elements.contactLinks.hidden = true;
  try {
    const contacts = await loadPublicContacts();
    setContactLink(elements.commercialContact, elements.commercialNumber, contacts.commercial);
    setContactLink(elements.supportContact, elements.supportNumber, contacts.support);
    const hasContacts = Boolean(contacts.commercial || contacts.support);
    elements.contactLinks.hidden = !hasContacts;
    elements.contactsStatus.textContent = hasContacts ? '' : 'Os contatos ainda não estão disponíveis.';
    elements.contactsStatus.hidden = hasContacts;
  } catch {
    elements.contactsStatus.textContent = 'Não foi possível carregar os contatos agora.';
    elements.contactsStatus.hidden = false;
  }
}

function profileAvatarStorageKey(profile = state.session?.profile) {
  const account = state.auth?.login;
  const profileNumber = Number(profile);
  if (!account || !Number.isInteger(profileNumber) || profileNumber < 1 || profileNumber > 20) return '';
  return `evotv:profile-avatar:v1:${accountFingerprint(account)}:${profileNumber}`;
}

function renderProfileAvatar(dataUrl = '') {
  for (const [photo, fallback] of [
    [elements.accountAvatarPhoto, elements.accountAvatarFallback],
    [elements.accountMenuPhoto, elements.accountMenuPhotoFallback],
  ]) {
    if (dataUrl) photo.src = dataUrl;
    else photo.removeAttribute('src');
    photo.hidden = !dataUrl;
    fallback.hidden = Boolean(dataUrl);
  }
}

async function makeProfileAvatarDataUrl(file) {
  if (!file || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 8 * 1024 * 1024) {
    throw new Error('Escolha uma imagem JPG, PNG ou WEBP de até 8 MB.');
  }
  const bitmap = await createImageBitmap(file);
  try {
    const size = 256;
    const scale = Math.max(size / bitmap.width, size / bitmap.height);
    const width = bitmap.width * scale;
    const height = bitmap.height * scale;
    const canvas = document.createElement('canvas');
    canvas.width = size; canvas.height = size;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Não foi possível preparar a foto.');
    context.drawImage(bitmap, (size - width) / 2, (size - height) / 2, width, height);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', .84));
    if (!blob) throw new Error('Não foi possível preparar a foto.');
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('Não foi possível ler a foto.'));
      reader.readAsDataURL(blob);
    });
  } finally { bitmap.close(); }
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
  const visible = state.filtered.findIndex(item => String(item.stream_id) === String(id));
  const neighbor = visible + Math.sign(Number(offset) || 0);
  if (visible < 0 || neighbor < 0 || neighbor >= state.filtered.length) return;
  const otherId = String(state.filtered[neighbor].stream_id);
  const from = items.indexOf(String(id));
  const to = items.indexOf(otherId);
  if (from < 0 || to < 0) return;
  [items[from], items[to]] = [items[to], items[from]];
  setSelectedLiveFavorites(items);
  [state.filtered[visible], state.filtered[neighbor]] = [state.filtered[neighbor], state.filtered[visible]];
  const cards = [...elements.grid.querySelectorAll('.catalog-card')];
  const firstCard = cards[visible];
  const secondCard = cards[neighbor];
  if (!firstCard || !secondCard) return;
  if (visible < neighbor) elements.grid.insertBefore(secondCard, firstCard);
  else elements.grid.insertBefore(firstCard, secondCard);
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
    const poster = document.createElement('span'); poster.className = `catalog-poster${item.kind === 'live' ? ' channel-poster' : ''}`;
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
      for (const [offset, label, glyph] of [[-1, 'Mover canal para a esquerda', '←'], [1, 'Mover canal para a direita', '→']]) {
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
    if (generation === state.page.generation) {
      state.page.loading = false;
      renderGrid();
      if (state.page.hasMore) loadOnScroll();
    }
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
    headers: {
      authorization: `Bearer ${idToken}`, accept: 'application/json', 'x-evo-platform': 'web',
      'x-evo-session': state.session?.sessionToken || '', 'x-evo-profile': String(state.session?.profile || ''),
    }, credentials: 'omit', cache: 'no-store',
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
  elements.video.classList.remove('live-controls-no-seek');
  elements.video.disablePictureInPicture = true;
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
  elements.video.controls = true;
  elements.modal.showModal();
}

function openLiveChannel(item) {
  if (state.selected?.kind === 'live' && document.pictureInPictureElement === elements.video) {
    detachLivePlaybackToDock();
  } else {
    stopPlayback();
  }
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
  elements.video.controls = true;
  elements.video.classList.add('live-controls-no-seek');
  elements.video.disablePictureInPicture = true;
  elements.video.hidden = false;
  elements.play.hidden = true;
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
  elements.video.controls = true;
  elements.video.classList.remove('live-controls-no-seek');
  elements.video.disablePictureInPicture = true;
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
    const episodes = await episodesForSeries(state.seriesCatalog, series, idToken, state.session);
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
  elements.video.controls = true;
  elements.video.classList.remove('live-controls-no-seek');
  elements.video.disablePictureInPicture = true;
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
  state.screenPlaybackUrl = '';
  if (elements.playerToolbar) elements.playerToolbar.hidden = true;
  elements.playerSurface.classList.remove('screen-maximized');
  elements.maximizeScreen?.setAttribute('aria-pressed', 'false');
  elements.maximizeScreen?.setAttribute('aria-label', 'Maximizar ecrã');
  state.restoreModalAfterPictureInPicture = false;
  if (document.pictureInPictureElement === elements.video) {
    void document.exitPictureInPicture().catch(() => {});
  }
  if (state.mpegtsPlayer) {
    try { state.mpegtsPlayer.pause(); state.mpegtsPlayer.unload(); state.mpegtsPlayer.detachMediaElement(); state.mpegtsPlayer.destroy(); } catch { /* player already stopped */ }
    state.mpegtsPlayer = null;
  }
  elements.video.pause(); elements.video.removeAttribute('src'); elements.video.load();
  elements.trailerPlayer.removeAttribute('src'); elements.trailerPlayer.hidden = true;
}

function bindMainVideoEvents(video) {
  const isCurrentVideo = (event) => event.currentTarget === elements.video;
  video.addEventListener('playing', (event) => {
    if (!isCurrentVideo(event)) return;
    elements.playerMessage.textContent = '';
    elements.playerMessage.classList.add('visually-hidden');
    elements.play.hidden = true;
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
    if (state.selected?.kind === 'live') {
      elements.playerMessage.textContent = 'A transmissão encontrou um erro. Tente trocar de canal e voltar para reconectar.';
      elements.playerMessage.classList.remove('visually-hidden');
      return;
    }
    state.candidateIndex += 1;
    void tryCandidate();
  });
}

function stopOwnLiveScreen(id) {
  const entry = state.ownLiveScreens.get(id);
  if (!entry) return;
  entry.controller?.abort();
  if (entry.player) {
    try { entry.player.pause(); entry.player.unload(); entry.player.detachMediaElement(); entry.player.destroy(); } catch { /* player already stopped */ }
  }
  entry.video.pause(); entry.video.removeAttribute('src'); entry.video.load(); entry.frame.remove();
  state.ownLiveScreens.delete(id);
  elements.miniLiveDock.hidden = state.miniLivePlayers.size === 0 && state.ownLiveScreens.size === 0;
}

function stopAllOwnLiveScreens() {
  for (const id of state.ownLiveScreens.keys()) stopOwnLiveScreen(id);
}

function syncOwnScreenVolume(video, button, slider) {
  const muted = video.muted || video.volume === 0;
  button.setAttribute('aria-pressed', String(muted));
  button.setAttribute('aria-label', muted ? 'Ativar volume' : 'Silenciar');
  button.title = muted ? 'Ativar volume' : 'Silenciar';
  slider.value = String(muted ? 0 : video.volume);
}

function makeOwnScreenDraggable(frame, handle) {
  let drag = null;
  handle.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || event.target.closest('button') || frame.classList.contains('own-live-screen-maximized')) return;
    const bounds = frame.getBoundingClientRect();
    frame.style.left = `${bounds.left}px`; frame.style.top = `${bounds.top}px`;
    frame.style.right = 'auto'; frame.style.bottom = 'auto';
    drag = { pointerId: event.pointerId, x: event.clientX - bounds.left, y: event.clientY - bounds.top };
    handle.setPointerCapture(event.pointerId); event.preventDefault();
  });
  handle.addEventListener('pointermove', (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const maxLeft = Math.max(0, window.innerWidth - frame.offsetWidth);
    const maxTop = Math.max(0, window.innerHeight - frame.offsetHeight);
    frame.style.left = `${Math.max(0, Math.min(maxLeft, event.clientX - drag.x))}px`;
    frame.style.top = `${Math.max(0, Math.min(maxTop, event.clientY - drag.y))}px`;
  });
  const finish = (event) => {
    if (drag?.pointerId !== event.pointerId) return;
    drag = null;
    if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
  };
  handle.addEventListener('pointerup', finish); handle.addEventListener('pointercancel', finish);
}

function openLiveChannelFrame() {
  if (!state.selected || !state.session) return;
  const sourceSelection = state.selected;
  const sourcePlaybackAttempt = state.playbackAttempt;
  const sourceVideo = elements.video;
  const selected = { ...state.selected };
  const source = mediaCandidates(selected)[state.candidateIndex];
  if (!source) return;

  const id = ++state.nextOwnScreenId;
  const offset = Math.min((state.ownLiveScreens.size + state.miniLivePlayers.size) * 28, 140);
  const frame = document.createElement('section');
  frame.className = 'own-live-screen';
  frame.setAttribute('role', 'region');
  frame.setAttribute('aria-label', `Ecrã: ${selected.name || 'Canal ao vivo'}`);
  frame.style.right = `${16 + offset}px`; frame.style.bottom = `${16 + offset}px`;
  frame.style.width = `min(760px, calc(100vw - ${32 + offset}px))`;
  frame.style.zIndex = String(40 + id);

  const header = document.createElement('header'); header.className = 'own-live-screen-header';
  const logo = document.createElement('img'); logo.src = './assets/logo_evotv.png'; logo.alt = 'EVOTV';
  const title = document.createElement('strong'); title.textContent = selected.name || 'Canal ao vivo';
  const close = document.createElement('button'); close.className = 'own-live-screen-icon';
  close.type = 'button'; close.textContent = '×'; close.title = 'Fechar ecrã'; close.setAttribute('aria-label', 'Fechar ecrã');
  close.addEventListener('click', () => stopOwnLiveScreen(id));
  header.append(logo, title, close);

  const surface = document.createElement('div'); surface.className = 'own-live-screen-surface';
  const video = document.createElement('video'); video.className = 'own-live-screen-video';
  video.playsInline = true; video.controls = false; video.disablePictureInPicture = true;
  const status = document.createElement('p'); status.className = 'own-live-screen-status';
  status.textContent = 'Conectando ao canal…'; status.setAttribute('role', 'status');
  surface.append(video, status);

  const toolbar = document.createElement('footer'); toolbar.className = 'own-live-screen-toolbar';
  const volumeGroup = document.createElement('div'); volumeGroup.className = 'own-live-screen-volume';
  const volumeButton = document.createElement('button'); volumeButton.className = 'own-live-screen-icon';
  volumeButton.type = 'button'; volumeButton.setAttribute('aria-label', 'Silenciar'); volumeButton.title = 'Silenciar';
  volumeButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="own-volume-muted" d="M4 9v6h4l5 4V5L8 9H4zm12.5 3 3 3 1.5-1.5-3-3 3-3L19.5 6l-3 3-3-3L12 7.5l3 3-3 3 1.5 1.5 3-3z"/><path class="own-volume-on" d="M3 9v6h4l5 4V5L7 9H3zm12.5 3a3.5 3.5 0 0 0-2-3.16v6.31a3.5 3.5 0 0 0 2-3.15zm-2-8.46v2.06a7 7 0 0 1 0 12.8v2.06a9 9 0 0 0 0-16.92z"/></svg>';
  const volume = document.createElement('input'); volume.type = 'range'; volume.min = '0'; volume.max = '1'; volume.step = '0.02'; volume.value = '1';
  volume.setAttribute('aria-label', 'Volume do canal');
  volumeButton.addEventListener('click', () => {
    video.muted = !video.muted; if (!video.muted && video.volume === 0) video.volume = 0.6;
    syncOwnScreenVolume(video, volumeButton, volume);
  });
  volume.addEventListener('input', () => {
    video.volume = Number(volume.value); video.muted = video.volume === 0;
    syncOwnScreenVolume(video, volumeButton, volume);
  });
  video.addEventListener('volumechange', () => syncOwnScreenVolume(video, volumeButton, volume));
  volumeGroup.append(volumeButton, volume);

  const size = document.createElement('button'); size.className = 'own-live-screen-icon own-live-screen-size';
  size.type = 'button'; size.setAttribute('aria-label', 'Maximizar ecrã'); size.title = 'Maximizar ecrã';
  size.setAttribute('aria-pressed', 'false');
  size.innerHTML = '<svg class="own-maximize-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5M4 9l6-6m10 6-6-6m6 12-6 6M4 15l6 6"/></svg><svg class="own-restore-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3H3v5m0-5 7 7M16 21h5v-5m0 5-7-7M21 8V3h-5m5 0-7 7M3 16v5h5m-5 0 7-7"/></svg>';
  size.addEventListener('click', () => {
    const bounds = frame.getBoundingClientRect();
    const maximized = frame.classList.toggle('own-live-screen-maximized');
    if (maximized) {
      frame.dataset.restoreLeft = String(bounds.left); frame.dataset.restoreTop = String(bounds.top);
      frame.dataset.restoreWidth = String(bounds.width); frame.dataset.restoreHeight = String(bounds.height);
    } else if (frame.dataset.restoreLeft) {
      frame.style.left = `${Math.max(0, Math.min(window.innerWidth - Number(frame.dataset.restoreWidth), Number(frame.dataset.restoreLeft)))}px`;
      frame.style.top = `${Math.max(0, Math.min(window.innerHeight - Number(frame.dataset.restoreHeight), Number(frame.dataset.restoreTop)))}px`;
      frame.style.right = 'auto'; frame.style.bottom = 'auto';
      frame.style.width = `${Number(frame.dataset.restoreWidth)}px`;
      frame.style.height = `${Number(frame.dataset.restoreHeight)}px`;
    }
    size.setAttribute('aria-pressed', String(maximized));
    size.setAttribute('aria-label', maximized ? 'Restaurar tamanho do ecrã' : 'Maximizar ecrã');
    size.title = maximized ? 'Restaurar tamanho do ecrã' : 'Maximizar ecrã';
  });
  toolbar.append(volumeGroup, size); frame.append(header, surface, toolbar);
  makeOwnScreenDraggable(frame, header);
  elements.miniLiveDock.append(frame); elements.miniLiveDock.hidden = false;
  syncOwnScreenVolume(video, volumeButton, volume);
  const entry = { frame, video, status, player: null, controller: new AbortController(), closedSource: false, volumeButton, volume };
  state.ownLiveScreens.set(id, entry);

  const closeSourceChannel = () => {
    if (entry.closedSource || state.selected !== sourceSelection
      || state.playbackAttempt !== sourcePlaybackAttempt || elements.video !== sourceVideo) return;
    entry.closedSource = true;
    if (document.pictureInPictureElement === sourceVideo) void document.exitPictureInPicture().catch(() => {});
    if (elements.modal.open) { state.preserveLiveOnModalClose = true; elements.modal.close(); }
    stopPlayback(); state.selected = null;
  };

  const ticketTimeout = window.setTimeout(() => entry.controller.abort(), TICKET_TIMEOUT_MS);
  void mediaTicket(source, entry.controller.signal).then((playbackUrl) => {
    if (!state.ownLiveScreens.has(id)) return;
    const mpegts = window.mpegts;
    if (!mpegts?.getFeatureList?.().mseLivePlayback) throw new Error('LIVE_MPEGTS_UNSUPPORTED');
    const isLive = selected.kind === 'live';
    const player = mpegts.createPlayer({ type: 'mpegts', isLive, cors: true, withCredentials: false, url: playbackUrl }, {
      enableWorker: false, enableStashBuffer: true, stashInitialSize: 384 * 1024,
      isLive, lazyLoad: false, liveBufferLatencyChasing: false, liveSync: false,
      autoCleanupSourceBuffer: true, autoCleanupMaxBackwardDuration: 120, autoCleanupMinBackwardDuration: 60,
    });
    entry.player = player;
    const restoreVolume = sourceVideo.volume; const restoreMuted = sourceVideo.muted;
    video.muted = true; syncOwnScreenVolume(video, volumeButton, volume);
    const started = () => {
      status.hidden = true; closeSourceChannel();
      video.volume = restoreVolume; video.muted = restoreMuted;
      syncOwnScreenVolume(video, volumeButton, volume);
    };
    video.addEventListener('playing', started, { once: true });
    player.on(mpegts.Events.MEDIA_INFO, () => { void video.play().catch(() => {}); });
    player.on(mpegts.Events.ERROR, (_type, detail) => {
      status.hidden = false; status.textContent = `O canal encontrou um erro${detail ? ` (${String(detail)})` : ''}.`;
    });
    player.attachMediaElement(video); player.load(); void video.play().catch(() => {});
  }).catch((error) => {
    if (!state.ownLiveScreens.has(id)) return;
    status.hidden = false; status.textContent = `NÃ£o foi possÃ­vel abrir o canal (${readableError(error)}).`;
  }).finally(() => window.clearTimeout(ticketTimeout));
}

function stopMiniLivePlayer(id) {
  const entry = state.miniLivePlayers.get(id);
  if (!entry) return;
  try { entry.player.pause(); entry.player.unload(); entry.player.detachMediaElement(); entry.player.destroy(); }
  catch { /* player already stopped */ }
  entry.video.pause(); entry.video.removeAttribute('src'); entry.video.load();
  entry.card.remove();
  state.miniLivePlayers.delete(id);
  elements.miniLiveDock.hidden = state.miniLivePlayers.size === 0 && state.ownLiveScreens.size === 0;
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
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'live-mini-player-close';
  close.textContent = '×';
  close.setAttribute('aria-label', `Parar ${state.selected.name || 'canal'}`);
  close.addEventListener('click', () => stopMiniLivePlayer(id));
  actions.append(close);
  header.append(title, actions);
  makeLivePlayerDraggable(card, header);
  const surface = document.createElement('div');
  surface.className = 'live-mini-player-surface';
  card.append(header, surface);

  const replacement = document.createElement('video');
  replacement.id = 'media-player';
  replacement.controls = false;
  replacement.playsInline = true;
  replacement.hidden = true;
  video.id = '';
  video.classList.add('live-mini-player-video');
  video.hidden = false;
  video.controls = true;
  video.disablePictureInPicture = true;
  video.replaceWith(replacement);
  surface.append(video);
  elements.video = replacement;
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

async function mediaTicket(source, signal, download = false, contentItem = state.selected) {
  if (location.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(location.hostname)) {
    throw new Error('HTTPS_REQUIRED');
  }
  const liveMatch = /^live:(\d{1,20})$/.exec(String(source));
  const headers = {
    'content-type': 'application/json', 'x-evo-platform': 'web',
    'x-evo-session': state.session?.sessionToken || '', 'x-evo-profile': String(state.session?.profile || ''),
  };
  let endpoint = '/api/media-ticket';
  const content = contentItem?.kind === 'series'
    ? { kind: 'series', id: String(contentItem.series_id || ''), streamId: String(contentItem.stream_id || '') }
    : contentItem && !['live', 'show'].includes(contentItem.kind)
      ? { kind: 'movie', id: String(contentItem.stream_id || '') } : null;
  let body = { target: source, download, ...(content ? { content } : {}) };
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
    stashInitialSize: 384 * 1024,
    isLive,
    lazyLoad: false,
    liveBufferLatencyChasing: false,
    liveSync: false,
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
        ? 'Não foi possível iniciar a reprodução do canal neste navegador.'
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
    elements.video.hidden = true; elements.play.hidden = state.selected.kind === 'live'; return;
  }
  elements.playerMessage.textContent = ''; elements.play.hidden = true;
  const controller = new AbortController(); state.ticketController = controller;
  const timer = window.setTimeout(() => controller.abort(), TICKET_TIMEOUT_MS);
  try {
    const playbackUrl = await mediaTicket(source, controller.signal);
    if (attempt !== state.playbackAttempt || !state.session) return;
    state.screenPlaybackUrl = playbackUrl;
    elements.playerToolbar.hidden = false;
    state.ticketController = null; elements.playerMessage.textContent = ''; elements.playerMessage.classList.add('visually-hidden');
    elements.video.crossOrigin = 'anonymous'; elements.video.hidden = false;
    if (state.selected.kind === 'live') {
      elements.video.controls = true;
      elements.video.classList.add('live-controls-no-seek');
      createLivePlayer(playbackUrl, attempt, true);
    } else if (state.selected.kind === 'show') {
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
      elements.video.controls = true;
      elements.video.src = playbackUrl;
      elements.video.load(); void elements.video.play().catch(() => {});
    }
  } catch (error) {
    if (attempt !== state.playbackAttempt) return;
    state.ticketController = null; state.screenPlaybackUrl = ''; elements.playerToolbar.hidden = true; elements.video.hidden = true; elements.play.hidden = state.selected.kind === 'live';
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
    const url = await mediaTicket(source, controller.signal, true, item).finally(() => window.clearTimeout(timer));
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
    button.innerHTML = '<span class="profile-avatar"><svg class="profile-avatar-fallback" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10Zm0-2a3 3 0 1 1 0-6 3 3 0 0 1 0 6Zm0 3c-5 0-8 2.5-8 5v3h16v-3c0-2.5-3-5-8-5Zm-6 5c0-.92 1.9-3 6-3s6 2.08 6 3v1H6v-1Z"/></svg><img class="profile-avatar-photo" alt="" hidden></span><strong></strong><small></small>';
    const photo = button.querySelector('.profile-avatar-photo');
    const fallback = button.querySelector('.profile-avatar-fallback');
    const avatarKey = profileAvatarStorageKey(profile);
    let savedAvatar = '';
    try { savedAvatar = avatarKey ? localStorage.getItem(avatarKey) || '' : ''; } catch { /* foto opcional */ }
    if (savedAvatar) photo.src = savedAvatar;
    photo.hidden = !savedAvatar;
    fallback.hidden = Boolean(savedAvatar);
    button.querySelector('strong').textContent = profileName(profile); button.querySelector('small').textContent = `Perfil ${profile}`;
    button.addEventListener('click', () => { void requestProfilePin(profile); }); elements.profileGrid.append(button);
  }
}

function showProfilePinDialog(profile, message = '', rememberedPin = '') {
  state.pendingProfile = profile; elements.profilePin.value = rememberedPin; elements.profilePinError.textContent = message;
  elements.rememberProfilePin.checked = true;
  elements.profilePinTitle.textContent = `Entrar em ${profileName(profile)}`; elements.profilePinDialog.showModal(); elements.profilePin.focus();
}

async function requestProfilePin(profile) {
  if (state.busy) return;
  state.pendingProfile = profile; setBusy(true); elements.profileError.textContent = 'Abrindo perfil protegido…';
  const rememberedPin = await readProfilePin(state.auth?.login, profile).catch(() => '');
  setBusy(false); elements.profileError.textContent = '';
  showProfilePinDialog(profile, '', rememberedPin);
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
    updateSessionUi(); showScreen('app'); void enterLiveView(); startSessionWatcher();
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
  const activeProfileName = state.session ? profileName(state.session.profile) : 'Perfil';
  const accountType = String(state.session?.accountType || state.account?.accountType || 'STANDARD').toUpperCase();
  elements.accountMenuProfileName.textContent = activeProfileName;
  elements.sidebarProfileName.textContent = activeProfileName;
  elements.accountType.textContent = accountType;
  elements.accountMenuType.textContent = accountType;
  elements.accountType.classList.toggle('premium', accountType === 'PREMIUM');
  elements.accountMenuType.classList.toggle('premium', accountType === 'PREMIUM');
  const avatarKey = profileAvatarStorageKey();
  let savedAvatar = '';
  try { savedAvatar = avatarKey ? localStorage.getItem(avatarKey) || '' : ''; } catch { /* foto opcional */ }
  renderProfileAvatar(savedAvatar);
  elements.profileSettingsButton.hidden = !principal; elements.parentalSettingsButton.hidden = !principal;
  elements.paymentSystem.hidden = !principal;
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
  state.sessionWatcher?.abort(); state.sessionWatcher = null; stopPlayback(); stopAllMiniLivePlayers(); stopAllOwnLiveScreens();
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
  const rememberOnDevice = state.rememberDevice && elements.rememberLogin.checked;
  setBusy(true); await releaseProfile();
  if (rememberOnDevice) {
    // Sair encerra a sessão, mas preserva as credenciais e os PINs marcados para este aparelho.
    await clearRememberedAuth().catch(() => {});
  } else await forgetDevice(login);
  state.catalog = null; state.catalogLoad = null; state.categories = []; state.seriesCatalog = null; state.liveCatalog = null; state.showCatalog = SHOWS_CATALOG;
  state.page.generation += 1; state.page.offset = 0; state.page.hasMore = false; state.page.loading = false; state.filtered = [];
  clearSeriesCatalogCache(); clearLegacyCatalog();
  state.auth = null; state.account = null; state.rememberDevice = rememberOnDevice;
  elements.rememberLogin.checked = rememberOnDevice;
  if (rememberOnDevice) {
    let credentials = null;
    try { credentials = await readRememberedCredentials(); } catch { /* cofre indisponível */ }
    elements.username.value = credentials?.login || login;
    elements.password.value = credentials?.password || '';
  } else {
    elements.password.value = '';
    elements.rememberLogin.checked = false;
  }
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
  elements.heading.textContent = state.adultView ? 'Séries Adulto' : 'Séries';
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
      try { await saveRememberedCredentials(state.auth.login, password); }
      catch { notice('Não foi possível guardar login e senha neste aparelho.'); }
      await persistAuthOnDevice();
    } else await forgetDevice(state.auth.login);
    elements.password.value = ''; renderProfiles(); elements.profileError.textContent = ''; showScreen('profiles');
  } catch (error) { state.auth = null; state.account = null; elements.loginError.textContent = readableError(error); }
  finally { elements.loginButton.firstElementChild.textContent = 'ENTRAR'; setBusy(false); }
});
elements.loginLogoButton.addEventListener('click', () => { void openContactsDialog(); });

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
elements.profilePhotoButton.addEventListener('click', () => {
  elements.profilePhotoInput.value = '';
  elements.profilePhotoInput.click();
});
elements.profilePhotoInput.addEventListener('change', async () => {
  const file = elements.profilePhotoInput.files?.[0];
  if (!file) return;
  try {
    const avatar = await makeProfileAvatarDataUrl(file);
    const key = profileAvatarStorageKey();
    if (!key) throw new Error('Não foi possível identificar o perfil atual.');
    localStorage.setItem(key, avatar);
    renderProfileAvatar(avatar);
    notice('Foto do perfil atualizada.');
  } catch (error) { notice(readableError(error)); }
});
elements.paymentSystem.addEventListener('click', () => notice('Em Desenvolvimento'));
elements.accountMenuToggle.addEventListener('click', () => {
  setAccountMenuOpen(elements.accountMenuPanel.hidden);
});
elements.accountMenuPanel.addEventListener('click', (event) => {
  if (event.target.closest('button')) setAccountMenuOpen(false);
});
document.addEventListener('click', (event) => {
  if (!event.target.closest('.pc-account-menu')) setAccountMenuOpen(false);
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !elements.accountMenuPanel.hidden) {
    event.preventDefault(); setAccountMenuOpen(false, true);
  }
});
window.addEventListener('resize', () => {
  if (!elements.accountMenuPanel.hidden) positionAccountMenuPanel();
});
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
elements.openLiveScreen.addEventListener('click', () => openLiveChannelFrame());
const syncMediaVolume = () => {
  const muted = elements.video.muted || elements.video.volume === 0;
  elements.volumeButton.setAttribute('aria-pressed', String(muted));
  elements.volumeButton.setAttribute('aria-label', muted ? 'Ativar volume' : 'Silenciar');
  elements.volumeSlider.value = String(muted ? 0 : elements.video.volume);
};
elements.volumeButton.addEventListener('click', () => {
  if (elements.video.muted || elements.video.volume === 0) {
    elements.video.muted = false;
    if (elements.video.volume === 0) elements.video.volume = 0.6;
  } else {
    elements.video.muted = true;
  }
  syncMediaVolume();
});
elements.volumeSlider.addEventListener('input', () => {
  elements.video.volume = Number(elements.volumeSlider.value);
  elements.video.muted = elements.video.volume === 0;
  syncMediaVolume();
});
elements.video.addEventListener('volumechange', syncMediaVolume);
elements.maximizeScreen.addEventListener('click', () => {
  const maximized = elements.playerSurface.classList.toggle('screen-maximized');
  elements.maximizeScreen.setAttribute('aria-pressed', String(maximized));
  elements.maximizeScreen.setAttribute('aria-label', maximized ? 'Restaurar ecrã' : 'Maximizar ecrã');
  elements.maximizeScreen.title = maximized ? 'Restaurar ecrã' : 'Maximizar ecrã';
});
elements.modal.addEventListener('close', () => {
  if (state.preserveLiveOnModalClose) {
    state.preserveLiveOnModalClose = false;
    return;
  }
  stopPlayback();
  state.selected = null;
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
  const contentDoesNotFillScreen = elements.grid.scrollHeight <= elements.grid.clientHeight + 1;
  const atLoadedContentEnd = elements.grid.scrollTop + elements.grid.clientHeight >= elements.grid.scrollHeight - 1;
  if (contentDoesNotFillScreen || atLoadedContentEnd) void loadCatalogPage();
};
elements.grid.addEventListener('scroll', loadOnScroll, { passive: true });

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
  } catch { /* armazenamento opcional */ }
  let credentials = null;
  try { credentials = await readRememberedCredentials(); } catch { /* cofre indisponível */ }
  const savedLogin = credentials?.login || fallbackLogin;
  elements.username.value = savedLogin;
  if (credentials) elements.password.value = credentials.password;
  elements.rememberLogin.checked = true;
  state.rememberDevice = elements.rememberLogin.checked;
  showScreen('login');
}

if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
void start();
