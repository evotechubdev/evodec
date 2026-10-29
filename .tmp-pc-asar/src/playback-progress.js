(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else {
    root.PlaybackProgress = api.PlaybackProgress;
    root.playbackProgress = new api.PlaybackProgress({ storage: root.localStorage });
  }
})(typeof window === 'object' ? window : globalThis, () => {
  const validId = value => /^[a-z0-9._-]{1,128}$/i.test(String(value || ''));
  const validKind = value => ['movie', 'series'].includes(String(value || ''));
  const cleanNumber = value => Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;

  class PlaybackProgress {
    constructor({ storage } = {}) { this.storage = storage; this.storageKey = ''; }
    select(account, profile) {
      const number = Number(profile);
      this.storageKey = /^[a-f0-9]{8}$/.test(String(account)) && Number.isInteger(number) && number > 0
        ? `evo:playback-progress:v1:${account}:profile:${number}` : '';
    }
    key(media = {}) {
      const kind = String(media.kind || '');
      const id = String(media.mediaId ?? media.id ?? '').trim();
      return validKind(kind) && validId(id) ? `${kind}:${id}` : '';
    }
    all() {
      if (!this.storageKey || !this.storage) return {};
      try {
        const parsed = JSON.parse(this.storage.getItem(this.storageKey));
        return parsed?.version === 1 && parsed.items && typeof parsed.items === 'object' ? parsed.items : {};
      } catch { return {}; }
    }
    get(media) {
      const item = this.all()[this.key(media)];
      if (!item || typeof item !== 'object') return null;
      const position = cleanNumber(item.position), duration = cleanNumber(item.duration);
      if (position < 10 || (duration > 0 && (position / duration >= 0.95 || duration - position <= 45))) return null;
      return { position, duration, updatedAt: cleanNumber(item.updatedAt) };
    }
    save(media, position, duration) {
      const key = this.key(media);
      if (!key || !this.storageKey || !this.storage) return;
      position = cleanNumber(position); duration = cleanNumber(duration);
      const items = this.all();
      if (position < 10 || (duration > 0 && (position / duration >= 0.95 || duration - position <= 45))) delete items[key];
      else items[key] = { position: Math.floor(position), duration: Math.floor(duration), updatedAt: Date.now() };
      const entries = Object.entries(items).sort((a, b) => cleanNumber(b[1]?.updatedAt) - cleanNumber(a[1]?.updatedAt)).slice(0, 500);
      try { this.storage.setItem(this.storageKey, JSON.stringify({ version: 1, items: Object.fromEntries(entries) })); } catch {}
    }
    clear(media) {
      const key = this.key(media);
      if (!key || !this.storageKey || !this.storage) return;
      const items = this.all(); delete items[key];
      try { this.storage.setItem(this.storageKey, JSON.stringify({ version: 1, items })); } catch {}
    }
  }
  return { PlaybackProgress };
});
