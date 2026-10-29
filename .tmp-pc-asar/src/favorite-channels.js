(function (root, factory) {
  const organization = typeof module === 'object' && module.exports ? require('./catalog-organization') : root.catalogOrganization;
  const api = factory(organization);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else {
    root.FavoriteChannels = api.FavoriteChannels;
    root.favoriteAccountKey = api.accountKey;
    root.favoriteChannels = new api.FavoriteChannels({ storage: root.localStorage });
    root.adultFavoriteChannels = new api.FavoriteChannels({ storage: root.localStorage, defaultKeys: [], adult: true });
  }
})(typeof window === 'object' ? window : globalThis, organization => {
  const defaults = (organization?.FAVORITES_DEFAULT || []).map(item => item.key);
  const validKey = value => typeof value === 'string' && value.length > 0 && value.length <= 160 && /^[a-z0-9:+! _-]+$/.test(value);
  const clean = values => [...new Set((Array.isArray(values) ? values : []).filter(validKey))].slice(0, 256);
  function accountKey(login) {
    let hash = 2166136261;
    for (const character of String(login || '').trim().toLowerCase()) { hash ^= character.codePointAt(0); hash = Math.imul(hash, 16777619); }
    return (hash >>> 0).toString(16).padStart(8, '0');
  }
  class FavoriteChannels {
    constructor({ storage, defaultKeys = defaults, adult = false } = {}) { this.storage = storage; this.defaults = clean(defaultKeys); this.adult = adult; this.storageKey = ''; }
    select(account, profile) {
      const number = Number(profile);
      const prefix = this.adult ? 'evo:adult-channel-favorites:v1' : 'evo:favorites:v1';
      this.storageKey = /^[a-f0-9]{8}$/.test(String(account)) && Number.isInteger(number) && number > 0 ? `${prefix}:${account}:profile:${number}` : '';
      return this.list();
    }
    list() {
      if (!this.storageKey || !this.storage) return [...this.defaults];
      try {
        const parsed = JSON.parse(this.storage.getItem(this.storageKey));
        return parsed?.version === 1 && Array.isArray(parsed.items) ? clean(parsed.items) : [...this.defaults];
      } catch { return [...this.defaults]; }
    }
    save(values) {
      const items = clean(values);
      if (this.storageKey && this.storage) try { this.storage.setItem(this.storageKey, JSON.stringify({ version: 1, items })); } catch {}
      return items;
    }
    contains(key) { return this.list().includes(key); }
    toggle(key) {
      if (!validKey(key)) return this.list();
      const items = this.list(), index = items.indexOf(key);
      if (index >= 0) items.splice(index, 1); else items.push(key);
      return this.save(items);
    }
    move(key, offset) {
      const items = this.list(), from = items.indexOf(key), to = from + Math.sign(Number(offset) || 0);
      if (from < 0 || to < 0 || to >= items.length) return items;
      [items[from], items[to]] = [items[to], items[from]];
      return this.save(items);
    }
    reset() { return this.save(this.defaults); }
  }
  return { FavoriteChannels, accountKey, defaultKeys: [...defaults] };
});
