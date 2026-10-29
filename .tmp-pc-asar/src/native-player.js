const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');

class NativePlayer {
  constructor({ windowHandle, onState = () => {}, onTiming = () => {}, onLog = () => {}, spawnImpl = spawn, runtimeDir } = {}) {
    this.handle = windowHandle;
    this.onState = onState;
    this.onTiming = onTiming;
    this.onLog = onLog;
    this.spawnImpl = spawnImpl;
    this.runtime = runtimeDir || (process.resourcesPath ? path.join(process.resourcesPath, 'native-player') : '');
    if (!fs.existsSync(path.join(this.runtime, 'EvoNativePlayer.exe'))) this.runtime = path.resolve(__dirname, '../vendor/native-player');
    this.pending = new Map(); this.sequence = 0; this.closed = false;
  }
  ready() {
    if (this.starting) return this.starting;
    this.starting = new Promise((resolve, reject) => {
      let buffer = '', ready = false;
      const executable = path.join(this.runtime, 'EvoNativePlayer.exe');
      const handle = Buffer.isBuffer(this.handle) ? (this.handle.length >= 8 ? this.handle.readBigUInt64LE() : BigInt(this.handle.readUInt32LE())).toString(16) : String(this.handle);
      this.child = this.spawnImpl(executable, [handle], { cwd: this.runtime, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      const timer = setTimeout(() => { reject(new Error('Não foi possível iniciar o player nativo. Atualize o aplicativo.')); this.child?.kill(); }, 45000);
      timer.unref?.();
      this.child.stdout.setEncoding('utf8');
      this.child.stdout.on('data', chunk => {
        buffer += chunk;
        if (buffer.length > 128 * 1024) { buffer = ''; return; }
        let end;
        while ((end = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, end).trim(); buffer = buffer.slice(end + 1);
          let value; try { value = JSON.parse(line); } catch { continue; }
          if (value.kind === 'ready') { ready = true; this.engineInfo = value; clearTimeout(timer); resolve(); }
          else if (value.kind === 'ack') {
            const pending = this.pending.get(value.id); if (!pending) continue;
            this.pending.delete(value.id); clearTimeout(pending.timer);
            if (value.ok) pending.resolve(true); else pending.reject(new Error(value.error || 'Não foi possível executar esta operação no player.'));
          } else if (value.kind === 'state') this.onState(value);
          else if (value.kind === 'startup') this.onTiming(value);
        }
      });
      // Provider addresses may appear in native diagnostics: never forward them.
      this.child.stderr.on('data', chunk => this.onLog(chunk));
      this.child.stdin.on('error', () => {});
      const ended = () => {
        clearTimeout(timer);
        if (!ready) reject(new Error('O motor nativo não pôde ser iniciado. Atualize o aplicativo.'));
        for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error('O player foi encerrado.')); }
        this.pending.clear(); this.starting = null; this.child = null;
      };
      this.child.once('error', ended); this.child.once('exit', ended);
    });
    return this.starting;
  }
  async command(command, data = {}) {
    if (this.closed) throw new Error('O player foi encerrado.');
    await this.ready();
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('O player não respondeu.')); }, 8000);
      timer.unref?.(); this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(JSON.stringify({ ...data, id, command }) + '\n');
    });
  }
  play(url, bounds, options = {}) { return this.command('play', { url, bounds, generation: options.generation, position: options.position || 0, paused: options.paused === true }); }
  stop() { return this.child ? this.command('stop') : Promise.resolve(); }
  close() {
    this.closed = true;
    const child = this.child;
    if (!child) return;
    child.stdin.end(JSON.stringify({ command: 'quit', id: ++this.sequence }) + '\n');
    const timer = setTimeout(() => { if (child.exitCode === null) child.kill(); }, 1500); timer.unref?.();
  }
}
module.exports = { NativePlayer };
