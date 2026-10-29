const { app, BrowserWindow, WebContentsView, ipcMain, shell, dialog, safeStorage } = require('electron');
const path = require('path');
const fsSync = require('node:fs');
const fs = require('node:fs/promises');
const releaseFile = app.isPackaged
  ? path.join(process.resourcesPath, 'package-lock.json')
  : path.join(__dirname, '..', 'package-lock.json');
const release = JSON.parse(fsSync.readFileSync(releaseFile, 'utf8'));
const { watchSession } = require('./session-events');
const { DesktopPlayback } = require('./desktop-playback');
const { BrowseCache } = require('./browse-cache');
const { DesktopCatalog } = require('./desktop-catalog');
const { DUAL_AUDIO_CATEGORY, CONTENT_FAVORITES_CATEGORY } = require('./catalog-rules');
const { CHANNEL_LIST_CATEGORY, RECENT_CATEGORY, MOVIE_RELEASES_CATEGORY } = require('./catalog-organization');
const { StartupMetrics } = require('./startup-metrics');
const { saveDownload } = require('./media-download');
const { resolveAccountType } = require('./account-plan');
const { NativePlayer } = require('./native-player');

const FIREBASE_API_KEY = 'AIzaSyDbSMFXN6pmkqfhtBm3no2bXoAbyT_FoAo';
const FIREBASE_AUTH_URL = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FIREBASE_API_KEY}`;
const FIREBASE_REFRESH_URL = `https://securetoken.googleapis.com/v1/token?key=${FIREBASE_API_KEY}`;
const BACKEND_URL = 'https://multimideas-evo-backend.onrender.com';
const LOGIN_DOMAIN = 'evotv.com.br';
const CLIENT_PLATFORM = 'pc';
const CLIENT_VERSION = release.PCevoVersion;
const CLIENT_VERSION_CODE = release.PCevoVersionCode;
const LOGIN_SESSION_MS = 12 * 60 * 60 * 1000;
const REMEMBERED_LOGIN_FILE = 'remembered-login.bin';
const REMEMBERED_PROFILE_PINS_FILE = 'remembered-profile-pins.bin';
const ACTIONS = new Set(['get_live_categories', 'get_live_streams', 'get_vod_categories', 'get_vod_streams', 'get_vod_info', 'get_series_categories', 'get_series', 'get_series_info']);
const EMBEDDED_GAMES = Object.freeze({
  nfsu2: {
    title: 'Need for Speed Underground 2',
    url: 'https://nfsu-2.online/#play',
    origin: 'https://nfsu-2.online',
    partition: 'persist:evotv-game-nfsu2',
    surfaceCss: `
      html, body {
        width: 100% !important;
        height: 100% !important;
        margin: 0 !important;
        overflow: hidden !important;
        background: #000 !important;
      }
      body > * {
        visibility: hidden !important;
      }
      #play {
        position: fixed !important;
        inset: 0 !important;
        z-index: 2147483647 !important;
        width: 100% !important;
        height: 100% !important;
        max-width: none !important;
        margin: 0 !important;
        padding: 0 !important;
        background: #000 !important;
        visibility: visible !important;
      }
      #play * { visibility: visible !important; }
      #play > :first-child {
        width: 100% !important;
        height: 100% !important;
        max-width: none !important;
        aspect-ratio: auto !important;
        border-radius: 0 !important;
        box-shadow: none !important;
      }
      #play > :not(:first-child) {
        display: none !important;
      }
    `,
    autoStartScript: `(() => {
      const gameSurface = document.querySelector('#play');
      if (!gameSurface) return false;
      if (!window.__evotvGameQuitListener) {
        window.__evotvGameQuitListener = true;
        document.addEventListener('click', (event) => {
          const button = event.target.closest?.('button');
          const label = button?.textContent?.trim().toLowerCase();
          if (label === 'quit game' || label === 'exit game') window.__evotvGameQuitRequested = true;
        }, true);
      }
      if (gameSurface.querySelector('canvas')) return true;
      const playButton = gameSurface.querySelector('.play-button');
      if (!playButton || playButton.disabled) return false;
      playButton.click();
      return false;
    })()`,
    stateScript: `(() => ({
      quitRequested: window.__evotvGameQuitRequested === true,
      running: Boolean(document.querySelector('#play canvas')),
      playReady: Boolean(document.querySelector('#play .play-button')),
    }))()`,
  },
  bt3: {
    title: 'Dragon Ball Z: Budokai Tenkaichi 3',
    url: 'https://dragonballbt3.online/',
    origin: 'https://dragonballbt3.online',
    partition: 'persist:evotv-game-bt3',
    blockedUrls: [
      '*://bauval.org/*',
      '*://*.bauval.org/*',
      'https://dragonballbt3.online/ads.js*',
      'https://dragonballbt3.online/ad-frame.html*',
      'https://dragonballbt3.online/adblock-probe.js*',
    ],
    surfaceCss: `
      html, body {
        width: 100% !important;
        height: 100% !important;
        margin: 0 !important;
        overflow: hidden !important;
        background: #000 !important;
      }
      body > header,
      body > footer,
      body > .seo-faq,
      .ad-slot,
      [id^="ad-"],
      [aria-label*="Publicidad"],
      iframe:not(#game-frame),
      .layout > .sidebar-column,
      .layout > .ad-rail,
      .layout > .leaderboard-rail,
      .player-column > :not(.screen),
      .screen > :not(#game-frame) {
        display: none !important;
      }
      main.layout,
      .player-column,
      .screen {
        position: fixed !important;
        inset: 0 !important;
        width: 100% !important;
        height: 100% !important;
        max-width: none !important;
        margin: 0 !important;
        padding: 0 !important;
      }
      main.layout {
        display: block !important;
      }
      .screen {
        aspect-ratio: auto !important;
        border: 0 !important;
        border-radius: 0 !important;
        box-shadow: none !important;
        background: #000 !important;
      }
    `,
    autoStartScript: `(() => {
      const removeAds = () => {
        document.querySelectorAll('.ad-slot, [id^="ad-"], [aria-label*="Publicidad"], iframe:not(#game-frame), script[src*="bauval.org"]').forEach(element => element.remove());
      };
      removeAds();
      if (!window.__evotvBt3AdCleanup) {
        window.__evotvBt3AdCleanup = new MutationObserver(removeAds);
        window.__evotvBt3AdCleanup.observe(document.documentElement, { childList: true, subtree: true });
      }
      const frame = document.querySelector('#game-frame');
      if (frame && !frame.hidden) return true;
      const playButton = document.querySelector('#solo');
      if (!playButton || playButton.disabled) return false;
      if (!window.__evotvBt3AutoStarted) {
        window.__evotvBt3AutoStarted = true;
        playButton.click();
      }
      return false;
    })()`,
    stateScript: `(() => {
      const frame = document.querySelector('#game-frame');
      const startPanel = document.querySelector('#start-panel');
      return {
        quitRequested: false,
        running: Boolean(frame && !frame.hidden),
        playReady: Boolean(startPanel && !startPanel.hidden),
      };
    })()`,
  },
});

let authSession = null;
let activeUser = null;
let activeLogin = '';
let activeProfile = null;
let activeProfileSession = null;
let loginTimer = null;
let loginExpiresAt = 0;
let releasingProfile = false;
let sessionEventsController = null;
let sessionEventsRetry = null;
let desktopPlayback = null;
let desktopCatalog = null, desktopCatalogMode = false;
let mediaRequestId = 0;
let activeDownload = null;
let lastDownloadedFile = null;
let nativePlayer = null;
let authorizedSource = null;
let embeddedGameView = null;
let embeddedGameWindow = null;
let embeddedGame = null;
let embeddedGameRestoreWindowed = false;
let activeParental = null, adultAllowed = false;
const playableMedia = new Map();
const adaptiveLiveIds = new Set();
let browseGeneration = 0;
const browseCache = new BrowseCache();
const browsePending = new Map();
let backendWarmup = null;
let startupLogWrite = Promise.resolve();
const startupMetrics = new StartupMetrics({ save: json => {
  if (typeof app.getPath !== 'function') return;
  const file = path.join(app.getPath('userData'), 'playback-startup.json');
  startupLogWrite = startupLogWrite.catch(() => {}).then(() => fs.writeFile(file, json, 'utf8')).catch(() => {});
} });

function gameBounds(value = {}) {
  const finite = (input, fallback) => Number.isFinite(Number(input)) ? Math.floor(Number(input)) : fallback;
  return {
    x: Math.max(0, finite(value.x, 0)),
    y: Math.max(0, finite(value.y, 0)),
    width: Math.max(320, finite(value.width, 960)),
    height: Math.max(240, finite(value.height, 540)),
  };
}

function closeEmbeddedGame() {
  const view = embeddedGameView;
  const host = embeddedGameWindow;
  const restoreWindowed = embeddedGameRestoreWindowed;
  embeddedGameView = null;
  embeddedGameWindow = null;
  embeddedGame = null;
  embeddedGameRestoreWindowed = false;
  if (restoreWindowed && host && !host.isDestroyed()) host.setFullScreen(false);
  if (!view) return;
  try { host?.contentView.removeChildView(view); } catch { /* The host can already be closing. */ }
  try { if (!view.webContents.isDestroyed()) view.webContents.close(); } catch { /* Best-effort cleanup. */ }
}

function isAllowedGameNavigation(game, target) {
  try { return new URL(target).origin === game.origin; } catch { return false; }
}

function autoStartEmbeddedGame(view, attempt = 0) {
  if (view !== embeddedGameView || view.webContents.isDestroyed()) return;
  if (!embeddedGame?.autoStartScript) return;
  view.webContents.executeJavaScript(embeddedGame.autoStartScript, true).then((started) => {
    if (started || attempt >= 120) return;
    setTimeout(() => autoStartEmbeddedGame(view, attempt + 1), 250);
  }).catch(() => {});
}

function monitorEmbeddedGame(view, state = { started: false }) {
  if (view !== embeddedGameView || view.webContents.isDestroyed()) return;
  if (!embeddedGame?.stateScript) return;
  view.webContents.executeJavaScript(embeddedGame.stateScript).then((status) => {
    if (view !== embeddedGameView || view.webContents.isDestroyed()) return;
    if (status?.running) state.started = true;
    if (status?.quitRequested || (state.started && status?.playReady && !status?.running)) {
      const host = embeddedGameWindow;
      closeEmbeddedGame();
      if (host && !host.webContents.isDestroyed()) host.webContents.send('games:ended');
      return;
    }
    setTimeout(() => monitorEmbeddedGame(view, state), 500);
  }).catch(() => {});
}

function openEmbeddedGame(host, game, bounds) {
  closeEmbeddedGame();
  const restoreWindowed = !host.isFullScreen();
  if (restoreWindowed) host.setFullScreen(true);
  const view = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      partition: game.partition,
    },
  });
  embeddedGameView = view;
  embeddedGameWindow = host;
  embeddedGame = game;
  embeddedGameRestoreWindowed = restoreWindowed;
  host.contentView.addChildView(view);
  view.setVisible(false);
  view.setBounds(gameBounds(bounds));
  view.setBackgroundColor('#05070a');

  const allowedPermissions = new Set(['fullscreen', 'pointerLock', 'keyboardLock']);
  const gameSession = view.webContents.session;
  if (Array.isArray(game.blockedUrls) && game.blockedUrls.length) {
    gameSession.webRequest.onBeforeRequest({ urls: game.blockedUrls }, (_details, callback) => callback({ cancel: true }));
  }
  gameSession.setPermissionCheckHandler((_contents, permission, requestingOrigin) => (
    allowedPermissions.has(permission) && isAllowedGameNavigation(game, requestingOrigin)
  ));
  gameSession.setPermissionRequestHandler((contents, permission, callback) => {
    const requestingOrigin = (() => { try { return new URL(contents.getURL()).origin; } catch { return ''; } })();
    callback(allowedPermissions.has(permission) && requestingOrigin === game.origin);
  });
  view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  view.webContents.on('will-navigate', (event, target) => {
    if (!isAllowedGameNavigation(game, target)) event.preventDefault();
  });
  view.webContents.on('will-redirect', (event, target) => {
    if (!isAllowedGameNavigation(game, target)) event.preventDefault();
  });
  view.webContents.on('destroyed', () => {
    if (embeddedGameView === view) {
      const restoreWindowed = embeddedGameRestoreWindowed;
      const host = embeddedGameWindow;
      embeddedGameView = null;
      embeddedGameWindow = null;
      embeddedGame = null;
      embeddedGameRestoreWindowed = false;
      if (restoreWindowed && host && !host.isDestroyed()) host.setFullScreen(false);
    }
  });
  view.webContents.on('did-finish-load', () => {
    if (view.webContents.isDestroyed()) return;
    const prepareSurface = game.surfaceCss
      ? view.webContents.insertCSS(game.surfaceCss).catch(() => {})
      : Promise.resolve();
    prepareSurface.finally(() => {
      if (view === embeddedGameView && !view.webContents.isDestroyed()) view.setVisible(true);
    });
    autoStartEmbeddedGame(view);
    monitorEmbeddedGame(view);
  });
  view.webContents.loadURL(game.url).catch(() => {});
}

function warmBackend() {
  if (backendWarmup) return backendWarmup;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  timeout.unref?.();
  backendWarmup = fetch(`${BACKEND_URL}/version/pc/${encodeURIComponent(CLIENT_VERSION)}`, {
    signal: controller.signal,
    headers: { 'x-evo-platform': CLIENT_PLATFORM, 'x-evo-version-code': CLIENT_VERSION_CODE },
  }).then(response => response.body?.cancel()).catch(() => {}).finally(() => clearTimeout(timeout));
  return backendWarmup;
}

function clearBrowseCache() { browseGeneration += 1; browseCache.clear(); browsePending.clear(); playableMedia.clear(); adaptiveLiveIds.clear(); }
function rememberCatalog(route, body, value) {
  const add = (kind, id) => { if (/^\d+$/.test(String(id))) playableMedia.set(`${kind}:${id}`, body.adult === true); };
  const rememberLiveChoice = item => {
    add('live', item?.stream_id);
    for (const variant of item?.evo_live_variants || []) {
      add('live', variant.stream_id);
      if (/^\d+$/.test(String(variant.stream_id))) adaptiveLiveIds.add(String(variant.stream_id));
    }
    for (const choice of item?.evo_live_choices || []) rememberLiveChoice(choice);
  };
  if (route === '/api/catalog') {
    const kind = { channels: 'live', movies: 'movie' }[body.section];
    if (kind) for (const item of value?.items || []) {
      add(kind, item.stream_id);
      if (body.section === 'channels' && body.category === CHANNEL_LIST_CATEGORY) {
        rememberLiveChoice(item);
      }
    }
  } else if (body.action === 'get_series_info') {
    for (const episode of Object.values(value?.episodes || {}).flat()) add('series', episode.id);
  } else if (['get_live_streams', 'get_vod_streams'].includes(body.action)) {
    for (const item of Array.isArray(value) ? value : []) add(body.action === 'get_live_streams' ? 'live' : 'movie', item.stream_id);
  }
}
async function browseRequest(route, body) {
  const key = [route, body];
  const found = browseCache.get(key);
  if (found) return found;
  const packed = JSON.stringify(key);
  if (browsePending.has(packed)) return browsePending.get(packed);
  const generation = browseGeneration;
  const catalog = desktopCatalog, playback = desktopPlayback, profile = activeProfile;
  const current = () => generation === browseGeneration && catalog === desktopCatalog && playback === desktopPlayback && profile === activeProfile && activeProfileSession;
  const direct = () => {
    if (!current() || !catalog || !playback?.hasProfileGrant()) throw new Error('A sessão do perfil mudou. Abra o catálogo novamente.');
    return catalog.request(route, body, activeParental, adultAllowed);
  };
  const localCategories = playback?.hasProfileGrant() && route === '/api/tv' && ['get_live_categories', 'get_vod_categories', 'get_series_categories'].includes(body.action);
  const localDetails = playback?.hasProfileGrant() && route === '/api/tv' && ['get_vod_info', 'get_series_info'].includes(body.action);
  const dualContent = route === '/api/catalog' && body.category === DUAL_AUDIO_CATEGORY;
  if (dualContent && !['movies', 'series'].includes(body.section)) throw new Error('Categoria disponível apenas em Filmes e Séries.');
  const organized = route === '/api/catalog' && [CHANNEL_LIST_CATEGORY, RECENT_CATEGORY, CONTENT_FAVORITES_CATEGORY, MOVIE_RELEASES_CATEGORY].includes(body.category);
  const localChannels = route === '/api/catalog' && body.section === 'channels' && playback?.hasProfileGrant();
  if (organized && (body.category === CHANNEL_LIST_CATEGORY ? body.section !== 'channels'
    : body.category === MOVIE_RELEASES_CATEGORY ? body.section !== 'movies'
      : !['movies', 'series'].includes(body.section))) throw new Error('Categoria indisponível nesta seção.');
  const remote = () => backendRequest(route, { method: 'POST', body: JSON.stringify(body) }).catch(error => {
    const providerDenied = error.status === 502 && ['TV_FAILED', 'CATALOG_FAILED'].includes(error.code) && /^Servidor TV indisponível \((?:401|403)\)\.$/.test(error.message);
    if (!providerDenied || !current() || !catalog || !playback?.hasProfileGrant()) throw error;
    desktopCatalogMode = true;
    return direct();
  });
  const request = desktopCatalogMode || dualContent || organized || localChannels || localDetails ? direct() : localCategories ? direct().catch(error => {
    if (!current()) throw error;
    return remote();
  }) : remote();
  const pending = request.then((value) => {
    if (generation === browseGeneration) { browseCache.set(key, value); rememberCatalog(route, body, value); }
    return value;
  }).finally(() => { if (browsePending.get(packed) === pending) browsePending.delete(packed); });
  browsePending.set(packed, pending);
  return pending;
}
class ServiceError extends Error {
  constructor(message, code, status) { super(message); this.code = code; this.status = status; }
}

function cleanLogin(value) {
  const login = String(value || '').trim().toLowerCase();
  if (!/^[a-z0-9._-]{1,64}$/.test(login)) throw new Error('Login inválido.');
  return login;
}

function rememberedLoginPath() {
  return path.join(app.getPath('userData'), REMEMBERED_LOGIN_FILE);
}

function rememberedProfilePinsPath() {
  return path.join(app.getPath('userData'), REMEMBERED_PROFILE_PINS_FILE);
}

async function loadRememberedProfilePins() {
  if (!safeStorage.isEncryptionAvailable() || !activeLogin) return {};
  try {
    const encrypted = await fs.readFile(rememberedProfilePinsPath());
    if (!encrypted.length || encrypted.length > 32_768) throw new Error('PINs salvos inválidos.');
    const saved = JSON.parse(safeStorage.decryptString(encrypted));
    if (saved?.login !== activeLogin || !saved?.pins || typeof saved.pins !== 'object') return {};
    return Object.fromEntries(Object.entries(saved.pins).filter(([profile, pin]) => /^\d{1,2}$/.test(profile) && typeof pin === 'string' && pin.length > 0 && pin.length <= 128));
  } catch (error) {
    if (error.code !== 'ENOENT') await fs.unlink(rememberedProfilePinsPath()).catch(() => {});
    return {};
  }
}

async function saveRememberedProfilePin(profile, pin) {
  if (!safeStorage.isEncryptionAvailable() || !activeLogin) return false;
  const pins = await loadRememberedProfilePins();
  pins[String(profile)] = pin;
  const encrypted = safeStorage.encryptString(JSON.stringify({ login: activeLogin, pins }));
  await fs.mkdir(path.dirname(rememberedProfilePinsPath()), { recursive: true });
  await fs.writeFile(rememberedProfilePinsPath(), encrypted, { mode: 0o600 });
  return true;
}

async function forgetRememberedProfilePin(profile) {
  if (!activeLogin) return;
  const pins = await loadRememberedProfilePins();
  delete pins[String(profile)];
  if (!Object.keys(pins).length) {
    await fs.unlink(rememberedProfilePinsPath()).catch(error => { if (error.code !== 'ENOENT') throw error; });
    return;
  }
  if (!safeStorage.isEncryptionAvailable()) return;
  const encrypted = safeStorage.encryptString(JSON.stringify({ login: activeLogin, pins }));
  await fs.writeFile(rememberedProfilePinsPath(), encrypted, { mode: 0o600 });
}

async function forgetRememberedLogin() {
  try { await fs.unlink(rememberedLoginPath()); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}

async function saveRememberedLogin(login, password) {
  if (!safeStorage.isEncryptionAvailable()) return false;
  const encrypted = safeStorage.encryptString(JSON.stringify({ login, password }));
  await fs.mkdir(path.dirname(rememberedLoginPath()), { recursive: true });
  await fs.writeFile(rememberedLoginPath(), encrypted, { mode: 0o600 });
  return true;
}

async function loadRememberedLogin() {
  if (!safeStorage.isEncryptionAvailable()) return null;
  try {
    const encrypted = await fs.readFile(rememberedLoginPath());
    if (!encrypted.length || encrypted.length > 16_384) throw new Error('Credenciais salvas inválidas.');
    const credentials = JSON.parse(safeStorage.decryptString(encrypted));
    const login = cleanLogin(credentials?.login);
    const password = typeof credentials?.password === 'string' ? credentials.password : '';
    if (!password || password.length > 4096) throw new Error('Credenciais salvas inválidas.');
    return { login, password };
  } catch (error) {
    if (error.code !== 'ENOENT') await forgetRememberedLogin().catch(() => {});
    return null;
  }
}

async function readJson(response) {
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* resposta inválida */ }
  if (!response.ok) {
    const firebaseCode = data?.error?.message;
    if (['INVALID_LOGIN_CREDENTIALS', 'EMAIL_NOT_FOUND', 'INVALID_PASSWORD'].includes(firebaseCode)) throw new Error('Login ou senha inválidos.');
    const message = typeof data?.error === 'string' ? data.error : data?.error?.message;
    throw new ServiceError(message || data?.message || `O serviço respondeu com o código ${response.status}.`, data?.code, response.status);
  }
  return data;
}

async function signIn(login, password) {
  const response = await fetch(FIREBASE_AUTH_URL, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    signal: AbortSignal.timeout(15_000),
    body: JSON.stringify({ email: `${login}@${LOGIN_DOMAIN}`, password, returnSecureToken: true }),
  });
  const data = await readJson(response);
  return { idToken: data.idToken, refreshToken: data.refreshToken, expiresAt: Date.now() + (Number(data.expiresIn) * 1000) - 60_000 };
}

async function currentToken() {
  if (!authSession) throw new Error('Faça login novamente.');
  if (Date.now() < authSession.expiresAt) return authSession.idToken;
  const response = await fetch(FIREBASE_REFRESH_URL, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    signal: AbortSignal.timeout(15_000),
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: authSession.refreshToken }),
  });
  const data = await readJson(response);
  authSession = { idToken: data.id_token, refreshToken: data.refresh_token, expiresAt: Date.now() + (Number(data.expires_in) * 1000) - 60_000 };
  return authSession.idToken;
}

async function backendRequest(route, options = {}) {
  if (loginExpiresAt && Date.now() >= loginExpiresAt) {
    expireLogin();
    throw new Error('Sua sessão de 12 horas terminou. Faça login novamente.');
  }
  const usesProfileGrant = ['/api/tv', '/api/catalog', '/api/stream-ticket', '/api/session'].includes(route) || route.startsWith('/api/parental') || route.startsWith('/api/profiles');
  const token = usesProfileGrant && authSession ? authSession.idToken : await currentToken();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(`${BACKEND_URL}${route}`, {
      ...options, signal: controller.signal,
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'x-evo-platform': CLIENT_PLATFORM,
        'x-evo-version': CLIENT_VERSION,
        'x-evo-version-code': CLIENT_VERSION_CODE,
        ...(activeProfile ? { 'x-evo-profile': String(activeProfile) } : {}),
        ...(activeProfileSession ? { 'x-evo-session': activeProfileSession } : {}),
        ...options.headers,
      },
    });
    const data = await readJson(response);
    return data;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('O servidor demorou demais para responder.');
    if (!releasingProfile && activeProfileSession && ['SESSION_REPLACED', 'SESSION_INVALID', 'ACCOUNT_INACTIVE', 'ACCOUNT_EXPIRED', 'CLIENT_UPDATE_REQUIRED'].includes(error.code)) {
      endProfileSession(error.message, error.code);
    }
    throw error;
  } finally { clearTimeout(timeout); }
}

function stopSessionEvents() {
  sessionEventsController?.abort();
  sessionEventsController = null;
  clearTimeout(sessionEventsRetry);
  sessionEventsRetry = null;
}

function endProfileSession(message, code = 'SESSION_ENDED') {
  stopSessionEvents();
  stopDesktopPlayback();
  activeProfileSession = null;
  activeProfile = null;
  const recoverable = ['SESSION_ENDED', 'SESSION_REPLACED', 'SESSION_INVALID'].includes(code);
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send('session:ended', { message, code, recoverable });
}

function startProfileSession(preparedPlayback) {
  stopSessionEvents();
  stopDesktopPlayback();
  desktopPlayback = preparedPlayback || new DesktopPlayback();
  desktopCatalog = new DesktopCatalog(desktopPlayback, activeProfile);
  desktopPlayback.publicKey().catch(() => {});
  nativePlayer?.ready().catch(() => {});
  clearBrowseCache();
  connectSessionEvents();
}

function stopDesktopPlayback() {
  startupMetrics.end('sessionEnded');
  desktopCatalog?.close(); desktopCatalog = null; desktopCatalogMode = false;
  authorizedSource = null;
  activeParental = null; adultAllowed = false;
  nativePlayer?.stop().catch(() => {});
  activeDownload?.abort();
  clearBrowseCache();
  mediaRequestId += 1;
  desktopPlayback?.close();
  desktopPlayback = null;
}

function expireLogin() {
  clearTimeout(loginTimer);
  loginTimer = null;
  loginExpiresAt = 0;
  authSession = null;
  activeUser = null;
  activeLogin = '';
  endProfileSession('Sua sessão de 12 horas terminou. Faça login novamente.', 'LOGIN_EXPIRED');
}

async function connectSessionEvents() {
  if (!activeProfile || !activeProfileSession) return;
  const profile = activeProfile;
  const controller = new AbortController();
  sessionEventsController = controller;
  let reconnect = true;
  try {
    reconnect = await watchSession({
      url: `${BACKEND_URL}/api/session/events`, signal: controller.signal,
      headers: {
        'x-evo-platform': CLIENT_PLATFORM, 'x-evo-version': CLIENT_VERSION,
        'x-evo-version-code': CLIENT_VERSION_CODE, 'x-evo-profile': String(profile),
        'x-evo-session': activeProfileSession,
      },
      onEnded: (message, code) => {
        if (sessionEventsController === controller) endProfileSession(message, code);
      },
    });
  } catch { /* Background reconnect never blocks media playback. */ }
  if (reconnect && !controller.signal.aborted && activeProfile === profile && sessionEventsController === controller) {
    sessionEventsRetry = setTimeout(connectSessionEvents, 10_000);
    sessionEventsRetry.unref?.();
  }
}

async function releaseActiveProfile() {
  stopSessionEvents();
  stopDesktopPlayback();
  if (activeProfile && activeProfileSession) {
    releasingProfile = true;
    await backendRequest('/api/session', { method: 'DELETE' }).catch(() => {});
    releasingProfile = false;
  }
  activeProfileSession = null;
  activeProfile = null;
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 1024, minHeight: 700, backgroundColor: '#07080b', title: 'EVOTV',
    icon: path.join(__dirname, '..', 'assets', 'evotv.ico'), autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  const contents = win.webContents;
  nativePlayer = new NativePlayer({ windowHandle: win.getNativeWindowHandle(), onTiming: value => startupMetrics.native(value), onState: update => { startupMetrics.state(update); if (!contents.isDestroyed()) contents.send('native:state', update); } });
  warmBackend();
  win.on('closed', () => { closeEmbeddedGame(); nativePlayer?.close(); nativePlayer = null; authorizedSource = null; });
  win.loadFile(path.join(__dirname, 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:\/\//i.test(url)) shell.openExternal(url); return { action: 'deny' }; });
}

ipcMain.handle('app:version', () => CLIENT_VERSION);
ipcMain.handle('games:open', (event, gameId, bounds) => {
  const host = BrowserWindow.fromWebContents(event.sender);
  const game = EMBEDDED_GAMES[String(gameId || '')];
  if (!host || !game || event.senderFrame?.url !== host.webContents.getURL()) throw new Error('Game não autorizado.');
  openEmbeddedGame(host, game, bounds);
  return { title: game.title, url: game.url };
});
ipcMain.handle('games:bounds', (event, bounds) => {
  if (event.sender !== embeddedGameWindow?.webContents || !embeddedGameView) return false;
  embeddedGameView.setBounds(gameBounds(bounds));
  return true;
});
ipcMain.handle('games:reload', (event) => {
  if (event.sender !== embeddedGameWindow?.webContents || !embeddedGameView) return false;
  embeddedGameView.webContents.reload();
  return true;
});
ipcMain.handle('games:close', (event) => {
  if (embeddedGameWindow && event.sender !== embeddedGameWindow.webContents) return false;
  closeEmbeddedGame();
  return true;
});
ipcMain.handle('auth:remembered-login', () => loadRememberedLogin());
ipcMain.handle('auth:forget-login', async () => { await forgetRememberedLogin(); return true; });

ipcMain.handle('auth:login', async (_event, rawLogin, password, remember = false) => {
  const login = cleanLogin(rawLogin);
  if (!password) throw new Error('Informe login e senha.');
  warmBackend();
  authSession = await signIn(login, String(password));
  try {
    activeUser = await backendRequest('/api/account');
    activeLogin = login;
    activeUser.accountType = resolveAccountType(activeUser.accountType);
    activeProfile = null;
    clearTimeout(loginTimer);
    loginExpiresAt = Date.now() + LOGIN_SESSION_MS;
    loginTimer = setTimeout(expireLogin, LOGIN_SESSION_MS);
    loginTimer.unref?.();
    let rememberWarning = '';
    try {
      if (remember === true) {
        const saved = await saveRememberedLogin(login, String(password));
        if (!saved) rememberWarning = 'O Windows não disponibilizou o armazenamento protegido; login e senha não foram lembrados.';
      } else {
        await forgetRememberedLogin();
      }
    } catch {
      rememberWarning = 'Não foi possível salvar a opção de lembrar login e senha.';
    }
    return { user: activeUser, rememberWarning };
  }
  catch (error) { authSession = null; activeLogin = ''; throw error; }
});

async function selectProfile(profile, pin = null, rememberPin = false) {
  if (!activeUser) throw new Error('Faça login antes de escolher um perfil.');
  const profileNumber = Number(profile);
  if (!Number.isInteger(profileNumber) || profileNumber < 1 || profileNumber > activeUser.screens) throw new Error('Perfil inválido.');
  const suppliedPin = typeof pin === 'string';
  const rememberedPins = suppliedPin ? {} : await loadRememberedProfilePins();
  const effectivePin = suppliedPin ? pin : rememberedPins[String(profileNumber)] || '';
  if (!effectivePin) return { pinRequired: true, profile: profileNumber };
  if (effectivePin.length > 128) throw new Error('PIN de perfil inválido.');
  stopDesktopPlayback();
  const playback = new DesktopPlayback();
  activeProfile = profileNumber;
  try {
    let data;
    try {
      data = await backendRequest('/api/profile', {
        method: 'POST',
        body: JSON.stringify({ profile: profileNumber, force: true, pin: effectivePin, playbackPublicKey: await playback.publicKey() }),
      });
    }
    catch (error) {
      if (!suppliedPin && ['PROFILE_PIN_REQUIRED', 'PROFILE_PIN_INVALID'].includes(error.code)) {
        await forgetRememberedProfilePin(profileNumber).catch(() => {});
        playback.close(); activeProfile = null;
        return { pinRequired: true, profile: profileNumber, pinError: 'O PIN salvo não é mais válido. Digite o PIN atual.' };
      }
      throw error;
    }
    if (data.playbackGrant) await playback.acceptProfile(data.playbackGrant, { profile: profileNumber });
    activeProfileSession = data.sessionToken;
    activeUser.accountType = resolveAccountType(data.accountType, activeUser.accountType);
    startProfileSession(playback);
    activeParental = data.parental || null;
    adultAllowed = (data.adultAllowed === true || activeParental?.adultMode === 'free') && activeParental?.adultVisible !== false;
    let rememberPinWarning = '';
    if (suppliedPin) {
      if (rememberPin === true) {
        const saved = await saveRememberedProfilePin(profileNumber, effectivePin);
        if (!saved) rememberPinWarning = 'O Windows não disponibilizou o armazenamento protegido; o PIN não foi lembrado.';
      } else await forgetRememberedProfilePin(profileNumber);
    }
    return { connected: true, profile: data.profile, parental: data.parental, adultAllowed, adultVisible: data.adultVisible !== false && data.parental?.adultVisible !== false, canManageParental: profileNumber === 1, accountType: activeUser.accountType, rememberPinWarning };
  }
  catch (error) { playback.close(); activeProfile = null; activeProfileSession = null; throw error; }
}
ipcMain.handle('auth:select-profile', (_event, profile, pin, rememberPin) => selectProfile(profile, pin, rememberPin));

ipcMain.handle('tv:request', async (_event, action, extra = {}, adult = false) => {
  if (!activeProfile) throw new Error('Escolha um perfil antes de continuar.');
  if (!ACTIONS.has(action)) throw new Error('Operação de TV não permitida.');
  if (adult && (activeParental?.adultVisible === false || !adultAllowed)) throw new Error('Conteúdo adulto bloqueado neste perfil.');
  return browseRequest('/api/tv', { action, extra, adult: adult === true });
});

ipcMain.handle('tv:catalog', async (_event, options = {}) => {
  if (!activeProfile) throw new Error('Escolha um perfil antes de continuar.');
  const section = String(options.section || '');
  if (!['channels', 'movies', 'series'].includes(section)) throw new Error('Catálogo inválido.');
  if (options.adult && (activeParental?.adultVisible === false || !adultAllowed)) throw new Error('Conteúdo adulto bloqueado neste perfil.');
  return browseRequest('/api/catalog', {
      section,
      category: String(options.category || 'all'),
      page: Number(options.page) || 1,
      limit: Number(options.limit) || 48,
      query: String(options.query || '').slice(0, 100),
      adult: options.adult === true,
      ...(section === 'channels' && options.category === CHANNEL_LIST_CATEGORY && !options.adult && Array.isArray(options.favorites) ? { favorites: options.favorites.filter(value => typeof value === 'string').slice(0, 256).map(value => value.slice(0, 160)) } : {}),
      ...(['movies', 'series'].includes(section) && options.category === CONTENT_FAVORITES_CATEGORY && Array.isArray(options.favorites) ? { favorites: options.favorites.filter(value => /^\d+$/.test(String(value))).slice(0, 1000).map(String) } : {}),
  });
});

ipcMain.handle('tv:extra-catalog', async () => {
  if (!activeProfile || !activeProfileSession) throw new Error('Escolha um perfil antes de continuar.');
  return backendRequest('/api/extras/catalog');
});

ipcMain.handle('tv:extra-stream-url', async (_event, id) => {
  if (!activeProfile || !activeProfileSession || !desktopPlayback) throw new Error('Escolha um perfil antes de continuar.');
  if (activeDownload) throw new Error('Conclua ou cancele o download para iniciar outra reprodução.');
  const contentId = String(id || '');
  if (!/^[a-z0-9-]{1,64}$/.test(contentId)) throw new Error('Conteúdo extra inválido.');
  const requestId = ++mediaRequestId;
  const data = await backendRequest('/api/extras/stream-ticket', { method: 'POST', body: JSON.stringify({ id: contentId }) });
  if (requestId !== mediaRequestId) throw new Error('A reprodução foi encerrada.');
  const url = new URL(String(data?.url || ''));
  const backend = new URL(BACKEND_URL);
  if (url.origin !== backend.origin || !url.pathname.startsWith('/extra-stream/')) throw new Error('O backend retornou uma mídia extra inválida.');
  authorizedSource = url.href;
  return authorizedSource;
});

ipcMain.handle('tv:stream-url', async (_event, kind, id, extension, options = {}) => {
  if (!activeProfile || !activeProfileSession || !desktopPlayback) throw new Error('Escolha um perfil antes de continuar.');
  if (activeDownload) throw new Error('Conclua ou cancele o download para iniciar outra reprodução.');
  if (activeParental?.version === 2 || desktopCatalogMode) {
    const key = `${kind}:${id}`;
    if (!playableMedia.has(key)) throw new Error('Abra este conteúdo pelo catálogo do perfil.');
    if (playableMedia.get(key) && (!adultAllowed || activeParental.adultVisible === false)) throw new Error('Conteúdo adulto bloqueado neste perfil.');
  }
  const playback = desktopPlayback;
  const requestId = ++mediaRequestId;
  startupMetrics.begin(requestId);
  const profile = activeProfile;
  const normalizedExtension = String(extension || (kind === 'live' ? 'ts' : 'mp4')).replace(/[^a-z0-9]/gi, '').slice(0, 8);
  const autoLive = options?.autoLive === true;
  if (autoLive && (kind !== 'live' || !adaptiveLiveIds.has(String(id)))) throw new Error('Abra este canal pelos Canais Favoritos do perfil.');
  if (playback.hasProfileGrant()) {
    const url = autoLive ? await playback.liveSource(id, normalizedExtension, profile) : playback.source(kind, id, normalizedExtension, profile);
    if (requestId !== mediaRequestId || playback !== desktopPlayback) throw new Error('A reprodução foi encerrada.');
    authorizedSource = url;
    startupMetrics.mark(requestId, 'sourceMs');
    return url;
  }
  const publicKey = await playback.publicKey();
  if (requestId !== mediaRequestId || playback !== desktopPlayback) throw new Error('A reprodução foi encerrada.');
  const data = await backendRequest('/api/stream-ticket', { method: 'POST', body: JSON.stringify({ kind, id, extension: normalizedExtension, transport: 'desktop', publicKey }) });
  if (requestId !== mediaRequestId || playback !== desktopPlayback) throw new Error('A reprodução foi encerrada.');
  if (data.transport === 'desktop') {
    const url = await playback.accept(data.source, { kind, id, extension: normalizedExtension, profile }, { direct: true });
    if (requestId !== mediaRequestId || playback !== desktopPlayback) throw new Error('A reprodução foi encerrada.');
    authorizedSource = url;
    startupMetrics.mark(requestId, 'sourceMs');
    return url;
  }
  authorizedSource = data.url;
  startupMetrics.mark(requestId, 'sourceMs');
  return data.url;
});

ipcMain.handle('tv:close-stream', () => {
  startupMetrics.end();
  authorizedSource = null;
  nativePlayer?.stop().catch(() => {});
  mediaRequestId += 1;
  if (!activeDownload) desktopPlayback?.release();
});

function nativeBounds(value) {
  const output = {};
  for (const key of ['left', 'top', 'width', 'height', 'viewportWidth', 'viewportHeight']) {
    if (!Number.isFinite(value?.[key]) || Math.abs(value[key]) > 32768) throw new Error('Área de reprodução inválida.');
    output[key] = value[key];
  }
  if (output.width <= 0 || output.height <= 0 || output.viewportWidth <= 0 || output.viewportHeight <= 0) throw new Error('Área de reprodução inválida.');
  return output;
}
ipcMain.handle('native:play', async (_event, url, bounds, options = {}) => {
  if (!activeProfileSession || !nativePlayer || activeDownload || !authorizedSource || url !== authorizedSource) throw new Error('Reprodução não autorizada.');
  const requestId = mediaRequestId, engine = nativePlayer;
  const rectangle = nativeBounds(bounds);
  if (!Number.isSafeInteger(options.generation) || options.generation < 0 || !Number.isFinite(options.position || 0) || (options.position || 0) < 0) throw new Error('Reprodução inválida.');
  startupMetrics.bind(requestId, options.generation); startupMetrics.mark(requestId, 'nativeRequestMs');
  await engine.ready();
  if (requestId !== mediaRequestId || url !== authorizedSource || engine !== nativePlayer) throw new Error('A reprodução foi encerrada.');
  startupMetrics.mark(requestId, 'engineReadyMs');
  const result = await engine.play(url, rectangle, { generation: options.generation, position: options.position || 0, paused: options.paused === true });
  startupMetrics.mark(requestId, 'acceptedMs');
  return result;
});
ipcMain.handle('native:command', (_event, command, value) => {
  if (!nativePlayer) return false;
  if (command === 'stop') return nativePlayer.stop();
  if (!activeProfileSession) throw new Error('Reprodução não autorizada.');
  if (command === 'resize') return nativePlayer.command(command, { bounds: nativeBounds(value) });
  if (command === 'clip') {
    if (Array.isArray(value)) {
      if (value.length > 4 || !value.every(rect => rect && ['left', 'top', 'width', 'height'].every(key => Number.isFinite(rect[key]) && Math.abs(rect[key]) <= 32768) && rect.width >= 0 && rect.height >= 0)) throw new Error('Área inválida.');
      return nativePlayer.command(command, { rects: value });
    }
    if (value !== null && !['left', 'top', 'width', 'height'].every(key => Number.isFinite(value?.[key]) && Math.abs(value[key]) <= 32768)) throw new Error('Área inválida.');
    return nativePlayer.command(command, { rect: value });
  }
  if (command === 'audio-track' || command === 'subtitle-track') {
    if (!authorizedSource || !Number.isSafeInteger(value?.id) || value.id < (command === 'subtitle-track' ? -1 : 0) || value.id > 2147483647 || !Number.isSafeInteger(value?.generation) || value.generation < 0) throw new Error('Faixa de reprodução inválida.');
    return nativePlayer.command(command, { value: value.id, generation: value.generation });
  }
  if (!['pause', 'seek', 'volume', 'mute'].includes(command) || !Number.isFinite(value)) throw new Error('Controle de reprodução inválido.');
  return nativePlayer.command(command, { value: Math.max(0, Math.min(command === 'volume' ? 100 : command === 'seek' ? 7 * 86400 : 1, value)) });
});

ipcMain.handle('parental:get', () => backendRequest('/api/parental'));
ipcMain.handle('profiles:settings', () => {
  if (activeProfile !== 1) throw new Error('Somente o perfil principal pode administrar os perfis.');
  return backendRequest('/api/profiles/settings');
});
ipcMain.handle('profiles:save', async (_event, settings = {}) => {
  if (activeProfile !== 1) throw new Error('Somente o perfil principal pode administrar os perfis.');
  stopSessionEvents();
  try {
    const result = await backendRequest('/api/profiles/settings', { method: 'POST', body: JSON.stringify({
      profiles: settings.profiles, expectedRevision: settings.expectedRevision,
    }) });
    if (result?.saved !== true || !Array.isArray(result.profileNames)) throw new Error('O servidor não confirmou o salvamento dos perfis.');
    activeUser.profileNames = result.profileNames;
    stopDesktopPlayback(); activeProfileSession = null; activeProfile = null;
    return result;
  } catch (error) { if (activeProfileSession) connectSessionEvents(); throw error; }
});
ipcMain.handle('parental:settings', () => {
  if (activeProfile !== 1) throw new Error('Somente o perfil principal pode administrar o controle parental.');
  return backendRequest('/api/parental/settings');
});
ipcMain.handle('parental:unlock', async (_event, pin) => {
  if (!activeProfile || !activeProfileSession) throw new Error('Escolha um perfil antes de continuar.');
  if (activeParental?.adultVisible === false || activeParental?.adultMode === 'hidden') throw new Error('Conteúdo adulto está oculto e bloqueado neste perfil.');
  const profile = activeProfile, playback = desktopPlayback, session = activeProfileSession, controls = activeParental;
  const data = await backendRequest('/api/parental/unlock', { method: 'POST', body: JSON.stringify({ pin: String(pin || ''), requirePin: true }) });
  if (profile !== activeProfile || playback !== desktopPlayback || session !== activeProfileSession) throw new Error('A sessão do perfil mudou. Digite o PIN novamente.');
  if ((controls?.adultMode === 'free' || data.parental?.adultMode === 'free') && data.pinVerified !== true) throw new Error('Para proteger esta pasta com PIN, selecione “Pedir PIN” nas permissões deste perfil.');
  if (data.adultAllowed !== true || !data.sessionToken) throw new Error('O servidor não confirmou a liberação por PIN.');
  stopSessionEvents(); activeProfileSession = data.sessionToken;
  activeParental = data.parental || activeParental; adultAllowed = data.adultAllowed === true && activeParental?.adultVisible !== false;
  clearBrowseCache(); connectSessionEvents();
  return { parental: data.parental, adultAllowed, adultVisible: data.adultVisible !== false && activeParental?.adultVisible !== false };
});
ipcMain.handle('parental:save', async (_event, settings = {}) => {
  if (activeProfile !== 1) throw new Error('Somente o perfil principal pode administrar o controle parental.');
  stopSessionEvents();
  try {
    const result = await backendRequest('/api/parental/settings', { method: 'POST', body: JSON.stringify({
      profiles: settings.profiles, expectedRevision: settings.expectedRevision,
      currentPin: String(settings.currentPin || ''), newPin: String(settings.newPin || ''),
    }) });
    if (result?.saved !== true) throw new Error('O servidor não confirmou o salvamento. Reabra o controle parental para conferir as permissões.');
    stopDesktopPlayback(); activeProfileSession = null; activeProfile = null;
    return { saved: true };
  } catch (error) { if (activeProfileSession) connectSessionEvents(); throw error; }
});
ipcMain.handle('tv:download', async (event, media = {}) => {
  if (activeUser?.accountType !== 'PREMIUM') throw new Error('Downloads são exclusivos de contas PREMIUM.');
  const sourceKind = String(media.sourceKind || media.kind);
  const showDownload = media.show === true;
  if (!activeProfileSession || activeDownload || !['movie', 'series'].includes(media.kind)
      || !['live', 'movie', 'series', 'extra'].includes(sourceKind) || (sourceKind === 'live' && !showDownload)) throw new Error('Não é possível iniciar este download agora.');
  if (sourceKind !== 'extra' && !desktopPlayback) throw new Error('Não é possível iniciar este download agora.');
  if (sourceKind !== 'extra' && (activeParental?.version === 2 || desktopCatalogMode) && !playableMedia.has(`${sourceKind}:${media.mediaId}`)) throw new Error('Abra este conteúdo pelo catálogo do perfil.');
  const extension = sourceKind === 'extra' ? 'ts' : String(media.extension || 'mp4').replace(/[^a-z0-9]/gi, '').slice(0, 8);
  const name = String(media.title || 'EVO mídia').replace(/[<>:"/\\|?*\x00-\x1f]/g, '').slice(0, 120).trim() || 'EVO mídia';
  const destination = await dialog.showSaveDialog(BrowserWindow.fromWebContents(event.sender), { title: 'Baixar mídia', defaultPath: path.join(app.getPath('downloads'), `${name}.${extension}`), filters: [{ name: 'Vídeo', extensions: [extension] }] });
  if (destination.canceled || !destination.filePath) return { canceled: true };
  const playback = desktopPlayback, profile = activeProfile;
  let url;
  if (sourceKind === 'extra') {
    const data = await backendRequest('/api/extras/download-ticket', { method: 'POST', body: JSON.stringify({ id: media.mediaId }) });
    url = data.url;
  } else {
    const data = await backendRequest('/api/stream-ticket', { method: 'POST', body: JSON.stringify({ kind: sourceKind, id: media.mediaId, extension, transport: 'desktop', purpose: 'download', mediaType: showDownload ? 'show' : undefined, publicKey: await playback.publicKey() }) });
    if (playback !== desktopPlayback || activeDownload) throw new Error('A sessão de download mudou. Tente novamente.');
    url = await playback.accept(data.source, { kind: sourceKind, id: media.mediaId, extension, profile, purpose: 'download' });
  }
  const controller = new AbortController(); activeDownload = controller;
  const notify = (progress) => {
    if (progress.status === 'completed') lastDownloadedFile = destination.filePath;
    if (!event.sender.isDestroyed()) event.sender.send('download:progress', { ...progress, ...(progress.status === 'completed' ? { filePath: destination.filePath } : {}) });
  };
  saveDownload({ url, filePath: destination.filePath, signal: controller.signal, onProgress: notify })
    .catch(() => notify({ status: controller.signal.aborted ? 'canceled' : 'failed' }))
    .finally(() => { if (activeDownload === controller) activeDownload = null; if (sourceKind !== 'extra') { const token = new URL(url).pathname.split('/')[2]; playback.remove(token); } });
  return { started: true };
});
ipcMain.handle('tv:cancel-download', () => { activeDownload?.abort(); return true; });
ipcMain.handle('tv:show-downloaded-file', () => {
  if (!lastDownloadedFile) throw new Error('Nenhum download concluído nesta sessão.');
  shell.showItemInFolder(lastDownloadedFile);
  return true;
});

ipcMain.handle('tv:logout', async () => {
  await releaseActiveProfile();
  clearTimeout(loginTimer);
  loginTimer = null;
  loginExpiresAt = 0;
  authSession = null;
  activeUser = null;
  activeLogin = '';
  return true;
});
ipcMain.handle('auth:switch-profile', async () => {
  if (!activeUser) throw new Error('Sessão não encontrada.');
  await releaseActiveProfile();
  return activeUser;
});

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
let quitting = false;
app.on('before-quit', (event) => {
  closeEmbeddedGame();
  nativePlayer?.close();
  stopSessionEvents();
  stopDesktopPlayback();
  clearTimeout(loginTimer);
  if (quitting || !activeProfileSession) return;
  quitting = true;
  event.preventDefault();
  Promise.race([releaseActiveProfile(), new Promise((resolve) => setTimeout(resolve, 2000))]).finally(() => app.quit());
});
