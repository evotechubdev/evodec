(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.LiveQuality = api.LiveQuality;
})(typeof window === 'object' ? window : globalThis, () => {
  class LiveQuality {
    constructor({ variants, onSwitch, onError = () => {}, now = () => performance.now() }) {
      const ids = new Set();
      this.variants = (Array.isArray(variants) ? variants : []).filter(item => {
        const id = String(item?.stream_id);
        if (!/^\d+$/.test(id) || ids.has(id) || !Number.isInteger(item.quality) || item.quality < 0 || item.quality > 5) return false;
        ids.add(id); return true;
      }).slice(0, 512).sort((a, b) => b.quality - a.quality);
      this.onSwitch = onSwitch; this.onError = onError; this.now = now;
      // Startup favors the best tier up to HD. A first frame is more valuable
      // than opening at 4K/FHD and making the viewer wait for a heavy feed.
      this.index = this.variants.findIndex(variant => variant.quality <= 2);
      if (this.index < 0) this.index = Math.max(0, this.variants.length - 1);
      this.automatic = true; this.pending = false; this.stopped = false;
      this.blocked = new Map(); this.failures = new Map();
      this.lastSwitch = this.now(); this.reset();
    }
    current() { return this.variants[this.index] || null; }
    qualityOptions() {
      const labels = ['Padrão', 'SD', 'HD', 'Full HD', '4K', '8K'];
      const seen = new Set();
      const options = [{ value: 'auto', label: 'Automática', selected: this.automatic }];
      for (const variant of this.variants) {
        if (seen.has(variant.quality)) continue;
        seen.add(variant.quality);
        options.push({ value: String(variant.quality), label: labels[variant.quality] || 'Padrão', selected: !this.automatic && this.current()?.quality === variant.quality });
      }
      return options;
    }
    selectQuality(value) {
      if (this.stopped) return Promise.reject(new Error('A reprodução foi encerrada.'));
      if (value === 'auto') { this.automatic = true; this.reset(); return Promise.resolve(false); }
      const quality = Number(value), index = this.variants.findIndex(variant => variant.quality === quality);
      if (!Number.isInteger(quality) || index < 0) return Promise.reject(new Error('Qualidade indisponível.'));
      this.automatic = false;
      if (index === this.index) { this.reset(); return Promise.resolve(false); }
      return this.change(index, 'manual');
    }
    reset() {
      this.started = this.now(); this.lastProgress = this.started; this.healthySince = null;
      this.hasPlayed = false; this.previous = null; this.lossWindow = null; this.paused = false;
    }
    stop() { this.stopped = true; }
    lower(reason = 'stall') {
      if (this.stopped || this.variants.length < 2) return false;
      if (this.pending) return true;
      const now = this.now(), quality = this.variants[this.index].quality;
      let next = this.variants.findIndex((variant, index) => index > this.index && variant.quality < quality && (this.blocked.get(index) || 0) <= now);
      // Alternate sources of the same quality are useful when no lower tier
      // exists, but never delay a lower tier when the connection is struggling.
      if (next < 0) next = this.variants.findIndex((variant, index) => index !== this.index && variant.quality === quality && (this.blocked.get(index) || 0) <= now);
      if (next < 0) return false;
      const failures = (this.failures.get(this.index) || 0) + 1;
      this.failures.set(this.index, failures);
      this.blocked.set(this.index, now + Math.min(600_000, 120_000 * 2 ** (failures - 1)));
      this.change(next, reason); return true;
    }
    change(index, reason) {
      this.index = index; this.pending = true; this.lastSwitch = this.now();
      const operation = Promise.resolve().then(() => {
        if (!this.stopped) return this.onSwitch(this.variants[index], reason);
      }).then(() => {
        if (this.stopped) return;
        this.pending = false; this.reset();
      }).catch(error => {
        if (this.stopped) return;
        this.pending = false;
        if (!this.lower('error')) { this.stop(); this.onError(error); }
      });
      return operation;
    }
    observe(update) {
      if (this.stopped || !this.variants.length) return false;
      if (this.pending) return true;
      if (!this.automatic) return false;
      const now = this.now();
      if (update.state === 7 || update.state === 6) return this.lower('error');
      if (update.state === 4) { this.paused = true; this.previous = null; this.healthySince = null; this.lastProgress = now; return false; }
      if (this.paused) { this.reset(); this.started = now; }
      const video = Number(update.width) > 0 || Number(update.decodedVideo) > 0;
      const key = video ? Number(update.displayedPictures) > 0 ? 'displayedPictures' : 'decodedVideo'
        : Number(update.playedAudio) > 0 ? 'playedAudio' : Number(update.decodedAudio) > 0 ? 'decodedAudio' : 'time';
      const count = Number(update[key]) || 0, prior = this.previous;
      if (prior && now - prior.at > 2000) {
        // A suspended or backgrounded renderer is not evidence of a slow feed.
        this.lastProgress = now; this.healthySince = null; this.lossWindow = null;
      }
      const progressed = count > 0 && (!prior || prior.key !== key || count > prior.count);
      if (progressed && update.state === 3) {
        this.lastProgress = now; this.hasPlayed = true;
        if (this.healthySince == null) this.healthySince = now;
      }
      if (update.state !== 3 || (prior && Number(update.lostPictures) > prior.lost)) this.healthySince = null;
      this.previous = { at: now, key, count, lost: Number(update.lostPictures) || 0 };
      if (now - this.lastProgress >= (this.hasPlayed ? 2000 : 4500)) {
        this.healthySince = null;
        if (this.lower('stall')) return true;
      }
      const displayed = Number(update.displayedPictures) || 0, lost = Number(update.lostPictures) || 0;
      if (!this.lossWindow) this.lossWindow = { at: now, displayed, lost };
      if (now - this.lossWindow.at >= 4000) {
        const good = displayed - this.lossWindow.displayed, bad = lost - this.lossWindow.lost;
        this.lossWindow = { at: now, displayed, lost };
        if (good >= 0 && bad > 0 && good + bad >= 30 && bad / (good + bad) > 0.2 && this.lower('frames')) return true;
      }
      if (this.healthySince != null && now - this.healthySince >= 45_000 && now - this.lastSwitch >= 60_000 && now - this.lastProgress < 1000) {
        const current = this.variants[this.index].quality;
        for (let index = this.index - 1; index >= 0; index--) {
          if (this.variants[index].quality > current) {
            // Never jump over a recently failing tier to an even heavier one.
            if ((this.blocked.get(index) || 0) <= now) { this.change(index, 'upgrade'); return true; }
            break;
          }
        }
      }
      return false;
    }
  }
  return { LiveQuality };
});
