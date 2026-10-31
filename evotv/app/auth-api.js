const FIREBASE_API_KEY = 'AIzaSyDbSMFXN6pmkqfhtBm3no2bXoAbyT_FoAo';
const FIREBASE_AUTH_URL = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FIREBASE_API_KEY}`;
const FIREBASE_REFRESH_URL = `https://securetoken.googleapis.com/v1/token?key=${FIREBASE_API_KEY}`;
const APP_BACKEND_URL = 'https://multimideas-evo-backend-app.onrender.com';
const LOGIN_DOMAIN = 'evotv.com.br';
const CLIENT_PLATFORM = 'web';
const REQUEST_TIMEOUT_MS = 30_000;

export class EvoApiError extends Error {
  constructor(message, code = '', status = 0) {
    super(message);
    this.name = 'EvoApiError';
    this.code = code;
    this.status = status;
  }
}

export class EvoAuthApi {
  async signIn(rawLogin, password) {
    const login = String(rawLogin || '').trim().toLowerCase();
    if (!/^[a-z0-9._-]{1,64}$/.test(login)) throw new EvoApiError('Login inválido.');
    const response = await fetchWithTimeout(FIREBASE_AUTH_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: `${login}@${LOGIN_DOMAIN}`, password, returnSecureToken: true }),
    });
    const data = await jsonResponse(response);
    if (!response.ok) {
      const code = text(data?.error?.message);
      if (['INVALID_LOGIN_CREDENTIALS', 'EMAIL_NOT_FOUND', 'INVALID_PASSWORD'].includes(code)) {
        throw new EvoApiError('Login ou senha inválidos.', code, response.status);
      }
      throw new EvoApiError(code || 'Não foi possível entrar no Firebase.', code, response.status);
    }
    return {
      login,
      idToken: requiredText(data, 'idToken'),
      refreshToken: requiredText(data, 'refreshToken'),
      expiresAt: Date.now() + Math.max(integer(data.expiresIn, 3600) - 60, 1) * 1000,
    };
  }

  async account(auth) {
    const data = await this.backend('/api/account', auth);
    const screens = clamp(integer(data.screens, 1), 1, 20);
    return {
      screens,
      profileNames: Array.isArray(data.profileNames) ? data.profileNames.map(text) : [],
      accountType: (text(data.accountType) || 'STANDARD').toUpperCase(),
    };
  }

  async selectProfile(auth, profile, pin) {
    const data = await this.backend('/api/profile', auth, {
      method: 'POST',
      body: JSON.stringify({ profile, force: true, pin }),
    });
    const sessionToken = requiredText(data, 'sessionToken');
    const parental = object(data.parental) || {};
    return {
      profile,
      sessionToken,
      parental,
      adultAllowed: data.adultAllowed === true || parental.adultMode === 'free',
      adultVisible: data.adultVisible !== false && parental.adultVisible !== false,
      accountType: (text(data.accountType) || 'STANDARD').toUpperCase(),
    };
  }

  parental(auth, session) {
    return this.backend('/api/parental', auth, { headers: sessionHeaders(session) });
  }

  parentalSettings(auth, session) {
    return this.backend('/api/parental/settings', auth, { headers: sessionHeaders(session) });
  }

  async unlockParental(auth, session, pin) {
    const data = await this.backend('/api/parental/unlock', auth, {
      method: 'POST',
      headers: sessionHeaders(session),
      body: JSON.stringify({ pin: String(pin || ''), requirePin: true }),
    });
    if (data.adultAllowed !== true || !data.sessionToken) {
      throw new EvoApiError('O servidor não confirmou a liberação por PIN.');
    }
    return {
      sessionToken: text(data.sessionToken),
      parental: object(data.parental) || session.parental,
      adultAllowed: true,
      adultVisible: data.adultVisible !== false && data.parental?.adultVisible !== false,
    };
  }

  profileSettings(auth, session) {
    return this.backend('/api/profiles/settings', auth, { headers: sessionHeaders(session) });
  }

  async saveProfileSettings(auth, session, settings) {
    const data = await this.backend('/api/profiles/settings', auth, {
      method: 'POST',
      headers: sessionHeaders(session),
      body: JSON.stringify({ profiles: settings.profiles, expectedRevision: settings.revision }),
    });
    if (data.saved !== true || !Array.isArray(data.profileNames)) {
      throw new EvoApiError('O servidor não confirmou o salvamento dos perfis.');
    }
    return { profileNames: data.profileNames.map(text) };
  }

  async saveParental(auth, session, settings) {
    const data = await this.backend('/api/parental/settings', auth, {
      method: 'POST',
      headers: sessionHeaders(session),
      body: JSON.stringify({
        profiles: settings.profiles,
        expectedRevision: settings.revision,
        currentPin: String(settings.currentPin || ''),
        newPin: String(settings.newPin || ''),
      }),
    });
    if (data.saved !== true) throw new EvoApiError('O servidor não confirmou o controle parental.');
    return { saved: true };
  }

  async releaseProfile(auth, session) {
    if (!auth || !session?.sessionToken) return;
    try {
      await this.backend('/api/session', auth, {
        method: 'DELETE',
        headers: sessionHeaders(session),
      });
    } catch { /* limpeza de melhor esforço */ }
  }

  async watchSession(auth, session, signal) {
    const token = await this.currentToken(auth);
    const response = await fetch(`${APP_BACKEND_URL}/api/session/events`, {
      headers: backendHeaders(token, sessionHeaders(session)),
      signal,
    });
    if (!response.ok) throw await responseError(response);
    const reader = response.body?.getReader();
    if (!reader) return null;
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const result = await reader.read();
      buffer += decoder.decode(result.value || new Uint8Array(), { stream: !result.done });
      let boundary = buffer.match(/\r?\n\r?\n/);
      while (boundary?.index !== undefined) {
        const block = buffer.slice(0, boundary.index);
        buffer = buffer.slice(boundary.index + boundary[0].length);
        const lines = block.split(/\r?\n/);
        const event = lines.find((line) => line.startsWith('event:'))?.slice(6).trim();
        if (event === 'session-ended') {
          const raw = lines.filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).join('\n');
          try {
            const data = JSON.parse(raw);
            return { code: text(data.code) || 'SESSION_INVALID', message: text(data.message) || 'A sessão deste perfil foi encerrada.' };
          } catch {
            return { code: 'SESSION_INVALID', message: 'A sessão deste perfil foi encerrada.' };
          }
        }
        boundary = buffer.match(/\r?\n\r?\n/);
      }
      if (result.done) return null;
    }
  }

  async backend(path, auth, init = {}) {
    const token = await this.currentToken(auth);
    let response;
    try {
      response = await fetchWithTimeout(`${APP_BACKEND_URL}${path}`, {
        ...init,
        headers: backendHeaders(token, init.headers),
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new EvoApiError('O servidor demorou demais para responder.');
      }
      throw new EvoApiError('Não foi possível acessar o servidor. Verifique a conexão e o CORS do backend.');
    }
    const data = await jsonResponse(response);
    if (!response.ok) throw errorFromData(data, response.status);
    if (!object(data)) throw new EvoApiError('O serviço retornou uma resposta inválida.');
    return data;
  }

  async currentToken(auth) {
    if (!auth?.refreshToken) throw new EvoApiError('Faça login novamente.');
    if (auth.idToken && Date.now() < auth.expiresAt) return auth.idToken;
    const response = await fetchWithTimeout(FIREBASE_REFRESH_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: auth.refreshToken }),
    });
    const data = await jsonResponse(response);
    if (!response.ok) throw errorFromData(data, response.status);
    auth.idToken = requiredText(data, 'id_token');
    auth.refreshToken = requiredText(data, 'refresh_token');
    auth.expiresAt = Date.now() + Math.max(integer(data.expires_in, 3600) - 60, 1) * 1000;
    return auth.idToken;
  }
}

function sessionHeaders(session) {
  return { 'x-evo-session': session.sessionToken, 'x-evo-profile': String(session.profile) };
}

function backendHeaders(token, extra = {}) {
  const headers = new Headers({
    accept: 'application/json',
    'content-type': 'application/json',
    authorization: `Bearer ${token}`,
    'x-evo-platform': CLIENT_PLATFORM,
  });
  new Headers(extra).forEach((value, key) => headers.set(key, value));
  return headers;
}

async function fetchWithTimeout(input, init) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try { return await fetch(input, { ...init, signal: controller.signal }); }
  finally { window.clearTimeout(timer); }
}

async function jsonResponse(response) {
  const body = await response.text();
  if (!body.trim()) return {};
  try { return JSON.parse(body); }
  catch { throw new EvoApiError('O serviço retornou uma resposta inválida.'); }
}

async function responseError(response) {
  return errorFromData(await jsonResponse(response), response.status);
}

function errorFromData(data, status) {
  const code = text(data?.code || data?.error?.code);
  const raw = typeof data?.error === 'string' ? data.error : data?.error?.message || data?.message;
  return new EvoApiError(text(raw).replace(/\bIPTV\b/gi, 'TV') || `O serviço respondeu com o código ${status}.`, code, status);
}

function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : null; }
function text(value) { return value === null || value === undefined ? '' : String(value); }
function integer(value, fallback) { const result = Number.parseInt(text(value), 10); return Number.isFinite(result) ? result : fallback; }
function clamp(value, minimum, maximum) { return Math.min(maximum, Math.max(minimum, value)); }
function requiredText(data, key) { const value = text(data?.[key]); if (!value) throw new EvoApiError(`Campo ausente: ${key}.`); return value; }
