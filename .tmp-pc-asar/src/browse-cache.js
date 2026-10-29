// Cache only within the authorized profile. Expire before opaque artwork URLs.
class BrowseCache {
  constructor({ now = Date.now, ttl = 5 * 60_000, max = 60 } = {}) { this.now = now; this.ttl = ttl; this.max = max; this.items = new Map(); }
  key(value) { return JSON.stringify(value); }
  get(value) {
    const key = this.key(value); const entry = this.items.get(key);
    if (!entry || entry.until <= this.now()) { this.items.delete(key); return null; }
    this.items.delete(key); this.items.set(key, entry); return entry.value;
  }
  set(value, result) {
    const key = this.key(value); this.items.delete(key); this.items.set(key, { value: result, until: this.now() + this.ttl });
    while (this.items.size > this.max) this.items.delete(this.items.keys().next().value);
    return result;
  }
  clear() { this.items.clear(); }
}
if (typeof module !== 'undefined') module.exports = { BrowseCache };
