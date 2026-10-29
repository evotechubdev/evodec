const { ContentCatalog, CATALOG, permitted } = require('./catalog-rules');

class DesktopCatalog {
  constructor(playback, profile, { now = Date.now } = {}) {
    this.playback = playback; this.profile = profile; this.now = now;
    this.cache = new Map(); this.closed = false;
    this.catalog = new ContentCatalog(action => this.load(action));
  }
  async load(action, extra = {}) {
    if (this.closed || !this.playback.hasProfileGrant()) throw new Error('A sessão do perfil terminou.');
    const key = JSON.stringify([action, extra]);
    const found = this.cache.get(key);
    if (found && (found.pending || found.until > this.now())) return found.pending || found.value;
    const pending = this.playback.providerJson(action, extra, this.profile).then(value => {
      if (this.closed) throw new Error('A sessão do perfil terminou.');
      this.cache.delete(key); this.cache.set(key, { value, until: this.now() + 5 * 60_000 });
      while (this.cache.size > 80) this.cache.delete(this.cache.keys().next().value);
      return value;
    }).catch(error => { if (this.cache.get(key)?.pending === pending) this.cache.delete(key); throw error; });
    this.cache.set(key, { pending });
    return pending;
  }
  async request(route, body, parental, adultAllowed) {
    if (this.closed) throw new Error('A sessão do perfil terminou.');
    const grant = { parental: parental || { enabled: true, maxAge: 18 }, adultAllowed };
    const adult = body.adult === true;
    let value;
    if (route === '/api/catalog') {
      const category = String(body.category || 'all');
      if (category !== 'all' && !/^[a-z0-9_-]{1,64}$/i.test(category)) throw new Error('Categoria inválida.');
      value = await this.catalog.page(body.section, grant, { category, query: String(body.query || '').slice(0, 100), page: Math.max(1, Math.min(100_000, Number.parseInt(body.page, 10) || 1)), limit: Math.max(12, Math.min(60, Number.parseInt(body.limit, 10) || 48)), adult, favorites: body.favorites });
    } else if (route === '/api/tv') {
      const section = Object.keys(CATALOG).find(key => [CATALOG[key].list, CATALOG[key].categories].includes(body.action));
      if (section && body.action === CATALOG[section].categories) value = await this.catalog.categories(section, grant, adult);
      else if (section) value = (await this.catalog.page(section, grant, { category: String(body.extra?.category_id || 'all'), limit: 100_000, adult })).items;
      else if (body.action === 'get_series_info') {
        const id = String(body.extra?.series_id || '');
        if (!/^\d+$/.test(id)) throw new Error('Série inválida.');
        const entry = (await this.catalog.section('series')).index.get(id);
        if (!entry) throw new Error('Série não encontrada.');
        if (!permitted(entry, grant, entry.adult)) throw new Error('Série bloqueada pelo controle parental.');
        value = await this.load('get_series_info', { series_id: id });
        this.catalog.rememberEpisodes(id, value);
      } else if (body.action === 'get_vod_info') {
        const id = String(body.extra?.vod_id || '');
        if (!/^\d+$/.test(id)) throw new Error('Filme inválido.');
        const entry = (await this.catalog.section('movies')).index.get(id);
        if (!entry) throw new Error('Filme não encontrado.');
        if (!permitted(entry, grant, entry.adult)) throw new Error('Filme bloqueado pelo controle parental.');
        value = await this.load('get_vod_info', { vod_id: id });
      } else throw new Error('Operação de catálogo inválida.');
    } else throw new Error('Operação de catálogo inválida.');
    if (this.closed) throw new Error('A sessão do perfil terminou.');
    return this.playback.catalogValue(value, this.profile);
  }
  close() { this.closed = true; this.cache.clear(); this.catalog.sections.clear(); this.catalog.episodes.clear(); }
}
module.exports = { DesktopCatalog };
