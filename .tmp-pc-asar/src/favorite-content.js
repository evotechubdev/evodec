(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else {
    root.FavoriteContent = api.FavoriteContent;
    root.favoriteContent = new api.FavoriteContent({ storage: root.localStorage });
  }
})(typeof window === 'object' ? window : globalThis, () => {
  const validKey = value => typeof value === 'string' && /^(?:adult-)?(?:movie|series|episode):[a-z0-9._-]{1,128}$/i.test(value);
  const clean = values => [...new Set((Array.isArray(values) ? values : []).filter(validKey))].slice(0, 1000);
  class FavoriteContent {
    constructor({ storage } = {}) { this.storage = storage; this.storageKey = ''; }
    select(account, profile) {
      const number = Number(profile);
      this.storageKey = /^[a-f0-9]{8}$/.test(String(account)) && Number.isInteger(number) && number > 0
        ? `evo:content-favorites:v1:${account}:profile:${number}` : '';
      return this.list();
    }
    key(media = {}) {
      media = media && typeof media === 'object' ? media : {};
      const kind = String(media.favoriteKind || '');
      const id = String(media.favoriteId ?? media.mediaId ?? '').trim();
      const key = `${media.favoriteAdult === true ? 'adult-' : ''}${kind}:${id}`;
      return validKey(key) ? key : '';
    }
    ids(kind, adult = false) {
      const prefix = `${adult ? 'adult-' : ''}${kind}:`;
      return this.list().filter(key => key.startsWith(prefix)).map(key => key.slice(prefix.length));
    }
    list() {
      if (!this.storageKey || !this.storage) return [];
      try {
        const parsed = JSON.parse(this.storage.getItem(this.storageKey));
        return parsed?.version === 1 ? clean(parsed.items) : [];
      } catch { return []; }
    }
    save(values) {
      const items = clean(values);
      if (this.storageKey && this.storage) try { this.storage.setItem(this.storageKey, JSON.stringify({ version: 1, items })); } catch {}
      return items;
    }
    contains(media) { const key = this.key(media); return Boolean(key) && this.list().includes(key); }
    toggle(media) {
      const key = this.key(media);
      if (!key) return { active: false, key: '', items: this.list() };
      const items = this.list(), index = items.indexOf(key);
      if (index >= 0) items.splice(index, 1); else items.push(key);
      const saved = this.save(items);
      return { active: saved.includes(key), key, items: saved };
    }
  }
  return { FavoriteContent };
});
