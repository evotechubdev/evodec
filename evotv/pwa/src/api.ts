import { appConfig } from './config';
import {
  type Account,
  type AuthSession,
  type CatalogItem,
  type CatalogPage,
  type MediaKind,
  type PlaybackGrant,
  type ProfileSession,
  type SeriesDetails,
  type SeriesEpisode,
  type SeriesSeason,
  mediaSections,
} from './types';

type JsonObject = Record<string, unknown>;

function base64Url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

export interface SessionEnd {
  code: string;
  message: string;
}

export interface SecurePlaybackSource {
  url: string;
  headers: Record<string, string>;
}

export class EvoApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EvoApiError';
  }
}

interface PlaybackKeys {
  publicKey: string;
  decrypt(envelope: JsonObject, expectedProfile: number): Promise<PlaybackGrant>;
}

export class EvoApi {
  async signIn(rawLogin: string, password: string): Promise<AuthSession> {
    const login = rawLogin.trim().toLowerCase();
    if (!/^[a-z0-9._-]{1,64}$/.test(login)) {
      throw new EvoApiError('Login inválido.');
    }
    if (!appConfig.firebaseApiKey) {
      throw new EvoApiError('A chave do Firebase ainda não foi configurada.');
    }

    const url = new URL(
      'https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword',
    );
    url.searchParams.set('key', appConfig.firebaseApiKey);
    const response = await fetchWithTimeout(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: `${login}@${appConfig.loginDomain}`,
        password,
        returnSecureToken: true,
      }),
    });
    const data = await objectResponse(response);
    if (!response.ok) {
      const code = firebaseError(data);
      if (
        ['INVALID_LOGIN_CREDENTIALS', 'EMAIL_NOT_FOUND', 'INVALID_PASSWORD'].includes(
          code,
        )
      ) {
        throw new EvoApiError('Login ou senha inválidos.');
      }
      throw new EvoApiError(code || 'Não foi possível entrar no Firebase.');
    }

    const idToken = text(data.idToken);
    if (!idToken) {
      throw new EvoApiError('O Firebase não retornou o token de acesso.');
    }
    const expiresIn = integer(data.expiresIn, 3600);
    return {
      idToken,
      refreshToken: text(data.refreshToken),
      expiresAt: Date.now() + Math.max(expiresIn - 60, 1) * 1000,
    };
  }

  async account(token: string): Promise<Account> {
    if (!appConfig.clientVersionCode) {
      throw new EvoApiError('O código de versão da PWA ainda não foi configurado.');
    }
    const data = await this.backend('/api/account', token);
    const profileNames = Array.isArray(data.profileNames)
      ? data.profileNames.map((item) => text(item))
      : [];
    const screens = clamp(integer(data.screens, 1), 1, 20);
    return {
      screens,
      profileNames,
      accountType: (text(data.accountType) || 'STANDARD').toUpperCase(),
    };
  }

  async selectProfile(token: string, profile: number): Promise<ProfileSession> {
    const keys = await generatePlaybackKeys();
    const data = await this.backend('/api/profile', token, {
      method: 'POST',
      body: JSON.stringify({
        profile,
        force: true,
        pin: '',
        playbackPublicKey: keys.publicKey,
      }),
    });
    const sessionToken = text(data.sessionToken);
    const envelope = object(data.playbackGrant);
    if (!sessionToken || !envelope) {
      throw new EvoApiError(
        'O servidor não enviou uma sessão de reprodução válida.',
      );
    }
    try {
      return {
        sessionToken,
        playbackGrant: await keys.decrypt(envelope, profile),
      };
    } catch {
      throw new EvoApiError(
        'Não foi possível validar a autorização de reprodução.',
      );
    }
  }

  async catalog(
    token: string,
    sessionToken: string,
    profile: number,
    kind: MediaKind,
  ): Promise<CatalogPage> {
    const data = await this.backend('/api/catalog', token, {
      method: 'POST',
      headers: sessionHeaders(sessionToken, profile),
      body: JSON.stringify({
        section: mediaSections[kind],
        category: 'all',
        page: 1,
        limit: 48,
        query: '',
        adult: false,
      }),
    });
    const items = Array.isArray(data.items)
      ? data.items
          .map((raw) => catalogItem(object(raw), kind))
          .filter((item): item is CatalogItem => item !== null)
      : [];
    return {
      items,
      page: integer(data.page, 1),
      total: integer(data.total, items.length),
      hasMore: data.hasMore === true,
    };
  }

  async seriesDetails(
    token: string,
    sessionToken: string,
    profile: number,
    series: CatalogItem,
  ): Promise<SeriesDetails> {
    const data = await this.backend('/api/iptv', token, {
      method: 'POST',
      headers: sessionHeaders(sessionToken, profile),
      body: JSON.stringify({
        action: 'get_series_info',
        extra: { series_id: series.id },
        adult: false,
      }),
    });
    const info = object(data.info) ?? {};
    const rawEpisodes = object(data.episodes);
    const seasons: SeriesSeason[] = [];
    if (rawEpisodes) {
      for (const [seasonKey, rawSeason] of Object.entries(rawEpisodes)) {
        if (!Array.isArray(rawSeason)) continue;
        const episodes: SeriesEpisode[] = rawSeason
          .map((raw, index) => seriesEpisode(object(raw), index))
          .filter((episode): episode is SeriesEpisode => episode !== null)
          .sort((left, right) => left.number - right.number);
        if (episodes.length) {
          seasons.push({ number: integer(seasonKey, 0), episodes });
        }
      }
    }
    seasons.sort((left, right) => left.number - right.number);
    return {
      title: firstText(info.name, series.name),
      plot: firstText(info.plot, info.description),
      coverUrl: firstText(info.cover, info.movie_image, series.imageUrl),
      seasons,
    };
  }

  async playbackSource(
    token: string,
    sessionToken: string,
    profile: number,
    item: CatalogItem,
  ): Promise<SecurePlaybackSource> {
    const normalized = item.extension.toLowerCase().replace(/[^a-z0-9]/g, '');
    // The configured IPTV provider exposes live channels as continuous MPEG-TS.
    // The browser player transmuxes this stream through mpegts.js.
    const extension = item.kind === 'live'
      ? 'ts'
      : normalized.slice(0, 8) || 'mp4';
    const renderRelay = appConfig.mediaRelayUrl;
    const data = await this.backend('/api/stream-ticket', token, {
      method: 'POST',
      headers: sessionHeaders(sessionToken, profile),
      body: JSON.stringify({
        kind: item.kind,
        id: item.id,
        extension,
        transport: renderRelay ? 'direct' : 'web',
      }),
    });
    const source = text(data.url);
    if (!source) {
      throw new EvoApiError('O servidor não retornou uma URL de reprodução.');
    }
    try {
      const url = new URL(source);
      if (renderRelay) {
        const backend = new URL(appConfig.backendUrl, window.location.origin);
        if (text(data.transport) !== 'direct'
          || url.origin !== backend.origin
          || !url.pathname.startsWith('/open-stream/')) {
          throw new Error();
        }
        const relay = new URL(renderRelay);
        if (relay.protocol !== 'https:' || relay.username || relay.password || relay.search || relay.hash) {
          throw new Error();
        }
        const packed = base64Url(url.href);
        const file = `${item.id}.${extension}`;
        url.href = new URL(`/stream/${packed}/${file}`, relay.origin).href;
      }
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error();
      if (location.protocol === 'https:' && url.protocol !== 'https:') {
        throw new EvoApiError(
          'O servidor não retornou uma conexão HTTPS segura para a mídia.',
        );
      }
      return {
        url: url.href,
        headers: {
          'x-evo-session': sessionToken,
          'x-evo-profile': String(profile),
          'x-evo-platform': appConfig.clientPlatform,
          'x-evo-version': appConfig.clientVersion,
          'x-evo-version-code': appConfig.clientVersionCode,
        },
      };
    } catch (error) {
      if (error instanceof EvoApiError) throw error;
      throw new EvoApiError('O servidor retornou uma URL de reprodução inválida.');
    }
  }

  async directPlaybackUrl(
    token: string,
    sessionToken: string,
    profile: number,
    item: CatalogItem,
  ): Promise<string> {
    const normalized = item.extension.toLowerCase().replace(/[^a-z0-9]/g, '');
    const extension = item.kind === 'live' ? 'm3u8' : normalized.slice(0, 8) || 'mp4';
    const data = await this.backend('/api/stream-ticket', token, {
      method: 'POST',
      headers: sessionHeaders(sessionToken, profile),
      body: JSON.stringify({
        kind: item.kind,
        id: item.id,
        extension,
        transport: 'direct',
      }),
    });
    const source = text(data.url);
    if (text(data.transport) !== 'direct' || !source) {
      throw new EvoApiError('O servidor não retornou uma abertura compatível com este dispositivo.');
    }
    try {
      const url = new URL(source);
      const backend = new URL(appConfig.backendUrl);
      if (url.origin !== backend.origin || !url.pathname.startsWith('/open-stream/')) throw new Error();
      return url.href;
    } catch {
      throw new EvoApiError('O servidor retornou uma abertura de mídia inválida.');
    }
  }

  async watchSession(
    token: string,
    sessionToken: string,
    profile: number,
    signal: AbortSignal,
  ): Promise<SessionEnd | null> {
    const response = await fetch(`${appConfig.backendUrl}/api/session/events`, {
      headers: backendHeaders(token, sessionHeaders(sessionToken, profile)),
      signal,
    });
    if (!response.ok) {
      const data = await objectResponse(response);
      throw new EvoApiError(backendError(data, response.status));
    }
    const reader = response.body?.getReader();
    if (!reader) return null;
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      let boundary = buffer.match(/\r?\n\r?\n/);
      while (boundary?.index !== undefined) {
        const block = buffer.slice(0, boundary.index);
        buffer = buffer.slice(boundary.index + boundary[0].length);
        const lines = block.split(/\r?\n/);
        const event = lines.find((line) => line.startsWith('event:'))?.slice(6).trim();
        if (event === 'session-ended') {
          const rawData = lines
            .filter((line) => line.startsWith('data:'))
            .map((line) => line.slice(5).trim())
            .join('\n');
          try {
            const data = object(JSON.parse(rawData));
            return {
              code: text(data?.code) || 'SESSION_INVALID',
              message: text(data?.message) || 'A sessão deste perfil foi encerrada.',
            };
          } catch {
            return {
              code: 'SESSION_INVALID',
              message: 'A sessão deste perfil foi encerrada.',
            };
          }
        }
        boundary = buffer.match(/\r?\n\r?\n/);
      }
      if (done) return null;
    }
  }

  async releaseProfile(
    token: string,
    sessionToken: string,
    profile: number,
  ): Promise<void> {
    try {
      await this.backend('/api/session', token, {
        method: 'DELETE',
        headers: sessionHeaders(sessionToken, profile),
      });
    } catch {
      // Encerrar uma sessão é uma limpeza de melhor esforço.
    }
  }

  private async backend(
    path: string,
    token: string,
    init: RequestInit = {},
  ): Promise<JsonObject> {
    let response: Response;
    try {
      const headers = backendHeaders(token, init.headers);
      response = await fetchWithTimeout(`${appConfig.backendUrl}${path}`, {
        ...init,
        headers,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new EvoApiError('O servidor demorou demais para responder.');
      }
      throw new EvoApiError(
        'Não foi possível acessar o servidor. Verifique a conexão e o CORS do backend.',
      );
    }
    const data = await objectResponse(response);
    if (!response.ok) {
      throw new EvoApiError(backendError(data, response.status));
    }
    return data;
  }
}

function sessionHeaders(sessionToken: string, profile: number): HeadersInit {
  return {
    'x-evo-session': sessionToken,
    'x-evo-profile': String(profile),
  };
}

function backendHeaders(token: string, extraHeaders?: HeadersInit): Headers {
  const headers = new Headers({
    Accept: 'application/json',
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
    'x-evo-platform': appConfig.clientPlatform,
    'x-evo-version': appConfig.clientVersion,
    'x-evo-version-code': appConfig.clientVersionCode,
  });
  new Headers(extraHeaders).forEach((value, key) => headers.set(key, value));
  return headers;
}

async function generatePlaybackKeys(): Promise<PlaybackKeys> {
  if (!globalThis.crypto?.subtle) {
    throw new EvoApiError('Abra o EVOTV por uma conexão HTTPS segura.');
  }
  const keyPair = (await crypto.subtle.generateKey(
    {
      name: 'RSA-OAEP',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['encrypt', 'decrypt'],
  )) as CryptoKeyPair;
  const publicKey = bytesToBase64(
    new Uint8Array(await crypto.subtle.exportKey('spki', keyPair.publicKey)),
  );
  return {
    publicKey,
    async decrypt(envelope, expectedProfile) {
      if (integer(envelope.version, 0) !== 1) {
        throw new Error('Envelope inválido.');
      }
      const encryptedKey = decodeBase64Url(requiredText(envelope, 'key'));
      const rawKey = await crypto.subtle.decrypt(
        { name: 'RSA-OAEP' },
        keyPair.privateKey,
        asArrayBuffer(encryptedKey),
      );
      const iv = decodeBase64Url(requiredText(envelope, 'iv'));
      const encryptedData = decodeBase64Url(requiredText(envelope, 'data'));
      const tag = decodeBase64Url(requiredText(envelope, 'tag'));
      const ciphertext = new Uint8Array(encryptedData.length + tag.length);
      ciphertext.set(encryptedData);
      ciphertext.set(tag, encryptedData.length);
      const aesKey = await crypto.subtle.importKey(
        'raw',
        rawKey,
        { name: 'AES-GCM' },
        false,
        ['decrypt'],
      );
      const clear = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: asArrayBuffer(iv), tagLength: tag.length * 8 },
        aesKey,
        asArrayBuffer(ciphertext),
      );
      const decoded = object(JSON.parse(new TextDecoder().decode(clear)));
      if (!decoded) throw new Error('Conteúdo inválido.');

      const serverText = requiredText(decoded, 'server').replace(/\/+$/, '');
      const server = new URL(serverText);
      const profile = integer(decoded.profile, 0);
      const expiresAt = integer(decoded.expiresAt, 0);
      if (
        !['http:', 'https:'].includes(server.protocol) ||
        server.username ||
        server.password ||
        server.search ||
        server.hash ||
        profile !== expectedProfile ||
        decoded.type !== 'profile-playback' ||
        expiresAt <= Date.now()
      ) {
        throw new Error('Autorização inválida.');
      }
      return {
        server: serverText,
        username: requiredText(decoded, 'username'),
        password: requiredText(decoded, 'password'),
        profile,
        expiresAt,
      };
    },
  };
}

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 30_000);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    window.clearTimeout(timeout);
  }
}

async function objectResponse(response: Response): Promise<JsonObject> {
  const body = await response.text();
  if (!body.trim()) return {};
  try {
    return object(JSON.parse(body)) ?? {};
  } catch {
    throw new EvoApiError('O serviço retornou uma resposta inválida.');
  }
}

function catalogItem(data: JsonObject | null, kind: MediaKind): CatalogItem | null {
  if (!data) return null;
  const id = text(data[kind === 'series' ? 'series_id' : 'stream_id']);
  if (!id) return null;
  return {
    id,
    name: text(data.name).trim() || 'Sem título',
    categoryId: text(data.category_id),
    extension:
      text(data.container_extension).trim() || (kind === 'live' ? 'ts' : 'mp4'),
    imageUrl: text(data[kind === 'series' ? 'cover' : 'stream_icon']),
    kind,
  };
}

function seriesEpisode(data: JsonObject | null, index: number): SeriesEpisode | null {
  if (!data) return null;
  const info = object(data.info) ?? {};
  const id = text(data.id);
  if (!id) return null;
  const number = integer(data.episode_num ?? info.episode_num, index + 1);
  return {
    id,
    number,
    title: firstText(data.title, info.name, `Episódio ${number}`),
    duration: firstText(info.duration, info.duration_secs),
    extension: firstText(data.container_extension, 'mp4'),
  };
}

function firebaseError(data: JsonObject): string {
  const error = data.error;
  const details = object(error);
  return details ? text(details.message) : text(error);
}

function backendError(data: JsonObject, status: number): string {
  const error = data.error;
  if (typeof error === 'string' && error.trim()) return error;
  const details = object(error);
  const nested = details ? text(details.message).trim() : '';
  return nested || text(data.message).trim() || `O serviço respondeu com o código ${status}.`;
}

function object(value: unknown): JsonObject | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

function text(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

function integer(value: unknown, fallback: number): number {
  const result = Number.parseInt(text(value), 10);
  return Number.isFinite(result) ? result : fallback;
}

function firstText(...values: unknown[]): string {
  for (const value of values) {
    const candidate = text(value).trim();
    if (candidate) return candidate;
  }
  return '';
}

function requiredText(data: JsonObject, key: string): string {
  const result = text(data[key]);
  if (!result) throw new Error(`Campo ausente: ${key}.`);
  return result;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

function decodeBase64Url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padding = '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(normalized + padding);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function asArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}
