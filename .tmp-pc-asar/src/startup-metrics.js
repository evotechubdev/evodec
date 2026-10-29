const FIELDS = new Set(['sourceMs', 'nativeRequestMs', 'engineReadyMs', 'acceptedMs', 'firstPlaybackMs']);
const STAGES = new Set(['opened', 'buffered', 'firstPicture', 'decoderReady']);

class StartupMetrics {
  constructor({ now = () => performance.now(), save = () => {} } = {}) {
    this.now = now; this.save = save; this.rows = [];
  }
  begin(id) {
    this.end('replaced');
    this.active = { id, started: this.now(), row: { at: new Date().toISOString(), status: 'opening', native: {} } };
    this.rows.push(this.active.row); this.rows = this.rows.slice(-20);
  }
  mark(id, field) {
    if (id !== this.active?.id || !FIELDS.has(field) || this.active.row[field] != null) return;
    this.active.row[field] = Math.max(0, Math.round(this.now() - this.active.started)); this.persist();
  }
  bind(id, generation) {
    if (id === this.active?.id) this.active.generation = generation;
  }
  native(value) {
    if (!this.active || this.active.generation !== value?.generation || !STAGES.has(value.stage)
      || !Number.isFinite(value.ms) || value.ms < 0 || value.ms > 300_000) return;
    if (this.active.row.native[value.stage] == null) { this.active.row.native[value.stage] = Math.round(value.ms); this.persist(); }
  }
  state(value) {
    if (!this.active || this.active.generation !== value?.generation) return;
    if (value.state === 7) return this.end('failed');
    if (this.active.row.firstPlaybackMs == null && (value.decodedVideo > 0 || value.playedAudio > 0) && value.time > 0) {
      this.active.row.status = 'playing'; this.mark(this.active.id, 'firstPlaybackMs');
    }
  }
  end(status = 'closed') {
    if (!this.active) return;
    if (this.active.row.status === 'opening') this.active.row.status = status;
    this.persist(); this.active = null;
  }
  persist() {
    // Records contain only timings and a timestamp, no title, ID, URL or token.
    try { this.save(JSON.stringify(this.rows)); } catch { }
  }
}
module.exports = { StartupMetrics };
