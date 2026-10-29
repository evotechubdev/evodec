const MAX_BUFFER_AHEAD_SECONDS = 120;
const KEEP_BUFFER_BEHIND_SECONDS = 60;
const MAX_QUEUED_BYTES = 32 * 1024 * 1024;
const SAMPLES_PER_SEGMENT = 120;

// Le o MP4 HTTP progressivamente e entrega somente uma URL blob: ao video.
export function attachDirectHttpMp4(video, source, handlers) {
  const controller = new AbortController();
  const mediaSource = new MediaSource();
  const objectUrl = URL.createObjectURL(mediaSource);
  const tracks = [];
  let mp4File = null;
  let disposed = false;
  let downloadComplete = false;
  let failed = false;

  const fail = (message) => {
    if (disposed || failed) return;
    failed = true;
    controller.abort();
    handlers.onError(message);
    if (mediaSource.readyState === 'open') {
      try { mediaSource.endOfStream('network'); } catch { /* player encerrando */ }
    }
  };

  const maybeFinish = () => {
    if (!downloadComplete || failed || disposed || mediaSource.readyState !== 'open') return;
    if (tracks.some((track) => track.source.updating || track.queue.length > 0)) return;
    try { mediaSource.endOfStream(); } catch { /* fechamento simultaneo */ }
  };

  const appendNext = (track) => {
    if (disposed || failed || track.source.updating) return;
    const trimBefore = video.currentTime - KEEP_BUFFER_BEHIND_SECONDS;
    if (trimBefore > 0 && track.source.buffered.length > 0) {
      const start = track.source.buffered.start(0);
      const end = track.source.buffered.end(0);
      if (start + 1 < trimBefore && start < end) {
        try {
          track.source.remove(start, Math.min(trimBefore, end - 0.1));
          return;
        } catch { /* tenta anexar abaixo */ }
      }
    }
    const buffer = track.queue.shift();
    if (!buffer) {
      maybeFinish();
      return;
    }
    track.queuedBytes -= buffer.byteLength;
    try {
      track.source.appendBuffer(buffer);
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === 'QuotaExceededError') {
        track.queue.unshift(buffer);
        track.queuedBytes += buffer.byteLength;
        fail('O navegador ficou sem espaco de buffer para este filme. Feche o player e tente novamente.');
      } else {
        fail('O navegador recusou um trecho do arquivo de video.');
      }
    }
  };

  const enqueue = (track, buffer) => {
    track.queue.push(buffer);
    track.queuedBytes += buffer.byteLength;
    appendNext(track);
  };

  const configureTracks = (info) => {
    const selected = [info.videoTracks[0], info.audioTracks[0]].filter(Boolean);
    if (!selected.some((track) => Boolean(track.video))) throw new Error('video_track_missing');

    for (const track of selected) {
      const mediaType = track.video ? 'video' : 'audio';
      const mime = `${mediaType}/mp4; codecs="${track.codec}"`;
      if (!MediaSource.isTypeSupported(mime)) throw new Error('unsupported_codec');
      const target = {
        id: track.id,
        source: mediaSource.addSourceBuffer(mime),
        queue: [],
        queuedBytes: 0,
      };
      target.source.addEventListener('updateend', () => appendNext(target));
      target.source.addEventListener('error', () => fail('O navegador nao conseguiu decodificar este filme.'));
      tracks.push(target);
      mp4File?.setSegmentOptions(track.id, target, {
        nbSamples: SAMPLES_PER_SEGMENT,
        rapAlignement: true,
      });
    }

    const initialization = mp4File?.initializeSegmentation('per-track') || [];
    for (const segment of initialization) enqueue(segment.user, segment.buffer);
    mp4File?.start();
  };

  const bufferedAhead = () => {
    let end = 0;
    for (let index = 0; index < video.buffered.length; index += 1) {
      if (video.currentTime >= video.buffered.start(index) - 0.25
        && video.currentTime <= video.buffered.end(index) + 0.25) {
        end = Math.max(end, video.buffered.end(index));
      }
    }
    return Math.max(0, end - video.currentTime);
  };

  const waitForBufferRoom = async () => {
    while (!disposed && !failed) {
      const queuedBytes = tracks.reduce((total, track) => total + track.queuedBytes, 0);
      if (queuedBytes < MAX_QUEUED_BYTES && bufferedAhead() < MAX_BUFFER_AHEAD_SECONDS) return;
      await new Promise((resolve) => window.setTimeout(resolve, 150));
    }
  };

  const open = async () => {
    if (!('MediaSource' in window)) throw new Error('mse_unavailable');
    video.src = objectUrl;
    await new Promise((resolve, reject) => {
      const aborted = () => reject(new DOMException('Aborted', 'AbortError'));
      mediaSource.addEventListener('sourceopen', resolve, { once: true });
      controller.signal.addEventListener('abort', aborted, { once: true });
    });
    if (disposed) return;

    const { createFile } = await import('./vendor/mp4box.all.mjs');
    if (disposed) return;
    mp4File = createFile();
    mp4File.onError = () => fail('O arquivo MP4 recebido esta danificado ou nao e compativel.');
    mp4File.onReady = (info) => {
      if (disposed || failed) return;
      try { configureTracks(info); }
      catch (reason) {
        fail(reason instanceof Error && reason.message === 'unsupported_codec'
          ? 'O codec deste filme nao e suportado pelo navegador.'
          : 'O arquivo recebido nao possui uma faixa de video compativel.');
      }
    };
    mp4File.onSegment = (id, target, buffer, nextSample) => {
      if (disposed || failed) return;
      enqueue(target, buffer);
      mp4File?.releaseUsedSamples(id, nextSample);
    };

    const response = await fetch(source, {
      method: 'GET',
      mode: 'cors',
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'follow',
      signal: controller.signal,
    });
    if (!response.ok || !response.body) throw new Error(`http_${response.status}`);

    const reader = response.body.getReader();
    let offset = 0;
    while (!disposed && !failed) {
      await waitForBufferRoom();
      const { done, value } = await reader.read();
      if (done) break;
      const buffer = value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
      buffer.fileStart = offset;
      offset += value.byteLength;
      mp4File.appendBuffer(buffer);
    }
    if (disposed || failed) return;
    mp4File.flush();
    downloadComplete = true;
    maybeFinish();
  };

  void open().catch((reason) => {
    if (disposed || (reason instanceof DOMException && reason.name === 'AbortError')) return;
    const status = reason instanceof Error && /^http_\d+$/.test(reason.message)
      ? reason.message.slice(5)
      : '';
    fail(status
      ? `O servidor do filme respondeu com erro ${status}.`
      : 'O navegador bloqueou a conexao HTTP. No Chrome do Windows, permita Conteudo inseguro para este site.');
  });

  return () => {
    disposed = true;
    controller.abort();
    mp4File?.stop();
    for (const track of tracks) track.queue.length = 0;
    video.pause();
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(objectUrl);
  };
}
