const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');

async function saveDownload({ url, filePath, signal, onProgress = () => {}, fetchImpl = fetch }) {
  if (!path.isAbsolute(filePath)) throw new Error('Escolha um destino válido.');
  const temporary = `${filePath}.evo-${crypto.randomBytes(8).toString('hex')}.part`;
  let written = false;
  try {
    const response = await fetchImpl(url, { signal });
    if (!response.ok || !response.body || /^(text\/|application\/(json|xml))/i.test(response.headers.get('content-type') || '')) {
      await response.body?.cancel(); throw new Error('Não foi possível iniciar o download desta mídia.');
    }
    const total = Number(response.headers.get('content-length')) || null;
    let bytes = 0, last = 0;
    const progress = new Transform({ transform(chunk, _encoding, callback) {
      bytes += chunk.length;
      if (Date.now() - last > 300) { last = Date.now(); onProgress({ status: 'downloading', bytes, total }); }
      callback(null, chunk);
    } });
    const output = fs.createWriteStream(temporary, { flags: 'wx' });
    output.once('open', () => { written = true; });
    await pipeline(Readable.fromWeb(response.body), progress, output, { signal });
    if (signal.aborted) throw new Error('Download cancelado.');
    await fs.promises.rename(temporary, filePath);
    written = false;
    onProgress({ status: 'completed', bytes, total });
    return { completed: true };
  } finally {
    if (written) await fs.promises.unlink(temporary).catch(() => {});
  }
}
module.exports = { saveDownload };
