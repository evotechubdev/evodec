import { EvoAuthApi } from './auth-api.js';
import { currentCatalog, normalized } from './catalog-db.js';
import {
  clearProfilePins,
  clearRememberedAuth,
  deleteProfilePin,
  readProfilePin,
  readRememberedAuth,
  saveProfilePin,
  saveRememberedAuth,
} from './device-vault.js';

const PAGE_SIZE = 45;
const MEDIA_BACKEND_URL = 'https://multimideas-evo-backend-app.onrender.com';
const TICKET_TIMEOUT_MS = 45_000;
const SAVED_LOGIN_KEY = 'evo_app_login_v1';
const MOVIE_RELEASES_CATEGORY = 'evo_movie_releases_2026';
const RECENT_CATEGORY = 'evo_recent';
const FAVORITES_CATEGORY = 'evo_content_favorites';
const ALL_CATEGORY = 'all';
const api = new EvoAuthApi();

let storedView = 'grid';
try { storedView = localStorage.getItem('evotv-catalog-view') === 'list' ? 'list' : 'grid'; } catch { /* opcional */ }

const state = {
  catalog: null, categories: [], filtered: [], visible: PAGE_SIZE,
  selected: null, candidateIndex: 0, ticketController: null, playbackAttempt: 0,
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
  adultNav: $('#adult-nav'), moviesNav: $('#movies-nav'), heading: $('#catalog-heading'), kicker: $('#section-kicker'),
  notice: $('#app-notice'), search: $('#catalog-search'), category: $('#category-filter'), categoryStrip: $('#category-strip'),
  grid: $('#catalog-grid'), count: $('#catalog-count'), status: $('#app-status'), sentinel: $('#load-sentinel'),
  loadMore: $('#load-more'), modal: $('#media-modal'), modalTitle: $('#media-title'), modalMeta: $('#media-meta'),
  modalImage: $('#media-image'), modalSynopsis: $('#media-synopsis'), video: $('#media-player'), playerMessage: $('#player-message'),
  play: $('#play-media'), trailer: $('#trailer-media'), download: $('#download-media'), close: $('#close-modal'), viewButtons: $$('[data-view]'),
};

function showScreen(name) {
  elements.loginScreen.hidden = name !== 'login';
  elements.profileScreen.hidden = name !== 'profiles';
  elements.appScreen.hidden = name !== 'app';
}

function readableError(error) {
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
const recentValue = (item) => Number(item?.added || 0) || 0;

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
      state.favorites = new Set(parsed.items.map(String).filter(value => /^\d{1,20}$/.test(value)).slice(0, 1000));
    }
  } catch { /* favoritos são opcionais */ }
}

function saveFavorites() {
  const key = favoriteStorageKey();
  if (!key) return;
  try { localStorage.setItem(key, JSON.stringify({ version: 1, items: [...state.favorites] })); } catch { /* opcional */ }
}

function toggleFavorite(item) {
  const id = String(item?.stream_id || '');
  if (!/^\d{1,20}$/.test(id)) return;
  if (state.favorites.has(id)) state.favorites.delete(id); else state.favorites.add(id);
  saveFavorites();
  if (elements.category.value === FAVORITES_CATEGORY) applyFilters(); else renderGrid();
}

function synopsisFrom(item = {}) {
  return String(item.plot || item.description || item.overview || item.info?.plot || item.info?.description || '').trim()
    || 'Sinopse não informada neste catálogo.';
}

function trailerFrom(item = {}) {
  const value = String(item.youtube_trailer || item.trailer || item.trailer_url || item.youtubeTrailer || '').trim();
  if (/^https:\/\//i.test(value)) return value;
  if (/^[a-zA-Z0-9_-]{6,20}$/.test(value)) return `https://www.youtube.com/watch?v=${encodeURIComponent(value)}`;
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(`${item.name || 'filme'} trailer oficial`)}`;
}

function safeImage(value) {
  try {
    const url = new URL(String(value || ''), location.href);
    const localPreview = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
    return url.protocol === 'https:' || (localPreview && url.protocol === 'http:') ? url.href : '';
  } catch { return ''; }
}

function mediaCandidates(item) {
  const candidates = [];
  if (item.url_final) candidates.push(item.url_final);
  const extension = String(item.container_extension || 'mp4').replace(/[^a-z0-9]/gi, '') || 'mp4';
  const id = String(item.stream_id || '');
  const patterns = [...state.catalog.patterns].sort((left, right) => {
    if (left.id === item.url_padrao) return -1;
    if (right.id === item.url_padrao) return 1;
    return Number(right.count || 0) - Number(left.count || 0);
  });
  for (const pattern of patterns) {
    if (!pattern.template.includes('{id}')) continue;
    const url = pattern.template.replaceAll('{id}', id).replaceAll('{ext}', extension);
    if (!candidates.includes(url)) candidates.push(url);
  }
  return candidates;
}

function renderCategoryFilters() {
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
  if (!state.catalog || !state.session) return;
  const query = normalized(elements.search.value.trim());
  const category = elements.category.value;
  const categoryMap = new Map(state.categories.map(item => [String(item.category_id || ''), item]));
  state.filtered = state.catalog.items.filter((item) => {
    const adult = isAdultCategory(categoryMap.get(String(item.category_id || '')));
    return adult === state.adultView && (!query || normalized(item.name).includes(query))
      && (category === MOVIE_RELEASES_CATEGORY ? isReleaseCategory(categoryMap.get(String(item.category_id || '')))
        : category === RECENT_CATEGORY || category === ALL_CATEGORY ? true
          : category === FAVORITES_CATEGORY ? state.favorites.has(String(item.stream_id || ''))
            : String(item.category_id || '') === category);
  });
  if ([MOVIE_RELEASES_CATEGORY, RECENT_CATEGORY].includes(category)) {
    state.filtered.sort((left, right) => recentValue(right) - recentValue(left) || Number(right.stream_id || 0) - Number(left.stream_id || 0));
  }
  state.visible = PAGE_SIZE;
  elements.categoryStrip.querySelectorAll('[data-category]').forEach(button => button.classList.toggle('active', button.dataset.category === category));
  renderGrid();
}

function renderGrid() {
  const items = state.filtered.slice(0, state.visible);
  elements.grid.classList.toggle('list-view', state.view === 'list');
  elements.grid.replaceChildren(...items.map((item) => {
    const card = document.createElement('article'); card.className = 'catalog-card'; card.tabIndex = 0; card.setAttribute('role', 'button');
    card.setAttribute('aria-label', `Abrir ${item.name || 'filme'}`); card.addEventListener('click', () => openItem(item));
    card.addEventListener('keydown', (event) => {
      if (event.target === card && ['Enter', ' '].includes(event.key)) { event.preventDefault(); openItem(item); }
    });
    const poster = document.createElement('span'); poster.className = 'catalog-poster';
    const image = document.createElement('img'); image.loading = 'lazy'; image.decoding = 'async'; image.alt = '';
    image.src = safeImage(item.stream_icon) || './assets/poster-placeholder.svg';
    image.addEventListener('error', () => { image.src = './assets/poster-placeholder.svg'; }, { once: true });
    const play = document.createElement('span'); play.className = 'poster-play'; poster.append(image, play);
    const copy = document.createElement('span'); copy.className = 'catalog-card-copy';
    const title = document.createElement('strong'); title.textContent = item.name || 'Sem título';
    const titleRow = document.createElement('span'); titleRow.className = 'catalog-title-row';
    const favorite = document.createElement('button'); favorite.type = 'button'; favorite.className = 'content-favorite-toggle';
    const active = state.favorites.has(String(item.stream_id || '')); favorite.classList.toggle('active', active);
    favorite.textContent = active ? '★' : '☆'; favorite.title = active ? 'Desfavoritar' : 'Favoritar';
    favorite.setAttribute('aria-label', `${favorite.title}: ${item.name || 'filme'}`); favorite.setAttribute('aria-pressed', String(active));
    favorite.addEventListener('click', (event) => { event.stopPropagation(); toggleFavorite(item); });
    titleRow.append(title, favorite);
    const meta = document.createElement('small'); meta.textContent = item.category_name || 'Filme'; copy.append(titleRow, meta);
    card.append(poster, copy); return card;
  }));
  elements.count.textContent = '';
  elements.sentinel.hidden = true; elements.loadMore.hidden = true;
}

function openItem(item) {
  if (!state.session) return;
  stopPlayback(); state.selected = item; state.candidateIndex = 0;
  elements.modalTitle.textContent = item.name || 'Sem título';
  elements.modalMeta.textContent = item.category_name || 'Filme';
  elements.modalSynopsis.textContent = synopsisFrom(item);
  elements.modalImage.src = safeImage(item.stream_icon) || './assets/poster-placeholder.svg';
  elements.playerMessage.textContent = '';
  elements.trailer.dataset.url = trailerFrom(item); elements.trailer.disabled = false;
  elements.download.hidden = String(state.session?.accountType || state.account?.accountType || '').toUpperCase() !== 'PREMIUM';
  elements.video.removeAttribute('src'); elements.video.load(); elements.video.hidden = true; elements.play.hidden = false;
  elements.modal.showModal();
}

function stopPlayback() {
  state.playbackAttempt += 1; state.ticketController?.abort(); state.ticketController = null;
  elements.video.pause(); elements.video.removeAttribute('src'); elements.video.load();
}

async function mediaTicket(source, signal, download = false) {
  const response = await fetch(`${MEDIA_BACKEND_URL}/api/media-ticket`, {
    method: 'POST', mode: 'cors', credentials: 'omit', cache: 'no-store',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify({ target: source, download }), signal,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(String(data?.code || `HTTP_${response.status}`));
  const playbackUrl = new URL(String(data?.playbackUrl || ''));
  if (playbackUrl.protocol !== 'https:') throw new Error('INVALID_PLAYBACK_URL');
  return playbackUrl.href;
}

async function tryCandidate() {
  if (!state.selected || !state.session) return;
  stopPlayback(); const attempt = state.playbackAttempt;
  const source = mediaCandidates(state.selected)[state.candidateIndex];
  if (!source) {
    elements.playerMessage.textContent = 'Nenhum dos endereços disponíveis respondeu neste navegador.';
    elements.video.hidden = true; elements.play.hidden = false; return;
  }
  elements.playerMessage.textContent = ''; elements.play.hidden = true;
  const controller = new AbortController(); state.ticketController = controller;
  const timer = window.setTimeout(() => controller.abort(), TICKET_TIMEOUT_MS);
  try {
    const playbackUrl = await mediaTicket(source, controller.signal);
    if (attempt !== state.playbackAttempt || !state.session) return;
    state.ticketController = null; elements.playerMessage.textContent = '';
    elements.video.crossOrigin = 'anonymous'; elements.video.hidden = false; elements.video.src = playbackUrl;
    elements.video.load(); void elements.video.play().catch(() => {});
  } catch (error) {
    if (attempt !== state.playbackAttempt) return;
    state.ticketController = null; elements.video.hidden = true; elements.play.hidden = false;
    const aborted = error instanceof DOMException && error.name === 'AbortError';
    elements.playerMessage.textContent = aborted ? 'O serviço demorou para responder. Tente novamente.'
      : `O serviço HTTPS ainda não conseguiu preparar esta mídia (${readableError(error)}).`;
  } finally { window.clearTimeout(timer); }
}

async function downloadSelected() {
  if (!state.selected || String(state.session?.accountType || state.account?.accountType || '').toUpperCase() !== 'PREMIUM') return;
  const source = mediaCandidates(state.selected)[0];
  if (!source) return;
  elements.download.disabled = true;
  try {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), TICKET_TIMEOUT_MS);
    const url = await mediaTicket(source, controller.signal, true).finally(() => window.clearTimeout(timer));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = String(state.selected.name || 'filme');
    anchor.rel = 'noopener'; document.body.append(anchor); anchor.click(); anchor.remove();
  } catch (error) { notice(`Não foi possível iniciar o download (${readableError(error)}).`); }
  finally { elements.download.disabled = false; }
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
    if (rememberPin) {
      try { await saveProfilePin(state.auth.login, profile, pin); }
      catch { notice('O perfil foi aberto, mas este aparelho não disponibilizou o cofre protegido para o PIN.'); }
    }
    else await deleteProfilePin(state.auth.login, profile).catch(() => {});
    await persistAuthOnDevice();
    state.pendingProfile = 0; elements.profilePin.value = '';
    if (elements.profilePinDialog.open) elements.profilePinDialog.close();
    updateSessionUi(); showScreen('app'); enterMovieView(false); startSessionWatcher();
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
  state.sessionWatcher?.abort(); state.sessionWatcher = null; stopPlayback();
  if (elements.modal.open) elements.modal.close();
  state.session = null; state.adultView = false; state.selected = null; state.filtered = []; state.favorites = new Set(); elements.grid.replaceChildren();
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
  state.auth = null; state.account = null; state.rememberDevice = false; elements.password.value = '';
  elements.rememberLogin.checked = false;
  elements.loginError.textContent = ''; showScreen('login'); setBusy(false);
}

function enterMovieView(adult = false) {
  state.adultView = adult;
  elements.moviesNav.classList.toggle('active', !adult); elements.adultNav.classList.toggle('active', adult);
  elements.heading.textContent = adult ? 'Filmes Adulto' : 'Filmes';
  elements.kicker.textContent = adult ? 'CONTEÚDO ADULTO 18+' : 'CATÁLOGO ON DEMAND';
  elements.search.placeholder = adult ? 'Buscar filmes adultos...' : 'Buscar filmes...'; elements.search.value = '';
  renderCategoryFilters(); applyFilters();
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
elements.moviesNav.addEventListener('click', () => enterMovieView(false));
elements.adultNav.addEventListener('click', () => { void openAdultSection(); });
$$('.future-section').forEach(button => button.addEventListener('click', () => notice(`${button.dataset.future} já está estruturado e será ativado quando o catálogo correspondente for adicionado.`)));

elements.video.addEventListener('playing', () => { elements.playerMessage.textContent = 'Reproduzindo por HTTPS seguro.'; elements.play.hidden = true; });
elements.video.addEventListener('canplay', () => { void elements.video.play().catch(() => { elements.playerMessage.textContent = 'Mídia pronta. Pressione o botão de reprodução do player.'; }); });
elements.video.addEventListener('error', () => { state.candidateIndex += 1; void tryCandidate(); });
elements.play.addEventListener('click', () => { void tryCandidate(); });
elements.trailer.addEventListener('click', () => {
  const url = elements.trailer.dataset.url;
  if (url) window.open(url, '_blank', 'noopener,noreferrer');
});
elements.download.addEventListener('click', () => { void downloadSelected(); });
elements.close.addEventListener('click', () => elements.modal.close());
elements.modal.addEventListener('close', stopPlayback);
elements.search.addEventListener('input', applyFilters); elements.category.addEventListener('change', applyFilters);
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
elements.loadMore.addEventListener('click', () => { state.visible += PAGE_SIZE; renderGrid(); });
elements.grid.addEventListener('scroll', () => {
  if (state.visible < state.filtered.length && elements.grid.scrollTop + elements.grid.clientHeight >= elements.grid.scrollHeight - 700) {
    state.visible += PAGE_SIZE; renderGrid();
  }
});

async function start() {
  let fallbackLogin = '';
  try {
    fallbackLogin = localStorage.getItem(SAVED_LOGIN_KEY) || '';
    elements.username.value = fallbackLogin;
  } catch { /* armazenamento opcional */ }
  const catalogTask = currentCatalog().then((catalog) => {
    state.catalog = catalog;
    state.categories = [...state.catalog.categories];
    elements.status.textContent = '';
  }).catch((error) => {
    elements.status.textContent = readableError(error); elements.status.classList.add('error');
  });

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
  await catalogTask;
}

if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
void start();
