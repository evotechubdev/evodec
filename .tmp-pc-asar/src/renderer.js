const state = {
  session: null,
  user: null,
  profile: null,
  section: 'channels',
  view: 'grid',
  category: 'all',
  categories: [],
  items: [],
  filtered: [],
  page: 0,
  total: 0,
  hasMore: false,
  catalogLoading: false,
  catalogRequestId: 0,
  playback: null,
  playbackId: 0,
  seriesDetails: null,
  adult: false,
  adultMenuOpen: false,
  extrasMenuOpen: false,
  categoryNames: new Map(),
  views: new Map(),
  favoriteAccount: '',
  showCategories: [],
  moviePreview: null,
  seriesItem: null,
  seriesSeason: '',
  seriesEpisodes: [],
  favoriteEpisodesOnly: false,
  resumePlayback: null,
  gameOpen: false,
  gameFullscreen: false,
  gameControlsVisible: false,
};

const sectionConfig = {
  channels: {
    title: 'Canais', kicker: 'TELEVISÃO AO VIVO', search: 'Buscar canais...',
    categories: 'get_live_categories', items: 'get_live_streams', id: 'stream_id', image: 'stream_icon', kind: 'live',
  },
  movies: {
    title: 'Filmes', kicker: 'CATÁLOGO ON DEMAND', search: 'Buscar filmes...',
    categories: 'get_vod_categories', items: 'get_vod_streams', id: 'stream_id', image: 'stream_icon', kind: 'movie',
  },
  series: {
    title: 'Séries', kicker: 'TEMPORADAS E EPISÓDIOS', search: 'Buscar séries...',
    categories: 'get_series_categories', items: 'get_series', id: 'series_id', image: 'cover', kind: 'series',
  },
  shows: {
    title: 'Shows', kicker: 'APRESENTAÇÕES ON DEMAND', search: 'Buscar shows...', sourceSection: 'movies',
    categories: 'get_vod_categories', items: 'get_vod_streams', id: 'stream_id', image: 'stream_icon', kind: 'movie',
  },
  extras: {
    title: 'Mininovelas Verticais', kicker: 'CONTEÚDO EXTRA', search: 'Buscar séries no ReelShort...',
    id: 'id', image: 'imageUrl', kind: 'series',
  },
  games: {
    title: 'Games', kicker: 'CONTEÚDO EXTRA', search: 'Buscar games...', kind: 'game',
  },
};

let gameBoundsFrame = 0;
let gameResizeObserver = null;
let gameControlsTimer = null;
let activeGameMusicId = '';
const gameMusicAudio = new Audio();
gameMusicAudio.loop = true;
gameMusicAudio.preload = 'none';
const embeddedGameCatalog = Object.freeze([
  {
    id: 'nfsu2',
    title: 'Need for Speed Underground 2',
    image: '../assets/nfsu2-cover-hd.png',
    description: 'Jogo eletrônico de corrida, desenvolvido em 2004 pela EA Black Box e publicado pela Electronic Arts, sendo a oitava edição da série Need for Speed.',
    musicTitle: 'Get Low',
    musicArtist: 'Lil Jon & The East Side Boyz com Ying Yang Twins',
    music: '../assets/game-music/get-low.mp3',
    musicFile: 'get-low.mp3',
    status: 'Os arquivos e os saves são administrados pelo site nfsu-2.online.',
  },
  {
    id: 'bt3',
    title: 'Dragon Ball Z: Budokai Tenkaichi 3',
    image: '../assets/bt3-cover-hd.png',
    description: 'Dragon Ball Z: Budokai Tenkaichi 3 é um jogo eletrônico para PlayStation 2 e Wii em 3D, de gêneros ação e luta, desenvolvido pela Spike e publicado pela Atari. Foi lançado em 2007.',
    musicTitle: 'Temos a Força',
    musicArtist: '',
    music: '../assets/game-music/temos-a-forca.m4a',
    musicFile: 'temos-a-forca.m4a',
    status: 'O jogo, as partidas e os saves são administrados pelo site dragonballbt3.online.',
  },
]);

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const initialCategory = section => window.catalogOrganization?.initialCategory(section) || (section === 'channels' ? 'evo_channel_list' : 'evo_recent');
const recentCategory = () => window.catalogOrganization?.RECENT_CATEGORY || 'evo_recent';
const contentFavoritesCategory = () => window.catalogOrganization?.CONTENT_FAVORITES_CATEGORY || 'evo_content_favorites';
const extraFavoritesCategory = () => 'evo_extra_favorites';
const normalized = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const isShowCategory = category => /(^|\s)shows?(\s|$)/.test(normalized(category?.category_name));
const showCategoryKey = category => `${category?.evo_source_section || 'movies'}:${category?.category_id || ''}`;
const currentShowCategory = categoryKey => state.showCategories.find(category => showCategoryKey(category) === String(categoryKey || ''));
const mediaKind = (item, config = sectionConfig[state.section]) => item?.evo_extra_series ? 'series' : state.section === 'shows' ? 'movie' : config.kind;
const mediaSourceKind = (item, config = sectionConfig[state.section]) => item?.evo_extra_series ? 'extra' : state.section === 'shows' ? (item?.evo_show_kind || 'movie') : config.kind;

async function detectShows() {
  const [vodCategories, liveCategories] = await Promise.all([
    window.tv.request('get_vod_categories', {}, false).catch(() => []),
    window.tv.request('get_live_categories', {}, false).catch(() => []),
  ]);
  state.showCategories = [
    ...(Array.isArray(vodCategories) ? vodCategories : []).filter(isShowCategory)
      .map(category => ({ ...category, evo_source_section: 'movies', evo_show_kind: 'movie' })),
    ...(Array.isArray(liveCategories) ? liveCategories : []).filter(isShowCategory)
      .map(category => ({ ...category, evo_source_section: 'channels', evo_show_kind: 'live' })),
  ];
  $('#shows-nav').classList.toggle('hidden', state.showCategories.length === 0);
}

function showLoginError(message = '') {
  $('#login-error').textContent = message;
}

function errorMessage(error) {
  return String(error?.message || error || 'Não foi possível concluir a operação.')
    .replace(/^Error invoking remote method '[^']+': Error: /, '')
    .replace(/\bIPTV\b/gi, 'TV');
}

let loginFormEdited = false;
$('#username').addEventListener('input', () => { loginFormEdited = true; });
$('#password').addEventListener('input', () => { loginFormEdited = true; });
$('#remember-login').addEventListener('change', async (event) => {
  loginFormEdited = true;
  if (event.currentTarget.checked) return;
  try { await window.evoAuth?.forgetLogin?.(); }
  catch { showLoginError('Não foi possível apagar o login e a senha salvos.'); }
});

async function restoreRememberedLogin(force = false) {
  if (!window.evoAuth?.rememberedLogin || (loginFormEdited && !force)) return;
  try {
    const credentials = await window.evoAuth.rememberedLogin();
    if (loginFormEdited && !force) return;
    $('#username').value = credentials?.login || '';
    $('#password').value = credentials?.password || '';
    $('#remember-login').checked = Boolean(credentials);
  } catch {
    if (force) {
      $('#password').value = '';
      $('#remember-login').checked = false;
    }
  }
}

restoreRememberedLogin();
window.tv?.version?.().then(version => {
  $('#login-version').textContent = `Versão ${version || '—'} • Windows`;
}).catch(() => {});

$('#login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  showLoginError();
  if (!window.evoAuth?.login) {
    showLoginError('Abra o aplicativo pelo arquivo iniciar-player.bat, não pelo index.html.');
    return;
  }
  const button = $('#login-button');
  const login = $('#username').value.trim();
  const password = $('#password').value;
  if (!login || !password) {
    showLoginError('Informe login e senha para continuar.');
    return;
  }
  button.disabled = true;
  button.firstElementChild.textContent = 'ENTRANDO...';
  try {
    const result = await window.evoAuth.login(login, password, $('#remember-login').checked);
    state.user = result.user;
    state.favoriteAccount = window.favoriteAccountKey?.(login) || '';
    $('#password').value = '';
    $('#login-screen').classList.add('hidden');
    $('#profile-screen').classList.remove('hidden');
    renderProfiles();
    if (result.rememberWarning) $('#profile-error').textContent = result.rememberWarning;
  } catch (error) {
    showLoginError(errorMessage(error));
  } finally {
    button.disabled = false;
    button.firstElementChild.textContent = 'ENTRAR';
  }
});

function renderProfiles() {
  const grid = $('#profile-grid');
  grid.innerHTML = '';
  $('#profile-error').textContent = '';
  $('#profile-user').textContent = `${state.user.screens} ${state.user.screens === 1 ? 'perfil disponível' : 'perfis disponíveis'}`;
  for (let index = 1; index <= state.user.screens; index += 1) {
    const profileName = state.user.profileNames?.[index - 1] || `Perfil ${index}`;
    const button = document.createElement('button');
    button.className = 'profile-card';
    button.type = 'button';
    button.innerHTML = '<span class="profile-avatar"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10Zm0-2a3 3 0 1 1 0-6 3 3 0 0 1 0 6Zm0 3c-5 0-8 2.5-8 5v3h16v-3c0-2.5-3-5-8-5Zm-6 5c0-.92 1.9-3 6-3s6 2.08 6 3v1H6v-1Z"/></svg></span><strong></strong><small></small>';
    button.querySelector('strong').textContent = profileName;
    button.querySelector('small').textContent = `Perfil ${index}`;
    button.addEventListener('click', () => selectProfile(index, null));
    grid.append(button);
  }
}

window.evoAuth?.onSessionEnded(async (event) => {
  const details = event && typeof event === 'object' ? event : { message: event, recoverable: false };
  if (details.recoverable && state.user) {
    const message = details.code === 'SESSION_INVALID'
      ? 'A sessão deste perfil não foi encontrada. Selecione o perfil novamente para recriá-la.'
      : `${details.message || 'A sessão deste perfil foi encerrada.'} Selecione um perfil para continuar.`;
    returnToProfileSelection(message);
    return;
  }
  await logout();
  showLoginError(details.message || 'Este perfil foi aberto em outro dispositivo.');
});

async function selectProfile(profile, pin = null, rememberPin = false) {
  const buttons = $$('.profile-card');
  buttons.forEach((button) => { button.disabled = true; });
  $('#profile-error').textContent = 'Conectando ao servidor TV...';
  try {
    state.session = await window.evoAuth.selectProfile(profile, pin, rememberPin);
    if (state.session.pinRequired) {
      window.profileOptions.requestProfilePin(profile, state.session.pinError || '');
      buttons.forEach((button) => { button.disabled = false; });
      return;
    }
    window.profileOptions?.closeProfilePin();
    state.profile = profile;
    window.favoriteChannels?.select(state.favoriteAccount, profile);
    window.adultFavoriteChannels?.select(state.favoriteAccount, profile);
    window.favoriteContent?.select(state.favoriteAccount, profile);
    window.playbackProgress?.select(state.favoriteAccount, profile);
    state.user.accountType = window.resolveAccountType(state.session.accountType, state.user.accountType);
    clearNavigation();
    window.profileOptions?.changed();
    $('#server-label').textContent = state.user.profileNames?.[profile - 1] || `Perfil ${profile}`;
    $('#profile-screen').classList.add('hidden');
    $('#app-screen').classList.remove('hidden');
    if (state.session.rememberPinWarning) window.profileOptions?.notice(state.session.rememberPinWarning);
    await detectShows().catch(() => {});
    await loadSection('channels');
  } catch (error) {
    $('#profile-error').textContent = errorMessage(error);
    $('#profile-pin-error').textContent = errorMessage(error);
    if (pin === null) window.profileOptions.requestProfilePin(profile, errorMessage(error));
    buttons.forEach((button) => { button.disabled = false; });
  }
}

function positionExtrasMenu() {
  if (!state.extrasMenuOpen) return;
  const menu = $('#extra-types');
  const top = Math.max(12, Math.min($('#extras-nav').getBoundingClientRect().top, window.innerHeight - menu.offsetHeight - 12));
  menu.style.setProperty('--extra-menu-top', `${top}px`);
}
function collapseExtrasMenu() {
  state.extrasMenuOpen = false;
  $('#extra-types').classList.add('hidden');
  $('#extras-nav').setAttribute('aria-expanded', 'false');
}
function expandExtrasMenu() {
  state.extrasMenuOpen = true;
  $('#extra-types').classList.remove('hidden');
  $('#extras-nav').setAttribute('aria-expanded', 'true');
  positionExtrasMenu();
}
$('#extras-nav').addEventListener('click', () => state.extrasMenuOpen ? collapseExtrasMenu() : expandExtrasMenu());
$$('[data-extra-section]').forEach(button => button.addEventListener('click', () => {
  if (!state.extrasMenuOpen) return;
  if (button.dataset.extraSection === 'vertical-mininovelas') loadSection('extras');
  if (button.dataset.extraSection === 'games') loadSection('games');
}));
window.addEventListener('resize', positionExtrasMenu);
document.querySelector('.sidebar').addEventListener('scroll', positionExtrasMenu);
$$('.nav-item[data-section]').forEach((button) => button.addEventListener('click', () => loadSection(button.dataset.section)));
$$('[data-view]').forEach((button) => button.addEventListener('click', () => {
  state.view = button.dataset.view;
  $$('[data-view]').forEach((item) => item.classList.toggle('active', item === button));
  $('#media-grid').classList.toggle('list-view', state.view === 'list');
}));

let searchTimer = null;
$('#search-input').addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => state.section === 'games' ? renderGamesSection() : loadCatalogPage(true), 180);
});
$('#media-grid').addEventListener('scroll', (event) => {
  if (state.section === 'games') return;
  const grid = event.currentTarget;
  if (grid.scrollHeight - grid.scrollTop - grid.clientHeight < 700) loadCatalogPage(false);
});
$('#category-strip').addEventListener('wheel', event => {
  const strip = event.currentTarget;
  if (strip.scrollWidth > strip.clientWidth && Math.abs(event.deltaY) > Math.abs(event.deltaX)) {
    strip.scrollLeft += event.deltaY;
    event.preventDefault();
  }
}, { passive: false });
$('#logout-button').addEventListener('click', logout);
$('#switch-profile-button').addEventListener('click', switchProfile);
$('#back-to-login').addEventListener('click', logout);
$('#close-player').addEventListener('click', closePlayer);
$('#player-dialog').addEventListener('cancel', (event) => { event.preventDefault(); closePlayer(); });
$('#close-series').addEventListener('click', closeSeriesDetails);
$('#close-movie').addEventListener('click', closeMoviePreview);
$('#close-resume').addEventListener('click', closeResumeDialog);
$('#close-channel-choices').addEventListener('click', closeChannelChoices);
$('#player-dialog').addEventListener('click', (event) => {
  if (event.target === $('#player-dialog')) closePlayer();
});
$('#series-dialog').addEventListener('click', (event) => {
  if (event.target === $('#series-dialog')) closeSeriesDetails();
});
$('#movie-dialog').addEventListener('cancel', (event) => { event.preventDefault(); closeMoviePreview(); });
$('#movie-dialog').addEventListener('click', (event) => { if (event.target === $('#movie-dialog')) closeMoviePreview(); });
$('#resume-dialog').addEventListener('cancel', (event) => { event.preventDefault(); closeResumeDialog(); });
$('#channel-dialog').addEventListener('cancel', (event) => { event.preventDefault(); closeChannelChoices(); });
$('#channel-dialog').addEventListener('click', (event) => {
  if (event.target === $('#channel-dialog')) closeChannelChoices();
});

async function logout() {
  window.profileOptions?.close();
  closePlayer();
  closeSeriesDetails();
  closeChannelChoices();
  await window.tv.logout().catch(() => {});
  state.session = null;
  state.user = null;
  state.profile = null;
  state.favoriteAccount = '';
  window.favoriteChannels?.select('', 0);
  window.adultFavoriteChannels?.select('', 0);
  window.favoriteContent?.select('', 0);
  window.playbackProgress?.select('', 0);
  state.items = [];
  clearNavigation();
  window.profileOptions?.changed();
  $('#app-screen').classList.add('hidden');
  $('#profile-screen').classList.add('hidden');
  $('#login-screen').classList.remove('hidden');
  loginFormEdited = false;
  $('#username').value = '';
  $('#password').value = '';
  $('#remember-login').checked = false;
  restoreRememberedLogin(true);
  showLoginError();
}

async function switchProfile() {
  window.profileOptions?.close();
  closePlayer();
  closeSeriesDetails();
  closeChannelChoices();
  try {
    state.user = await window.evoAuth.switchProfile();
    returnToProfileSelection();
  } catch (error) {
    await logout();
    showLoginError(errorMessage(error));
  }
}

function returnToProfileSelection(message = '') {
  window.profileOptions?.close();
  closePlayer();
  closeSeriesDetails();
  closeChannelChoices();
  state.session = null;
  state.profile = null;
  window.favoriteChannels?.select('', 0);
  window.adultFavoriteChannels?.select('', 0);
  window.favoriteContent?.select('', 0);
  window.playbackProgress?.select('', 0);
  state.items = [];
  clearNavigation();
  $('#app-screen').classList.add('hidden');
  $('#login-screen').classList.add('hidden');
  $('#profile-screen').classList.remove('hidden');
  renderProfiles();
  $('#profile-error').textContent = message;
}

function clearNavigation() {
  closeEmbeddedGame();
  window.profileOptions?.collapseAdults();
  collapseExtrasMenu();
  state.views.clear(); state.page = 0; state.items = []; state.filtered = []; state.categories = []; state.categoryNames.clear();
  state.catalogRequestId += 1; state.catalogLoading = false; state.total = 0; state.hasMore = false;
  $('#media-grid').replaceChildren();
  state.showCategories = [];
  $('#shows-nav').classList.add('hidden');
}
function saveCurrentView() {
  if (!state.page || state.catalogLoading || state.items.length > 480) return;
  const grid = $('#media-grid');
  const scrollTop = grid.scrollTop;
  const fragment = document.createDocumentFragment();
  while (grid.firstChild) fragment.append(grid.firstChild);
  state.views.set(`${state.adult}:${state.section}`, { until: Date.now() + 5 * 60_000, fragment, scrollTop, category: state.category, query: $('#search-input').value, categories: state.categories, items: [...state.items], page: state.page, total: state.total, hasMore: state.hasMore });
}
async function loadSection(section, adult = false) {
  if (!sectionConfig[section]) return;
  if (adult && (state.session?.adultVisible === false || state.session?.parental?.adultVisible === false || !state.session?.adultAllowed || !state.adultMenuOpen)) return;
  if (state.section === 'games') await closeEmbeddedGame();
  if (section !== 'games') stopGameMusic();
  if (!adult) window.profileOptions?.collapseAdults();
  if (!['extras', 'games'].includes(section)) collapseExtrasMenu();
  saveCurrentView();
  state.catalogRequestId += 1;
  state.section = section;
  state.adult = adult === true;
  state.category = section === 'shows' ? showCategoryKey(state.showCategories[0]) : section === 'extras' ? 'reelshort' : section === 'games' ? 'all' : initialCategory(section);
  if (section === 'shows' && !state.category) return;
  state.items = [];
  state.categories = [];
  state.page = 0;
  state.total = 0;
  state.hasMore = true;
  state.catalogLoading = false;
  $('#search-input').value = '';
  const config = sectionConfig[section];
  $('#section-title').textContent = state.adult ? { channels: 'Canais Adultos', series: 'Séries Adulto', movies: 'Filmes Adulto' }[section] : config.title;
  $('#section-kicker').textContent = config.kicker;
  $('#search-input').placeholder = config.search;
  $$('.nav-item').forEach((button) => button.classList.toggle('active', button.id === 'adult-nav' ? state.adult : button.id === 'extras-nav' ? !state.adult && ['extras', 'games'].includes(section) : !state.adult && button.dataset.section === section));
  $$('[data-adult-section]').forEach((button) => button.classList.toggle('active', button.dataset.adultSection === section));
  $$('[data-extra-section]').forEach((button) => button.classList.toggle('active', (section === 'extras' && button.dataset.extraSection === 'vertical-mininovelas') || (section === 'games' && button.dataset.extraSection === 'games')));
  $('#view-switch').classList.toggle('hidden', !['channels', 'shows'].includes(section));
  document.querySelector('.search-box').classList.toggle('hidden', section === 'games');
  $('#category-strip').classList.toggle('hidden', section === 'games');
  $('#media-grid').classList.toggle('game-mode', section === 'games');
  if (section === 'games') {
    renderGamesSection();
    return;
  }
  const saved = state.views.get(`${state.adult}:${section}`);
  if (saved && saved.until > Date.now() && saved.category === state.category) {
    state.category = saved.category; state.categories = saved.categories; state.categoryNames = new Map(saved.categories.map((item) => [String(item.category_id), item.category_name]));
    state.items = saved.items; state.filtered = state.items; state.page = saved.page; state.total = saved.total; state.hasMore = saved.hasMore;
    $('#search-input').value = saved.query;
    renderCategories();
    $('#media-grid').replaceChildren(saved.fragment);
    $('#media-grid').scrollTop = saved.scrollTop;
    $('#media-grid').classList.toggle('list-view', state.view === 'list' && ['channels', 'shows'].includes(section));
    updateCatalogStatus();
    return;
  }
  renderSkeletons();
  $('#status-line').textContent = '';

  try {
    const requestId = state.catalogRequestId;
    const adultScope = state.adult;
    const [categories] = await Promise.all([
      section === 'shows' ? Promise.resolve(state.showCategories)
        : section === 'extras' ? window.tv.extraCatalog().then(result => (result?.categories || []).map(category => ({ category_id: category.id, category_name: category.name })))
          : window.tv.request(config.categories, {}, adultScope),
      loadCatalogPage(true, requestId),
    ]);
    if (state.section !== section || state.adult !== adultScope || state.catalogRequestId !== requestId) return;
    state.categories = section === 'shows'
      ? (Array.isArray(categories) ? categories : [])
      : (Array.isArray(categories) ? categories : []);
    if (['movies', 'series'].includes(section)) {
      state.categories = [{ category_id: contentFavoritesCategory(), category_name: adultScope ? 'Favoritos Adultos' : 'Favoritos' },
        ...state.categories.filter(category => String(category.category_id) !== contentFavoritesCategory())];
    }
    if (section === 'extras') {
      state.categories = [
        ...state.categories.filter(category => String(category.category_id) !== extraFavoritesCategory()),
        { category_id: extraFavoritesCategory(), category_name: 'Favoritos' },
      ];
    }
    state.categoryNames = new Map(state.categories.map((item) => [state.section === 'shows' ? showCategoryKey(item) : String(item.category_id), item.category_name]));
    renderCategories();
  } catch (error) {
    if (state.section !== section) return;
    $('#category-strip').innerHTML = '';
    $('#status-line').innerHTML = '<span>Não foi possível carregar o catálogo.</span>';
    renderEmpty(errorMessage(error), true);
  }
}

function embeddedGameBounds() {
  const viewport = $('#game-viewport');
  if (!viewport) return null;
  const rect = viewport.getBoundingClientRect();
  const topInset = state.gameFullscreen ? (state.gameControlsVisible ? 44 : 6) : 0;
  return {
    x: Math.round(rect.left),
    y: Math.round(rect.top + topInset),
    width: Math.max(320, Math.round(rect.width)),
    height: Math.max(240, Math.round(rect.height - topInset)),
  };
}

function syncEmbeddedGameBounds() {
  if (!state.gameOpen || !window.games?.bounds) return;
  cancelAnimationFrame(gameBoundsFrame);
  gameBoundsFrame = requestAnimationFrame(() => {
    const bounds = embeddedGameBounds();
    if (bounds) window.games.bounds(bounds).catch(() => {});
  });
}

function updateEmbeddedGameFullscreen() {
  const panel = $('.embedded-game-panel');
  state.gameFullscreen = Boolean(panel && document.fullscreenElement === panel);
  const button = $('#toggle-embedded-game-size');
  if (button) {
    button.textContent = state.gameFullscreen ? '↙ Restaurar' : '⛶ Tela cheia';
    button.title = state.gameFullscreen ? 'Restaurar o game dentro do EVO' : 'Exibir o game em tela cheia';
    button.setAttribute('aria-pressed', String(state.gameFullscreen));
  }
  if (!state.gameFullscreen) showEmbeddedGameControls(true, false);
  else showEmbeddedGameControls(false, false);
  requestAnimationFrame(syncEmbeddedGameBounds);
}

function hideEmbeddedGameControls() {
  const toolbar = $('.embedded-game-toolbar');
  if (!state.gameFullscreen || toolbar?.matches(':hover')) {
    gameControlsTimer = setTimeout(hideEmbeddedGameControls, 700);
    return;
  }
  showEmbeddedGameControls(false, false);
}

function showEmbeddedGameControls(visible = true, autoHide = true) {
  clearTimeout(gameControlsTimer);
  const panel = $('.embedded-game-panel');
  state.gameControlsVisible = !state.gameFullscreen || visible;
  panel?.classList.toggle('controls-visible', state.gameControlsVisible);
  requestAnimationFrame(syncEmbeddedGameBounds);
  if (state.gameFullscreen && state.gameControlsVisible && autoHide) {
    gameControlsTimer = setTimeout(hideEmbeddedGameControls, 2400);
  }
}

function toggleEmbeddedGameFullscreen() {
  const panel = $('.embedded-game-panel');
  if (!panel) return Promise.resolve();
  const operation = document.fullscreenElement === panel ? document.exitFullscreen() : panel.requestFullscreen();
  return operation.catch(() => {});
}

async function closeEmbeddedGame(restoreGames = false) {
  state.gameOpen = false;
  clearTimeout(gameControlsTimer);
  if (document.fullscreenElement === $('.embedded-game-panel')) await document.exitFullscreen().catch(() => {});
  state.gameFullscreen = false;
  state.gameControlsVisible = false;
  cancelAnimationFrame(gameBoundsFrame);
  gameResizeObserver?.disconnect();
  gameResizeObserver = null;
  await window.games?.close?.().catch(() => {});
  if (restoreGames && state.section === 'games') renderGamesSection();
}

async function openEmbeddedGame(gameId) {
  const game = embeddedGameCatalog.find(item => item.id === String(gameId || ''));
  if (!game) return;
  stopGameMusic();
  const grid = $('#media-grid');
  grid.classList.add('game-mode');
  grid.innerHTML = `
    <section class="embedded-game-panel" aria-label="${game.title}">
      <header class="embedded-game-toolbar">
        <div class="embedded-game-actions">
          <button id="toggle-embedded-game-size" type="button" aria-pressed="false" title="Exibir o game em tela cheia">⛶ Tela cheia</button>
          <button id="close-embedded-game" type="button" title="Fechar o game">× Fechar</button>
        </div>
      </header>
      <div id="game-viewport" class="embedded-game-viewport" aria-label="Janela incorporada do game">
        <div class="embedded-game-loading"><strong>Preparando o game...</strong><span>A primeira abertura pode demorar enquanto os arquivos são carregados.</span></div>
      </div>
    </section>`;
  const toolbar = $('.embedded-game-toolbar');
  $('#toggle-embedded-game-size').addEventListener('click', toggleEmbeddedGameFullscreen);
  $('#close-embedded-game').addEventListener('click', () => closeEmbeddedGame(true));
  toolbar.addEventListener('pointerenter', () => showEmbeddedGameControls(true));
  toolbar.addEventListener('pointermove', () => showEmbeddedGameControls(true));
  toolbar.addEventListener('pointerleave', () => showEmbeddedGameControls(true));
  state.gameOpen = true;
  gameResizeObserver?.disconnect();
  gameResizeObserver = new ResizeObserver(syncEmbeddedGameBounds);
  gameResizeObserver.observe($('#game-viewport'));
  const fullscreenRequest = toggleEmbeddedGameFullscreen();
  await fullscreenRequest;
  await new Promise(resolve => requestAnimationFrame(resolve));
  try {
    if (!window.games?.open) throw new Error('Atualize o aplicativo para abrir games incorporados.');
    await window.games.open(game.id, embeddedGameBounds());
    $('#status-line').textContent = `Game externo incorporado ao EVOTV. ${game.status}`;
  } catch (error) {
    await closeEmbeddedGame(false);
    renderGamesSection(errorMessage(error));
  }
}

function syncGameMusicCards() {
  $$('.game-launch-card').forEach(card => {
    const game = embeddedGameCatalog.find(item => item.id === card.dataset.gameId);
    const playing = card.dataset.gameId === activeGameMusicId && !gameMusicAudio.paused;
    card.classList.toggle('is-music-playing', playing);
    const label = card.querySelector('[data-game-music-label]');
    if (label && game) label.textContent = `${playing ? '♫ TOCANDO' : '♫ CLIQUE NO CARD PARA TOCAR'} • ${game.musicTitle}${game.musicArtist ? ` — ${game.musicArtist}` : ''}`;
  });
}

function stopGameMusic() {
  gameMusicAudio.pause();
  gameMusicAudio.currentTime = 0;
  activeGameMusicId = '';
  syncGameMusicCards();
}

async function toggleGameMusic(gameId) {
  const game = embeddedGameCatalog.find(item => item.id === String(gameId || ''));
  if (!game) return;
  if (activeGameMusicId === game.id && !gameMusicAudio.paused) {
    gameMusicAudio.pause();
    syncGameMusicCards();
    $('#status-line').textContent = `Música pausada: ${game.musicTitle}.`;
    return;
  }
  if (activeGameMusicId !== game.id) {
    gameMusicAudio.pause();
    gameMusicAudio.src = game.music;
    gameMusicAudio.load();
    activeGameMusicId = game.id;
  }
  try {
    await gameMusicAudio.play();
    syncGameMusicCards();
    $('#status-line').textContent = `Tocando “${game.musicTitle}”${game.musicArtist ? ` — ${game.musicArtist}` : ''}. Clique novamente no card para pausar.`;
  } catch {
    activeGameMusicId = '';
    syncGameMusicCards();
    $('#status-line').textContent = `Não foi possível tocar “${game.musicTitle}”. Adicione o arquivo ${game.musicFile} em assets/game-music.`;
  }
}

function renderGamesSection(error = '') {
  const grid = $('#media-grid');
  grid.classList.add('game-mode');
  state.items = [];
  state.filtered = [];
  state.page = 0;
  state.hasMore = false;
  $('#category-strip').replaceChildren();
  $('#status-line').textContent = error || 'Os games são executados por serviços externos e não fazem parte do pacote do EVOTV.';
  grid.innerHTML = `<section class="game-launch-list" aria-label="Games disponíveis">
    ${embeddedGameCatalog.map(game => `
      <article class="game-launch-card" data-game-id="${game.id}" tabindex="0" aria-label="Tocar ${game.musicTitle}, tema de ${game.title}">
        <div class="game-launch-art">
          <img class="game-launch-image" src="${game.image}" alt="${game.title}" />
        </div>
        <div class="game-launch-copy">
          <span class="game-launch-kicker">GAMES</span>
          <h2>${game.title}</h2>
          <p>${game.description}</p>
          <span class="game-music-hint" data-game-music-label>♫ CLIQUE NO CARD PARA TOCAR • ${game.musicTitle}${game.musicArtist ? ` — ${game.musicArtist}` : ''}</span>
          <button class="primary-button game-launch-button" type="button" data-open-game="${game.id}">JOGAR AGORA</button>
        </div>
      </article>`).join('')}
  </section>`;
  $$('[data-open-game]').forEach(button => {
    button.addEventListener('click', event => {
      event.stopPropagation();
      openEmbeddedGame(button.dataset.openGame);
    });
  });
  $$('.game-launch-card').forEach(card => {
    card.addEventListener('click', event => {
      if (!event.target.closest('[data-open-game]')) toggleGameMusic(card.dataset.gameId);
    });
    card.addEventListener('keydown', event => {
      if (event.target.closest('button') || !['Enter', ' '].includes(event.key)) return;
      event.preventDefault();
      toggleGameMusic(card.dataset.gameId);
    });
  });
  syncGameMusicCards();
}

window.addEventListener('resize', syncEmbeddedGameBounds);
window.games?.onEnded?.(() => {
  if (state.gameOpen) closeEmbeddedGame(true);
});
document.addEventListener('fullscreenchange', () => {
  if (state.gameOpen) updateEmbeddedGameFullscreen();
});

function renderCategories() {
  const strip = $('#category-strip');
  strip.innerHTML = '';
  if (['shows', 'extras'].includes(state.section)) {
    state.categories.forEach((category) => {
      const button = document.createElement('button');
      const categoryKey = state.section === 'shows' ? showCategoryKey(category) : String(category.category_id);
      button.className = `category-button${state.category === categoryKey ? ' active' : ''}`;
      button.dataset.category = categoryKey;
      button.textContent = state.section === 'shows'
        ? `${category.category_name || 'Shows'}${category.evo_show_kind === 'live' ? ' • Ao vivo' : ''}`
        : category.category_name || 'Mininovelas Verticais';
      strip.append(button);
    });
    strip.querySelectorAll('button').forEach((button) => button.addEventListener('click', () => {
      state.category = button.dataset.category;
      strip.querySelectorAll('button').forEach((item) => item.classList.toggle('active', item === button));
      loadCatalogPage(true);
    }));
    return;
  }
  const primaryId = initialCategory(state.section);
  const primary = state.categories.find(category => String(category.category_id) === primaryId) || {
    category_id: primaryId,
    category_name: window.catalogOrganization?.categoryLabel(state.section) || (state.section === 'channels' ? 'Canais Favoritos' : 'Recém Adicionados'),
  };
  const preferredIds = window.catalogOrganization?.categoryOrder(state.section)
    || (state.section === 'movies' ? [primaryId, recentCategory(), contentFavoritesCategory(), 'all'] : [primaryId, 'all']);
  const known = new Map(state.categories.map(category => [String(category.category_id), category]));
  known.set(primaryId, primary);
  known.set('all', { category_id: 'all', category_name: 'Todos' });
  if (state.section === 'movies') {
    known.set(recentCategory(), { category_id: recentCategory(), category_name: 'Recém Adicionados' });
    known.set(contentFavoritesCategory(), { category_id: contentFavoritesCategory(), category_name: 'Favoritos' });
  }
  const ordered = [
    ...preferredIds.map(id => known.get(id)).filter(Boolean),
    ...state.categories.filter(category => !preferredIds.includes(String(category.category_id))),
  ];
  ordered.forEach((category) => {
    const button = document.createElement('button');
    button.className = `category-button${state.category === String(category.category_id) ? ' active' : ''}`;
    button.dataset.category = String(category.category_id);
    button.textContent = category.category_name || 'Sem nome';
    strip.append(button);
  });
  strip.querySelectorAll('button').forEach((button) => button.addEventListener('click', () => {
    state.category = button.dataset.category;
    strip.querySelectorAll('button').forEach((item) => item.classList.toggle('active', item === button));
    loadCatalogPage(true);
  }));
}

async function loadCatalogPage(reset = false, expectedRequestId = null) {
  if (!window.tv?.catalog) throw new Error('Atualize o aplicativo para carregar o catálogo.');
  if (reset) {
    state.catalogRequestId += 1;
    state.page = 0;
    state.total = 0;
    state.hasMore = true;
    state.items = [];
    state.filtered = [];
    state.catalogLoading = false;
    $('#media-grid').scrollTop = 0;
    renderSkeletons(false);
  }
  const requestId = expectedRequestId ?? state.catalogRequestId;
  if (expectedRequestId !== null) state.catalogRequestId = expectedRequestId;
  if (state.catalogLoading || !state.hasMore || requestId !== state.catalogRequestId) return;
  state.catalogLoading = true;
  const page = state.page + 1;
  const section = state.section;
  const category = state.category;
  const adult = state.adult;
  const query = $('#search-input').value.trim();
  $('#status-line').textContent = '';
  try {
    const showCategory = section === 'shows' ? currentShowCategory(category) : null;
    const sourceSection = showCategory?.evo_source_section || sectionConfig[section].sourceSection || section;
    const requestCategory = showCategory ? String(showCategory.category_id) : category;
    const result = section === 'extras'
      ? await window.tv.extraCatalog().then(catalog => {
        const search = normalized(query);
        const favoriteIds = category === extraFavoritesCategory() && window.favoriteContent
          ? new Set(window.favoriteContent.ids('series', false).map(String)) : null;
        const items = (catalog?.series || [])
          .filter(item => (favoriteIds ? favoriteIds.has(String(item.id)) : item.categoryId === category)
            && (!search || normalized(item.name).includes(search)))
          .map(item => ({ ...item, series_id: item.id, cover: item.imageUrl, category_id: item.categoryId, evo_extra_series: true }));
        return { items, total: items.length, hasMore: false };
      })
      : await window.tv.catalog({ section: sourceSection, category: requestCategory, query, page, limit: 48, adult,
        ...(section === 'channels' && category === initialCategory('channels') && channelFavorites() ? { favorites: channelFavorites().list() } : {}),
        ...(['movies', 'series'].includes(section) && category === contentFavoritesCategory() && window.favoriteContent
          ? { favorites: window.favoriteContent.ids(section === 'movies' ? 'movie' : 'series', adult) } : {}) });
    if (requestId !== state.catalogRequestId || section !== state.section || adult !== state.adult || category !== state.category || query !== $('#search-input').value.trim()) return;
    const receivedItems = Array.isArray(result?.items) ? result.items : [];
    const items = showCategory
      ? receivedItems.map(item => ({ ...item, evo_show_kind: showCategory.evo_show_kind, evo_source_section: showCategory.evo_source_section }))
      : receivedItems;
    state.page = page;
    state.total = Number(result?.total) || 0;
    state.hasMore = result?.hasMore === true;
    state.items.push(...items);
    state.filtered = state.items;
    renderItems(items, page > 1);
  } catch (error) {
    if (requestId !== state.catalogRequestId) return;
    if (page === 1) renderEmpty(errorMessage(error), true);
    $('#status-line').innerHTML = '<span>Não foi possível carregar o catálogo.</span>';
  } finally {
    if (requestId === state.catalogRequestId) state.catalogLoading = false;
  }
}

function renderSkeletons(clearCategories = true) {
  if (clearCategories) $('#category-strip').innerHTML = '';
  $('#media-grid').innerHTML = Array.from({ length: 12 }, () => '<article class="media-card skeleton"><div class="poster"></div><div class="media-info"></div></article>').join('');
}

function renderEmpty(message, failed = false) {
  const grid = $('#media-grid');
  grid.innerHTML = '';
  const empty = document.createElement('div');
  empty.className = 'empty-state';
  const content = document.createElement('div');
  const title = document.createElement('strong');
  title.textContent = failed ? 'Não foi possível carregar' : 'Nada por aqui';
  const text = document.createElement('span');
  text.textContent = message || 'Nenhum conteúdo encontrado para este filtro.';
  content.append(title, text);
  if (failed) {
    const retry = document.createElement('button'); retry.type = 'button'; retry.className = 'text-button'; retry.textContent = 'Tentar novamente';
    retry.addEventListener('click', () => loadSection(state.section, state.adult)); content.append(retry);
  }
  empty.append(content);
  grid.append(empty);
}

function renderItems(items = state.filtered, append = false) {
  const grid = $('#media-grid');
  if (!append) grid.innerHTML = '';
  grid.classList.toggle('list-view', state.view === 'list' && ['channels', 'shows'].includes(state.section));
  updateCatalogStatus();
  if (!state.items.length) {
    renderEmpty();
    return;
  }
  const fragment = document.createDocumentFragment();
  items.forEach((item) => fragment.append(createCard(item)));
  grid.append(fragment);
  if (state.hasMore && grid.scrollHeight <= grid.clientHeight + 100) queueMicrotask(() => loadCatalogPage(false));
}
function updateCatalogStatus() {
  $('#status-line').textContent = '';
}

const channelFavorites = () => state.adult ? window.adultFavoriteChannels : window.favoriteChannels;

function syncFavoriteButtons() {
  const selected = new Set(channelFavorites()?.list() || []);
  $$('.favorite-toggle').forEach(button => {
    const active = selected.has(button.dataset.favoriteKey);
    button.classList.toggle('active', active); button.textContent = active ? '★' : '☆';
    button.setAttribute('aria-pressed', String(active)); button.title = active ? 'Remover dos favoritos' : 'Adicionar aos favoritos';
    button.setAttribute('aria-label', `${button.title}: ${button.dataset.favoriteName}`);
  });
}

function changeFavorite(key, move = 0) {
  const favorites = channelFavorites();
  if (!favorites || !key) return;
  if (move) favorites.move(key, move); else favorites.toggle(key);
  state.views.delete(`${state.adult}:channels`);
  if (state.section === 'channels' && state.category === initialCategory('channels')) loadCatalogPage(true);
  else syncFavoriteButtons();
}

function syncContentFavoriteStars() {
  const selected = new Set(window.favoriteContent?.list() || []);
  $$('.content-favorite-star').forEach(star => {
    const active = selected.has(star.dataset.favoriteKey);
    star.classList.toggle('active', active);
    if (star.matches('button')) {
      star.textContent = active ? '★' : '☆';
      star.title = active ? 'Desfavoritar' : 'Favoritar';
      star.setAttribute('aria-label', `${star.title}: ${star.dataset.favoriteName || 'conteúdo'}`);
      star.setAttribute('aria-pressed', String(active));
    }
  });
}

window.addEventListener('content-favorites:changed', () => {
  syncContentFavoriteStars();
  syncSeriesFavoriteControls();
  if (state.seriesSeason) renderEpisodes(state.seriesSeason, state.seriesEpisodes, $('#series-title').textContent);
  state.views.delete(`${state.adult}:${state.section}`);
  if (state.category === contentFavoritesCategory() || state.category === extraFavoritesCategory()) loadCatalogPage(true);
});

function createCard(item) {
  const cardSection = state.section;
  const config = sectionConfig[cardSection];
  const kind = mediaKind(item, config);
  const sourceKind = mediaSourceKind(item, config);
  const card = document.createElement('article');
  card.className = `media-card ${config.kind === 'live' ? 'channel-card' : ''}`;
  card.setAttribute('role', 'group');
  card.setAttribute('aria-label', item.name || 'Conteúdo');

  const poster = document.createElement('div');
  poster.className = 'poster';
  poster.tabIndex = 0;
  poster.setAttribute('role', 'button');
  poster.setAttribute('aria-label', `Reproduzir ${item.name || 'conteúdo'}`);
  const imageUrl = item[config.image];
  if (cardSection === 'shows') {
    poster.append(makeFallback('shows'));
  } else if (imageUrl) {
    const image = document.createElement('img');
    image.src = imageUrl;
    image.alt = '';
    image.loading = 'lazy';
    image.decoding = 'async';
    image.addEventListener('error', () => image.replaceWith(makeFallback(cardSection)));
    poster.append(image);
  } else {
    poster.append(makeFallback(cardSection));
  }
  const play = document.createElement('span');
  play.className = 'poster-play';
  poster.append(play);

  const info = document.createElement('div');
  info.className = 'media-info';
  const title = document.createElement('h3');
  title.textContent = item.name || 'Sem título';
  const meta = document.createElement('p');
  meta.textContent = item.evo_extra_series
    ? 'Mininovela Vertical'
    : state.categoryNames.get(state.section === 'shows' ? state.category : String(item.category_id)) || (state.section === 'shows' ? 'Show' : kind === 'live' ? 'Ao vivo' : state.section === 'movies' ? 'Filme' : 'Série');
  const titleRow = document.createElement('div');
  titleRow.className = 'media-title-row';
  titleRow.append(title);
  if (kind === 'live' && item.evo_favorite_key && channelFavorites()) {
    const actions = document.createElement('span'); actions.className = 'favorite-actions';
    if (state.category === initialCategory('channels')) {
      for (const [direction, label] of [[-1, 'Mover favorito para trás'], [1, 'Mover favorito para frente']]) {
        const move = document.createElement('button'); move.type = 'button'; move.className = 'favorite-move'; move.textContent = direction < 0 ? '←' : '→'; move.setAttribute('aria-label', label);
        move.addEventListener('click', event => { event.stopPropagation(); changeFavorite(item.evo_favorite_key, direction); }); actions.append(move);
      }
    }
    const favorite = document.createElement('button'); favorite.type = 'button'; favorite.className = 'favorite-toggle'; favorite.dataset.favoriteKey = item.evo_favorite_key;
    favorite.dataset.favoriteName = item.evo_favorite_name || item.name || 'canal';
    favorite.addEventListener('click', event => { event.stopPropagation(); changeFavorite(item.evo_favorite_key); }); actions.append(favorite); titleRow.append(actions);
    queueMicrotask(syncFavoriteButtons);
  }
  if (['movie', 'series'].includes(kind)) {
    const media = { kind, sourceKind, show: state.section === 'shows', favoriteKind: sourceKind === 'extra' ? 'series' : sourceKind === 'movie' ? kind : '', favoriteAdult: sourceKind === 'extra' ? false : state.adult, mediaId: item[config.id], extension: sourceKind === 'live' ? liveExtension(item) : (item.container_extension || 'mp4'), title: item.name, downloadable: kind === 'movie' && sourceKind !== 'extra' };
    const favoriteKey = window.favoriteContent?.key(media);
    if (favoriteKey) {
      const star = document.createElement('button'); star.type = 'button'; star.className = 'content-favorite-star content-favorite-toggle'; star.textContent = '☆'; star.dataset.favoriteKey = favoriteKey;
      star.dataset.favoriteName = item.name || (kind === 'series' ? 'série' : 'filme');
      star.addEventListener('click', event => {
        event.stopPropagation();
        const result = window.favoriteContent.toggle(media);
        window.dispatchEvent(new CustomEvent('content-favorites:changed', { detail: result }));
      });
      titleRow.append(star);
    }
    const options = window.downloadOptions?.buttonFor(media);
    if (options) titleRow.append(options);
    queueMicrotask(syncContentFavoriteStars);
  }
  info.append(titleRow, meta);
  card.append(poster, info);

  const open = () => playItem(item);
  card.addEventListener('click', open);
  card.addEventListener('keydown', (event) => {
    if (event.target !== poster) return;
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); }
  });
  return card;
}

function makeFallback(section = state.section) {
  if (section === 'shows') {
    const artwork = document.createElement('img');
    artwork.className = 'fallback-show-art';
    artwork.src = '../assets/fallback-shows.png';
    artwork.alt = '';
    return artwork;
  }
  const fallback = document.createElement('div');
  fallback.className = 'poster-fallback';
  const logo = document.createElement('img');
  logo.className = 'fallback-brand';
  logo.src = '../assets/logo-evotv.png';
  logo.alt = '';
  const label = document.createElement('span');
  label.textContent = { channels: 'CANAIS', movies: 'FILMES', series: 'SÉRIES', extras: 'EXTRA' }[section] || 'EVOTV';
  fallback.append(logo, label);
  return fallback;
}

function liveExtension(item) {
  const extension = String(item?.container_extension || 'ts').replace(/[^a-z0-9]/gi, '').slice(0, 8);
  return extension || 'ts';
}

async function playItem(item) {
  const config = sectionConfig[state.section];
  if (state.section === 'extras' && item.evo_extra_series) {
    openExtraSeries(item);
    return;
  }
  const kind = mediaKind(item, config);
  const sourceKind = mediaSourceKind(item, config);
  if (kind === 'series') {
    await openSeries(item);
    return;
  }
  if (sourceKind === 'live' && state.section === 'channels' && state.category === initialCategory('channels') && Array.isArray(item.evo_live_choices)) {
    openChannelChoices(item);
    return;
  }
  const id = item[config.id];
  const extension = sourceKind === 'live' ? liveExtension(item) : (item.container_extension || 'mp4');
  if (kind === 'movie' && sourceKind === 'movie') {
    openMoviePreview(item, {
      kind, mediaId: id, extension, title: item.name, type: state.section === 'shows' ? 'SHOW' : 'FILME',
      sourceKind, show: state.section === 'shows', favoriteKind: 'movie', favoriteAdult: state.adult,
    });
    return;
  }
  await playMedia(kind, id, extension, item.name, kind === 'live' ? 'AO VIVO' : state.section === 'shows' ? 'SHOW' : 'FILME', {
    sourceKind,
    show: state.section === 'shows',
    liveVariants: kind === 'live' ? item.evo_live_variants : null,
    favoriteKind: kind === 'movie' && sourceKind === 'movie' ? 'movie' : null,
    favoriteAdult: state.adult,
  });
}

function synopsisFrom(item = {}) {
  return String(item.plot || item.description || item.overview || item.info?.plot || item.info?.description || '').trim()
    || 'Sinopse não informada nesta lista.';
}

function trailerFrom(item = {}) {
  const value = String(item.youtube_trailer || item.trailer || item.trailer_url || item.youtubeTrailer || '').trim();
  if (!value) return '';
  if (/^https?:\/\//i.test(value)) return value;
  return /^[a-zA-Z0-9_-]{6,20}$/.test(value) ? `https://www.youtube.com/watch?v=${encodeURIComponent(value)}` : '';
}

function formatProgress(seconds) {
  const value = Math.max(0, Math.floor(Number(seconds) || 0));
  const minutes = Math.floor(value / 60);
  return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}min` : `${minutes}min ${value % 60}s`;
}

function openMoviePreview(item, media) {
  const dialog = $('#movie-dialog');
  const cover = item.stream_icon || item.cover || '';
  state.moviePreview = { item, media };
  $('#movie-title').textContent = item.name || 'Filme';
  $('#movie-plot').textContent = 'Carregando sinopse...';
  $('#movie-cover').src = cover;
  $('#movie-cover').classList.toggle('hidden', !cover);
  const trailer = trailerFrom(item);
  const trailerButton = $('#movie-trailer');
  trailerButton.disabled = !trailer; trailerButton.dataset.url = trailer;
  trailerButton.title = trailer ? 'Abrir trailer' : 'Trailer indisponível nesta lista';
  const progress = window.playbackProgress?.get(media);
  $('#movie-resume').classList.toggle('hidden', !progress);
  $('#movie-resume').textContent = progress ? `Continuar de ${formatProgress(progress.position)}` : 'Continuar';
  $('#movie-play').textContent = progress ? 'Começar do início' : 'Reproduzir';
  dialog.showModal();
  loadMovieDetails(item, media).catch(() => {
    if (state.moviePreview?.media === media) $('#movie-plot').textContent = synopsisFrom(item);
  });
}

function mergedMovieDetails(item, details) {
  const root = details && typeof details === 'object' ? details : {};
  const movie = root.movie_data && typeof root.movie_data === 'object' ? root.movie_data : {};
  const info = root.info && typeof root.info === 'object' ? root.info : {};
  return { ...item, ...movie, ...root, ...info, name: item.name || movie.name || info.name };
}

async function loadMovieDetails(item, media) {
  const details = await window.tv.request('get_vod_info', { vod_id: media.mediaId }, state.adult);
  if (state.moviePreview?.media !== media) return;
  const merged = mergedMovieDetails(item, details);
  state.moviePreview.item = merged;
  $('#movie-plot').textContent = synopsisFrom(merged);
  const cover = merged.movie_image || merged.cover_big || merged.cover || merged.stream_icon || '';
  if (cover) { $('#movie-cover').src = cover; $('#movie-cover').classList.remove('hidden'); }
  const trailer = trailerFrom(merged), button = $('#movie-trailer');
  button.disabled = !trailer; button.dataset.url = trailer;
  button.title = trailer ? 'Abrir trailer' : 'Trailer indisponível para este filme';
}

function closeMoviePreview() {
  state.moviePreview = null;
  const dialog = $('#movie-dialog');
  if (dialog.open) dialog.close();
}

async function playMoviePreview(resume) {
  const preview = state.moviePreview;
  if (!preview) return;
  const progress = resume ? window.playbackProgress?.get(preview.media) : null;
  if (!resume) window.playbackProgress?.clear(preview.media);
  closeMoviePreview();
  await playMedia(preview.media.kind, preview.media.mediaId, preview.media.extension, preview.media.title, preview.media.type, {
    ...preview.media,
    position: progress?.position || 0,
  });
}

$('#movie-trailer').addEventListener('click', event => {
  const url = event.currentTarget.dataset.url;
  if (url) window.open(url, '_blank', 'noopener,noreferrer');
});
$('#movie-resume').addEventListener('click', () => playMoviePreview(true));
$('#movie-play').addEventListener('click', () => playMoviePreview(false));

function requestPlayback(media, operation) {
  const progress = window.playbackProgress?.get(media);
  if (!progress) return operation(0);
  state.resumePlayback = { media, operation, progress };
  $('#resume-title').textContent = media.title || 'Retomar reprodução?';
  $('#resume-description').textContent = `Você parou em ${formatProgress(progress.position)}. Deseja continuar ou começar do início?`;
  $('#resume-dialog').showModal();
}

function closeResumeDialog() {
  state.resumePlayback = null;
  const dialog = $('#resume-dialog');
  if (dialog.open) dialog.close();
}

$('#resume-continue').addEventListener('click', () => {
  const pending = state.resumePlayback; closeResumeDialog();
  pending?.operation(pending.progress.position);
});
$('#resume-restart').addEventListener('click', () => {
  const pending = state.resumePlayback; closeResumeDialog();
  if (pending) { window.playbackProgress?.clear(pending.media); pending.operation(0); }
});

function qualityNames(variants) {
  const labels = ['Padrão', 'SD', 'HD', 'FHD', '4K', '8K'];
  return [...new Set((variants || []).map(variant => labels[Number(variant.quality)] || 'Padrão'))].join(' • ');
}

function openChannelChoices(item) {
  const dialog = $('#channel-dialog');
  $('#channel-title').textContent = item.name || 'Canais';
  $('#channel-description').textContent = item.name === 'A Fazenda'
    ? 'Escolha a câmera que deseja assistir.' : 'Escolha o canal que deseja assistir.';
  const list = $('#channel-choice-list');
  list.replaceChildren();
  (item.evo_live_choices || []).forEach((choice, index) => {
    const button = document.createElement('button');
    button.className = 'episode-button';
    const badge = document.createElement('span');
    badge.className = 'episode-number';
    badge.textContent = String(index + 1).padStart(2, '0');
    const info = document.createElement('span');
    info.className = 'episode-info';
    const heading = document.createElement('strong');
    heading.textContent = choice.name || `Canal ${index + 1}`;
    const meta = document.createElement('small');
    meta.textContent = qualityNames(choice.evo_live_variants) || 'Qualidade padrão';
    info.append(heading, meta);
    const play = document.createElement('span');
    play.className = 'episode-play';
    button.append(badge, info, play);
    button.addEventListener('click', async () => {
      closeChannelChoices();
      await playMedia('live', choice.stream_id, liveExtension(choice), choice.name || item.name, 'AO VIVO', { liveVariants: choice.evo_live_variants });
    });
    list.append(button);
  });
  dialog.showModal();
}

function closeChannelChoices() {
  const dialog = $('#channel-dialog');
  if (dialog.open) dialog.close();
}

async function openSeries(item) {
  const dialog = $('#series-dialog');
  state.seriesItem = item;
  state.favoriteEpisodesOnly = false;
  state.seriesSeason = '';
  state.seriesEpisodes = [];
  $('#series-title').textContent = item.name || 'Série';
  $('#series-plot').textContent = '';
  $('#series-cover').src = item.cover || '';
  $('#series-cover').classList.toggle('hidden', !item.cover);
  $('#series-loading').classList.remove('hidden');
  $('#series-loading').textContent = 'Carregando temporadas...';
  $('#season-tabs').innerHTML = '';
  $('#episode-list').innerHTML = '';
  syncSeriesFavoriteControls();
  dialog.showModal();
  try {
    const details = await window.tv.request('get_series_info', { series_id: item.series_id }, state.adult);
    state.seriesDetails = details;
    renderSeriesDetails(item, details);
  } catch (error) {
    $('#series-loading').textContent = errorMessage(error);
  }
}

function openExtraSeries(item) {
  const dialog = $('#series-dialog');
  state.seriesItem = item;
  state.favoriteEpisodesOnly = false;
  state.seriesSeason = '';
  state.seriesEpisodes = [];
  $('#series-title').textContent = item.name || 'Série';
  $('#series-plot').textContent = item.synopsis || '';
  $('#series-cover').src = item.imageUrl || item.cover || '';
  $('#series-cover').classList.toggle('hidden', !(item.imageUrl || item.cover));
  $('#series-loading').classList.remove('hidden');
  $('#series-loading').textContent = 'Carregando episódios...';
  $('#season-tabs').innerHTML = '';
  $('#episode-list').innerHTML = '';
  syncSeriesFavoriteControls();
  dialog.showModal();
  const episodes = Array.isArray(item.episodes) ? item.episodes.map(episode => ({
    ...episode,
    id: episode.id,
    episode_num: episode.number,
    container_extension: episode.extension || 'm3u8',
    evo_extra: true,
    info: { name: episode.name, duration: episode.duration, episode_num: episode.number },
  })) : [];
  state.seriesDetails = { info: { name: item.name, plot: item.synopsis, cover: item.imageUrl }, episodes: { 1: episodes } };
  renderSeriesDetails(item, state.seriesDetails);
}

function renderSeriesDetails(item, details) {
  const info = details?.info || {};
  const cover = info.cover || info.movie_image || item.cover;
  if (cover) {
    $('#series-cover').src = cover;
    $('#series-cover').classList.remove('hidden');
  }
  $('#series-title').textContent = info.name || item.name || 'Série';
  $('#series-plot').textContent = info.plot || info.description || 'Escolha uma temporada e depois um episódio para assistir.';

  const episodes = details?.episodes || {};
  const seasons = Object.keys(episodes)
    .filter((season) => Array.isArray(episodes[season]) && episodes[season].length)
    .sort((a, b) => Number(a) - Number(b));

  if (!seasons.length) {
    $('#series-loading').textContent = 'Nenhum episódio disponível para esta série.';
    return;
  }

  $('#series-loading').classList.add('hidden');
  const tabs = $('#season-tabs');
  seasons.forEach((season, index) => {
    const button = document.createElement('button');
    button.className = `season-button ${index === 0 ? 'active' : ''}`;
    button.textContent = Number(season) === 0 ? 'Especiais' : `Temporada ${season}`;
    button.addEventListener('click', () => {
      tabs.querySelectorAll('button').forEach((tab) => tab.classList.toggle('active', tab === button));
      renderEpisodes(season, episodes[season], info.name || item.name);
    });
    tabs.append(button);
  });
  renderEpisodes(seasons[0], episodes[seasons[0]], info.name || item.name);
}

function renderEpisodes(season, episodes, seriesName) {
  state.seriesSeason = String(season);
  state.seriesEpisodes = episodes;
  const list = $('#episode-list');
  list.innerHTML = '';
  episodes.forEach((episode, index) => {
    const number = episode.episode_num || episode.info?.episode_num || index + 1;
    const title = episode.title || episode.info?.name || `Episódio ${number}`;
    const duration = episode.info?.duration || episode.info?.duration_secs;
    const button = document.createElement('button');
    button.className = 'episode-button';

    const badge = document.createElement('span');
    badge.className = 'episode-number';
    badge.textContent = `E${String(number).padStart(2, '0')}`;
    const info = document.createElement('span');
    info.className = 'episode-info';
    const heading = document.createElement('strong');
    heading.textContent = title;
    const meta = document.createElement('small');
    meta.textContent = `Temporada ${season}${duration ? ` • ${duration}` : ''}`;
    info.append(heading, meta);
    const play = document.createElement('span');
    play.className = 'episode-play';
    button.append(badge, info, play);
    const extra = episode.evo_extra === true;
    const media = { kind: 'series', sourceKind: extra ? 'extra' : 'series', favoriteKind: 'episode', favoriteAdult: extra ? false : state.adult, mediaId: episode.id, extension: extra ? 'ts' : (episode.container_extension || 'mp4'), title: `${seriesName} — ${title}`, downloadable: true };
    button.addEventListener('click', () => requestPlayback(media, async position => {
      try {
        closeSeriesDetails();
        await playMedia(extra ? 'extra' : 'series', episode.id, extra ? 'm3u8' : media.extension, media.title, `T${season} • E${number}`, { sourceKind: extra ? 'extra' : 'series', favoriteKind: 'episode', favoriteAdult: extra ? false : state.adult, position });
      } catch (error) {
        $('#series-loading').classList.remove('hidden');
        $('#series-loading').textContent = errorMessage(error);
      }
    }));
    const options = window.downloadOptions?.buttonFor(media);
    if (options) {
      const row = document.createElement('div');
      row.className = 'episode-row';
      row.classList.toggle('is-hidden-favorite', state.favoriteEpisodesOnly && !window.favoriteContent?.contains(media));
      const favoriteKey = window.favoriteContent?.key(media);
      if (favoriteKey) {
        const star = document.createElement('span'); star.className = 'content-favorite-star'; star.textContent = '★'; star.dataset.favoriteKey = favoriteKey;
        star.setAttribute('aria-label', 'Favorito'); info.append(star);
      }
      row.append(button, options);
      list.append(row);
      queueMicrotask(syncContentFavoriteStars);
    } else list.append(button);
  });
}

function currentSeriesMedia() {
  const item = state.seriesItem;
  return item ? { kind: 'series', sourceKind: item.evo_extra_series ? 'extra' : 'series', favoriteKind: 'series', favoriteAdult: item.evo_extra_series ? false : state.adult, mediaId: item.series_id, title: item.name, downloadable: false } : null;
}

function syncSeriesFavoriteControls() {
  const media = currentSeriesMedia(), button = $('#favorite-series'), filter = $('#favorite-episodes-filter');
  button.classList.toggle('hidden', !media);
  filter.classList.toggle('hidden', !media);
  const active = Boolean(media && window.favoriteContent?.contains(media));
  button.classList.toggle('active', active);
  const label = state.seriesItem?.evo_extra_series ? 'mininovela' : 'série';
  button.textContent = active ? `★ ${label[0].toUpperCase()}${label.slice(1)} favoritada` : `☆ Favoritar ${label}`;
  filter.classList.toggle('active', state.favoriteEpisodesOnly);
  filter.setAttribute('aria-pressed', String(state.favoriteEpisodesOnly));
}

$('#favorite-series').addEventListener('click', () => {
  const media = currentSeriesMedia();
  if (!media) return;
  const result = window.favoriteContent.toggle(media);
  window.dispatchEvent(new CustomEvent('content-favorites:changed', { detail: result }));
});

$('#favorite-episodes-filter').addEventListener('click', () => {
  state.favoriteEpisodesOnly = !state.favoriteEpisodesOnly;
  syncSeriesFavoriteControls();
  if (state.seriesSeason) renderEpisodes(state.seriesSeason, state.seriesEpisodes, $('#series-title').textContent);
});

function closeSeriesDetails() {
  const dialog = $('#series-dialog');
  state.seriesDetails = null;
  state.seriesItem = null;
  state.seriesSeason = '';
  state.seriesEpisodes = [];
  if (dialog.open) dialog.close();
}

async function playMedia(kind, mediaId, extension, title, type, options = {}) {
  closePlayer();
  const playback = { id: state.playbackId, kind, sourceKind: options.sourceKind || kind, show: options.show === true, mediaId, extension, title, type, url: null, favoriteKind: options.favoriteKind || '', favoriteAdult: options.favoriteAdult === true,
    autoLive: kind === 'live' && Array.isArray(options.liveVariants), atLiveEdge: kind === 'live', position: Number(options.position) || 0, lastProgressSave: 0 };
  state.playback = playback;
  if (kind === 'live' && Array.isArray(options.liveVariants) && options.liveVariants.length > 1 && window.LiveQuality) {
    playback.liveQuality = new window.LiveQuality({ variants: options.liveVariants,
      onSwitch: async variant => {
        if (state.playback !== playback) return;
        const generation = ++state.playbackId; playback.id = generation;
        const variantExtension = liveExtension(variant);
        const url = await window.tv.streamUrl('live', variant.stream_id, variantExtension, { autoLive: true });
        if (state.playback !== playback || playback.id !== generation) return;
        const paused = window.nativePlayer.paused();
        playback.mediaId = variant.stream_id; playback.extension = variantExtension; playback.url = url;
        playback.atLiveEdge = !paused;
        window.downloadOptions?.closeMenu();
        $('#player-type').textContent = type;
        $('#player-title').textContent = title || 'Reproduzindo';
        if (!$('#player-dialog').open) $('#player-dialog').showModal();
        window.downloadOptions?.refresh();
        await attachStream(url, { paused });
      },
      onError: error => {
        if (state.playback !== playback) return;
        closePlayer(); $('#status-line').textContent = errorMessage(error);
      },
    });
    const initial = playback.liveQuality.current();
    if (initial) { playback.mediaId = initial.stream_id; playback.extension = liveExtension(initial); }
  }
  try {
    const url = playback.sourceKind === 'extra'
      ? await window.tv.extraStreamUrl(playback.mediaId)
      : await window.tv.streamUrl(playback.sourceKind, playback.mediaId, playback.extension, playback.autoLive ? { autoLive: true } : undefined);
    if (state.playback !== playback) return;
    playback.url = url;
    window.downloadOptions?.refresh();
    $('#player-type').textContent = type;
    $('#player-title').textContent = title || 'Reproduzindo';
    $('#player-dialog').showModal();
    playback.liveQuality?.reset();
    await attachStream(url, { position: playback.position });
  } catch (error) {
    if (state.playback !== playback) return;
    if (playback.liveQuality?.lower('error')) return;
    closePlayer();
    const status = $('#status-line');
    status.textContent = errorMessage(error);
  }
}

async function restartLiveAtEdge() {
  const playback = state.playback;
  if (!playback || playback.kind !== 'live') return false;
  const generation = ++state.playbackId; playback.id = generation; playback.atLiveEdge = true;
  try {
    const url = await window.tv.streamUrl('live', playback.mediaId, playback.extension || 'ts', playback.autoLive ? { autoLive: true } : undefined);
    if (state.playback !== playback || playback.id !== generation) return false;
    playback.url = url; playback.liveQuality?.reset();
    window.downloadOptions?.closeMenu(); window.downloadOptions?.refresh();
    await attachStream(url);
    return state.playback === playback && playback.id === generation;
  } catch (error) {
    if (state.playback !== playback) return false;
    if (playback.liveQuality?.lower('error')) return false;
    closePlayer(); $('#status-line').textContent = errorMessage(error); return false;
  }
}

function resetVideo(options) {
  window.nativePlayer?.stop(options);
}

function attachStream(url, options = {}) {
  return window.nativePlayer.play(url, options);
}

function closePlayer() {
  const playback = state.playback;
  if (playback && playback.kind !== 'live') window.playbackProgress?.save(playback, window.nativePlayer?.position() || 0, playback.duration || 0);
  state.playback?.liveQuality?.stop();
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  window.downloadOptions?.closeMenu();
  window.tv?.closeStream?.().catch(() => {});
  state.playbackId += 1;
  state.playback = null;
  $('#player-download-options').classList.add('hidden');
  const dialog = $('#player-dialog');
  // closeStream already stops the engine and invalidates pending authorization.
  resetVideo({ notifyEngine: false });
  if (dialog.open) dialog.close();
}

function trackPlaybackProgress(update) {
  const playback = state.playback;
  if (!playback || playback.kind === 'live' || update.generation !== playback.id) return;
  playback.duration = Number(update.duration) || playback.duration || 0;
  const now = Date.now();
  if (update.state === 6 || now - playback.lastProgressSave >= 5000) {
    playback.lastProgressSave = now;
    window.playbackProgress?.save(playback, update.time, playback.duration);
  }
}


