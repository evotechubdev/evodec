const crypto = require('node:crypto');
const http = require('node:http');
const net = require('node:net');
const dns = require('node:dns').promises;
const { promisify } = require('node:util');
const { createMediaProxy, mediaError } = require('./desktop-media-proxy');
const { createSecureFetch } = require('./desktop-provider-fetch');

function privateAddress(address) {
  if (net.isIPv4(address)) {
    const [a, b] = address.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
  }
  const value = address.toLowerCase();
  if (value.startsWith('::ffff:')) return privateAddress(value.slice(7));
  return value === '::1' || value === '::' || /^(fc|fd|fe[89ab])/.test(value);
}

class DesktopPlayback {
  constructor({ fetchImpl = fetch, validateTarget, now = Date.now } = {}) {
    this.now = now;
    this.records = new Map();
    this.profileRequests = new Set();
    this.assets = new Map();
    this.assetKeys = new Map();
    this.closed = false;
    this.generation = 0;
    this.keys = promisify(crypto.generateKeyPair)('rsa', { modulusLength: 2048 });
    this.secureFetch = createSecureFetch(validateTarget || (async (raw) => {
      const url = new URL(raw);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Destino inválido.');
      const addresses = await dns.lookup(url.hostname, { all: true, verbatim: true });
      if (!addresses.length || addresses.some(({ address }) => privateAddress(address))) throw new Error('Destino inválido.');
      return url;
    }), { fetchImpl });
  }

  async publicKey() {
    const { publicKey } = await this.keys;
    if (this.closed) throw new Error('A sessão de reprodução terminou.');
    return publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  }

  async decrypt(envelope) {
    const { privateKey } = await this.keys;
    if (this.closed || envelope?.version !== 1) throw new Error('Autorização de reprodução inválida.');
    try {
      const key = crypto.privateDecrypt({ key: privateKey, oaepHash: 'sha256', padding: crypto.constants.RSA_PKCS1_OAEP_PADDING }, Buffer.from(envelope.key, 'base64url'));
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64url'));
      decipher.setAuthTag(Buffer.from(envelope.tag, 'base64url'));
      const data = JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.data, 'base64url')), decipher.final()]).toString('utf8'));
      key.fill(0);
      return data;
    } catch { throw new Error('Autorização de reprodução inválida.'); }
  }

  async acceptProfile(envelope, expected) {
    const data = await this.decrypt(envelope);
    const server = new URL(data.server);
    if (data.type !== 'profile-playback' || data.profile !== expected.profile
      || !Number.isFinite(data.expiresAt) || data.expiresAt <= this.now() || data.expiresAt > this.now() + 12 * 60 * 60 * 1000 + 60_000
      || !['http:', 'https:'].includes(server.protocol) || server.username || server.password || server.search || server.hash
      || typeof data.username !== 'string' || !data.username || data.username.length > 512
      || typeof data.password !== 'string' || !data.password || data.password.length > 512) throw new Error('Autorização do perfil inválida ou expirada.');
    this.profileGrant = {
      server: server.href.replace(/\/$/, ''), username: data.username, password: data.password,
      profile: data.profile, expiresAt: data.expiresAt,
    };
  }

  hasProfileGrant() {
    return Boolean(this.profileGrant && this.profileGrant.expiresAt > this.now());
  }

  source(kind, id, extension, profile) {
    const grant = this.profileGrant;
    const folder = { live: 'live', movie: 'movie', series: 'series' }[kind];
    if (!this.hasProfileGrant() || grant.profile !== profile) throw new Error('A sessão de reprodução do perfil terminou.');
    if (!folder || !/^\d+$/.test(String(id)) || !/^[a-z0-9]{1,8}$/i.test(extension)) throw new Error('Conteúdo inválido.');
    return `${grant.server}/${folder}/${encodeURIComponent(grant.username)}/${encodeURIComponent(grant.password)}/${id}.${extension}`;
  }

  async providerJson(action, extra = {}, profile) {
    const grant = this.profileGrant;
    if (this.closed || !this.hasProfileGrant() || grant.profile !== profile) throw new Error('A sessão do perfil terminou.');
    if (!['get_live_categories', 'get_live_streams', 'get_vod_categories', 'get_vod_streams', 'get_vod_info', 'get_series_categories', 'get_series', 'get_series_info'].includes(action)) throw new Error('Operação de catálogo inválida.');
    if (action === 'get_series_info' && !/^\d+$/.test(String(extra.series_id || ''))) throw new Error('Série inválida.');
    if (action === 'get_vod_info' && !/^\d+$/.test(String(extra.vod_id || ''))) throw new Error('Filme inválido.');
    const target = new URL(`${grant.server}/player_api.php`);
    target.search = new URLSearchParams({ username: grant.username, password: grant.password, action });
    if (action === 'get_series_info') target.searchParams.set('series_id', String(extra.series_id));
    if (action === 'get_vod_info') target.searchParams.set('vod_id', String(extra.vod_id));
    const controller = new AbortController(); this.profileRequests.add(controller);
    const timeout = setTimeout(() => controller.abort(), Math.min(20_000, grant.expiresAt - this.now())); timeout.unref?.();
    const failure = (message, code) => Object.assign(new Error(message), { code });
    try {
      const response = await this.secureFetch(target.href, { headers: { 'user-agent': 'VLC/3.0.21 LibVLC/3.0.21', accept: 'application/json' }, signal: controller.signal });
      if (!response.ok) {
        await response.body?.cancel();
        throw failure([401, 403].includes(response.status) ? `O provedor recusou o catálogo também pelo computador (${response.status}). Verifique a conta de TV com o provedor.` : `Não foi possível obter o catálogo do provedor (${response.status}).`, 'TV_PROVIDER_FAILED');
      }
      const chunks = []; let size = 0;
      for await (const chunk of response.body || []) {
        size += chunk.length;
        if (size > 64 * 1024 * 1024) { controller.abort(); throw failure('O catálogo recebido excedeu o limite permitido.', 'TV_PROVIDER_FAILED'); }
        chunks.push(chunk);
      }
      if (this.closed || this.profileGrant !== grant || !this.hasProfileGrant()) throw failure('A sessão do perfil terminou.', 'TV_PROFILE_ENDED');
      let value;
      try { value = JSON.parse(Buffer.concat(chunks).toString('utf8').replace(/^\uFEFF/, '')); }
      catch { throw failure('O provedor enviou uma resposta inválida para o catálogo.', 'TV_PROVIDER_FAILED'); }
      if (String(value?.user_info?.auth) === '0') throw failure('O provedor recusou o acesso à conta de TV.', 'TV_PROVIDER_FAILED');
      const detailsAction = ['get_series_info', 'get_vod_info'].includes(action);
      if (detailsAction ? !value || typeof value !== 'object' || Array.isArray(value) : !Array.isArray(value)) throw failure('O provedor enviou um catálogo inválido.', 'TV_PROVIDER_FAILED');
      return value;
    } catch (error) {
      if (String(error.code || '').startsWith('TV_')) throw error;
      if (this.closed || this.profileGrant !== grant) throw new Error('A sessão do perfil terminou.');
      throw new Error(controller.signal.aborted ? 'O provedor demorou para enviar o catálogo. Tente novamente.' : 'Não foi possível obter o catálogo pela conexão deste computador.');
    } finally { clearTimeout(timeout); this.profileRequests.delete(controller); }
  }

  async catalogValue(value, profile, field = '') {
    const grant = this.profileGrant;
    if (this.closed || !this.hasProfileGrant() || grant.profile !== profile) throw new Error('A sessão do perfil terminou.');
    if (Array.isArray(value)) return Promise.all(value.map(item => this.catalogValue(item, profile)));
    if (value && typeof value === 'object') return Object.fromEntries(await Promise.all(Object.entries(value).filter(([key]) => !['direct_source', 'stream_url', 'username', 'password', 'login', 'senha', 'url_server'].includes(key)).map(async ([key, item]) => [key, await this.catalogValue(item, profile, key)])));
    if (typeof value !== 'string') return value;
    if (['id', 'stream_id', 'series_id', 'category_id', 'season', 'episode_num', 'parent_id'].includes(field)) return value;
    if (['youtube_trailer', 'trailer', 'trailer_url'].includes(field) && /^https?:\/\//i.test(value)) {
      try {
        const trailer = new URL(value);
        if (/(^|\.)(?:youtube\.com|youtu\.be|youtube-nocookie\.com)$/i.test(trailer.hostname)) return trailer.toString();
      } catch {}
    }
    if (/^https?:\/\//i.test(value)) {
      await this.listen();
      if (this.closed || this.profileGrant !== grant) throw new Error('A sessão do perfil terminou.');
      let token = this.assetKeys.get(value);
      const previous = this.assets.get(token);
      if (!previous || previous.expiresAt <= this.now()) {
        if (previous) this.assets.delete(token);
        token = crypto.randomBytes(24).toString('base64url');
        this.assets.set(token, { target: value, grant, expiresAt: Math.min(grant.expiresAt, this.now() + 30 * 60_000) });
        this.assetKeys.set(value, token);
        while (this.assets.size > 3000) { const first = this.assets.keys().next().value; this.assetKeys.delete(this.assets.get(first).target); this.assets.delete(first); }
      }
      return `${this.origin}/asset/${token}`;
    }
    return value.replaceAll(grant.server, '[servidor-protegido]').replaceAll(grant.username, '[usuario-protegido]').replaceAll(grant.password, '[senha-protegida]');
  }

  async handleAsset(req, res, token) {
    const record = this.assets.get(token);
    if (!record || this.closed || record.grant !== this.profileGrant || record.expiresAt <= this.now()) return res.writeHead(404).end();
    const controller = new AbortController(); this.profileRequests.add(controller);
    const timeout = setTimeout(() => controller.abort(), 15_000); timeout.unref?.();
    const cancel = () => { if (!res.writableEnded) controller.abort(); }; res.once('close', cancel);
    try {
      const response = await this.secureFetch(record.target, { signal: controller.signal, headers: { 'user-agent': 'VLC/3.0.21 LibVLC/3.0.21' } });
      const type = response.headers.get('content-type')?.split(';')[0] || '';
      if (!response.ok || !/^image\/(?:jpeg|png|gif|webp|avif|svg\+xml|x-icon|vnd\.microsoft\.icon|bmp)$/i.test(type)) { await response.body?.cancel(); return res.writeHead(502).end(); }
      if (req.method === 'HEAD') { await response.body?.cancel(); return res.writeHead(200, { 'content-type': type, 'x-content-type-options': 'nosniff' }).end(); }
      const chunks = []; let size = 0;
      for await (const chunk of response.body || []) { size += chunk.length; if (size > 8 * 1024 * 1024) { controller.abort(); throw new Error('Imagem excede o limite.'); } chunks.push(chunk); }
      if (this.closed || record.grant !== this.profileGrant || !this.hasProfileGrant()) return res.writeHead(404).end();
      res.writeHead(200, { 'content-type': type, 'content-length': size, 'cache-control': 'private, max-age=300', 'x-content-type-options': 'nosniff' }).end(Buffer.concat(chunks));
    } catch { if (!res.destroyed && !res.writableEnded) res.writeHead(502).end(); }
    finally { clearTimeout(timeout); this.profileRequests.delete(controller); res.removeListener('close', cancel); }
  }

  async listen() {
    if (!this.listening) this.listening = (async () => {
      this.server = http.createServer((req, res) => this.handle(req, res).catch((error) => mediaError(res, error)));
      await new Promise((resolve, reject) => { this.server.once('error', reject); this.server.listen(0, '127.0.0.1', resolve); });
      this.origin = `http://127.0.0.1:${this.server.address().port}`;
      if (this.closed) { this.server.close(); throw new Error('A sessão de reprodução terminou.'); }
    })();
    await this.listening;
  }

  async accept(envelope, expected, { direct = false } = {}) {
    const generation = ++this.generation;
    const data = await this.decrypt(envelope);
    if (this.closed || generation !== this.generation) throw new Error('Autorização de reprodução inválida.');
    if (!Number.isFinite(data.expiresAt) || data.expiresAt <= this.now() || data.expiresAt > this.now() + 12 * 60 * 60 * 1000 + 60_000
      || data.profile !== expected.profile || data.kind !== expected.kind || String(data.id) !== String(expected.id)
      || data.extension !== expected.extension || !/^\d+$/.test(String(data.id)) || !/^[a-z0-9]{1,8}$/i.test(data.extension)) throw new Error('Autorização de reprodução inválida ou expirada.');
    if ((data.purpose || 'play') !== (expected.purpose || 'play') || (expected.purpose === 'download' && data.canDownload !== true)) throw new Error('Download não autorizado para esta conta.');
    const target = new URL(data.target);
    if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password) throw new Error('Destino de reprodução inválido.');
    if (direct) {
      if ((expected.purpose || 'play') !== 'play') throw new Error('Autorização de reprodução inválida.');
      // Playback uses the original source without a proxy or media processing.
      // Downloads and cancellable adaptive live channels use localStream below.
      this.release();
      return target.href;
    }
    return this.localStream(data, generation);
  }

  async liveSource(id, extension, profile) {
    const target = this.source('live', id, extension, profile);
    const generation = ++this.generation;
    return this.localStream({ kind: 'live', id: String(id), extension, profile, target, expiresAt: this.profileGrant.expiresAt }, generation);
  }

  async localStream(data, generation) {
    await this.listen();
    if (this.closed || generation !== this.generation) throw new Error('A sessão de reprodução terminou.');
    this.release();
    const token = crypto.randomBytes(24).toString('base64url');
    const record = { ...data, token, key: crypto.randomBytes(32), controllers: new Set() };
    record.proxy = createMediaProxy({
      secureFetch: this.secureFetch, publicUrl: this.origin, tokenTtl: data.expiresAt - this.now(),
      ...(data.kind === 'live' ? { userAgent: 'VLC/3.0.21 LibVLC/3.0.21' } : {}),
      seal: (value) => {
        const iv = crypto.randomBytes(12);
        const cipher = crypto.createCipheriv('aes-256-gcm', record.key, iv);
        const encrypted = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
        return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString('base64url')).join('.');
      },
      registerStream: (_ticket, controller) => { record.controllers.add(controller); return () => record.controllers.delete(controller); },
    });
    record.timer = setTimeout(() => this.remove(token), Math.max(1, data.expiresAt - this.now()));
    record.timer.unref?.();
    this.records.set(token, record);
    return `${this.origin}/stream/${token}/${data.id}.${data.extension}`;
  }

  owns(raw) {
    try {
      const url = new URL(raw);
      return url.origin === this.origin && !url.search && !url.hash && this.records.has(url.pathname.split('/')[2]);
    } catch { return false; }
  }

  async handle(req, res) {
    if (req.headers.host !== new URL(this.origin).host || !['GET', 'HEAD'].includes(req.method)) return res.writeHead(403).end();
    const url = new URL(req.url, this.origin);
    const asset = /^\/asset\/([a-zA-Z0-9_-]+)$/.exec(url.pathname);
    if (asset && !url.search && !url.hash) return this.handleAsset(req, res, asset[1]);
    const [, type, token, resource, extra] = url.pathname.split('/');
    const record = this.records.get(token);
    if (!record || this.closed || record.expiresAt <= this.now() || extra || url.search || !resource) return res.writeHead(401).end();
    let target = record.target;
    try {
      if (type === 'segment') {
        const [iv, tag, encrypted] = resource.split('.').map((part) => Buffer.from(part, 'base64url'));
        const decipher = crypto.createDecipheriv('aes-256-gcm', record.key, iv);
        decipher.setAuthTag(tag);
        target = JSON.parse(Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8')).target;
      } else if (type !== 'stream' || resource !== `${record.id}.${record.extension}`) return res.writeHead(404).end();
      await record.proxy(req, res, target, token);
    } catch (error) { mediaError(res, error); }
  }

  remove(token) {
    const record = this.records.get(token);
    if (!record) return;
    clearTimeout(record.timer);
    for (const controller of record.controllers) controller.abort();
    record.key.fill(0);
    this.records.delete(token);
  }

  release() { this.generation += 1; for (const token of this.records.keys()) this.remove(token); }

  close() {
    this.closed = true;
    for (const controller of this.profileRequests) controller.abort();
    this.profileRequests.clear(); this.assets.clear(); this.assetKeys.clear();
    this.profileGrant = null;
    this.release();
    this.server?.closeAllConnections();
    this.server?.close();
    this.keys = null;
  }
}

module.exports = { DesktopPlayback };
