import type { ISOFile, MP4BoxBuffer, Movie, Track } from 'mp4box';

interface DirectHttpMp4Handlers {
  onError(message: string): void;
}

interface TrackBuffer {
  id: number;
  source: SourceBuffer;
  queue: ArrayBuffer[];
  queuedBytes: number;
}

const MAX_BUFFER_AHEAD_SECONDS = 120;
const KEEP_BUFFER_BEHIND_SECONDS = 60;
const MAX_QUEUED_BYTES = 32 * 1024 * 1024;

/**
 * Fetches an HTTP MP4 from the page context that received Chrome's insecure
 * content permission, fragments it progressively and feeds it to MSE. The
 * source address is never copied to a service worker or written to a log.
 */
export function attachDirectHttpMp4(
  video: HTMLVideoElement,
  source: string,
  handlers: DirectHttpMp4Handlers,
): () => void {
  const controller = new AbortController();
  const mediaSource = new MediaSource();
  const objectUrl = URL.createObjectURL(mediaSource);
  const tracks: TrackBuffer[] = [];
  let mp4File: ISOFile<TrackBuffer, unknown> | null = null;
  let disposed = false;
  let downloadComplete = false;
  let failed = false;

  const fail = (message: string) => {
    if (disposed || failed) return;
    failed = true;
    controller.abort();
    handlers.onError(message);
    if (mediaSource.readyState === 'open') {
      try { mediaSource.endOfStream('network'); } catch { /* player is already closing */ }
    }
  };

  const maybeFinish = () => {
    if (!downloadComplete || failed || disposed || mediaSource.readyState !== 'open') return;
    if (tracks.some((track) => track.source.updating || track.queue.length > 0)) return;
    try { mediaSource.endOfStream(); } catch { /* a simultaneous close won the race */ }
  };

  const appendNext = (track: TrackBuffer) => {
    if (disposed || failed || track.source.updating) return;
    const trimBefore = video.currentTime - KEEP_BUFFER_BEHIND_SECONDS;
    if (trimBefore > 0 && track.source.buffered.length > 0) {
      const start = track.source.buffered.start(0);
      const end = track.source.buffered.end(0);
      if (start + 1 < trimBefore && start < end) {
        try {
          track.source.remove(start, Math.min(trimBefore, end - 0.1));
          return;
        } catch { /* append below; quota handling will report a useful error */ }
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
        fail('O navegador ficou sem espaço de buffer para este filme. Feche o player e tente novamente.');
      } else {
        fail('O navegador recusou um trecho do arquivo de vídeo.');
      }
    }
  };

  const enqueue = (track: TrackBuffer, buffer: ArrayBuffer) => {
    track.queue.push(buffer);
    track.queuedBytes += buffer.byteLength;
    appendNext(track);
  };

  const configureTracks = (info: Movie) => {
    const selected = [info.videoTracks[0], info.audioTracks[0]].filter(
      (track): track is Track => Boolean(track),
    );
    if (!selected.some((track) => Boolean(track.video))) {
      throw new Error('video_track_missing');
    }

    for (const track of selected) {
      const mediaType = track.video ? 'video' : 'audio';
      const mime = `${mediaType}/mp4; codecs="${track.codec}"`;
      if (!MediaSource.isTypeSupported(mime)) throw new Error('unsupported_codec');
      const target: TrackBuffer = {
        id: track.id,
        source: mediaSource.addSourceBuffer(mime),
        queue: [],
        queuedBytes: 0,
      };
      target.source.addEventListener('updateend', () => appendNext(target));
      target.source.addEventListener('error', () => fail('O navegador não conseguiu decodificar este filme.'));
      tracks.push(target);

      const durationSeconds = track.timescale > 0 ? track.duration / track.timescale : 0;
      const samplesPerSecond = durationSeconds > 0 ? track.nb_samples / durationSeconds : 30;
      const samplesPerSegment = Math.max(24, Math.min(400, Math.round(samplesPerSecond * 3)));
      mp4File?.setSegmentOptions(track.id, target, {
        nbSamples: samplesPerSegment,
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
      await new Promise<void>((resolve) => window.setTimeout(resolve, 150));
    }
  };

  const open = async () => {
    if (!('MediaSource' in window)) throw new Error('mse_unavailable');
    video.src = objectUrl;
    await new Promise<void>((resolve, reject) => {
      const aborted = () => reject(new DOMException('Aborted', 'AbortError'));
      mediaSource.addEventListener('sourceopen', () => resolve(), { once: true });
      controller.signal.addEventListener('abort', aborted, { once: true });
    });
    if (disposed) return;

    const { createFile } = await import('mp4box');
    if (disposed) return;
    mp4File = createFile() as ISOFile<TrackBuffer, unknown>;
    mp4File.onError = () => fail('O arquivo MP4 recebido está danificado ou não é compatível.');
    mp4File.onReady = (info) => {
      if (disposed || failed) return;
      try { configureTracks(info); }
      catch (reason) {
        fail(reason instanceof Error && reason.message === 'unsupported_codec'
          ? 'O codec deste filme não é suportado pelo Chrome.'
          : 'O arquivo recebido não possui uma faixa de vídeo compatível.');
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
      const buffer = value.buffer.slice(
        value.byteOffset,
        value.byteOffset + value.byteLength,
      ) as MP4BoxBuffer;
      buffer.fileStart = offset;
      offset += value.byteLength;
      mp4File.appendBuffer(buffer);
    }
    if (disposed || failed) return;
    mp4File.flush();
    downloadComplete = true;
    maybeFinish();
  };

  void open().catch((reason: unknown) => {
    if (disposed || (reason instanceof DOMException && reason.name === 'AbortError')) return;
    const status = reason instanceof Error && /^http_\d+$/.test(reason.message)
      ? reason.message.slice(5)
      : '';
    fail(status
      ? `O servidor do filme respondeu com erro ${status}.`
      : 'O Chrome bloqueou a conexão HTTP do filme. Confirme que Conteúdo inseguro está como Permitir para este site.');
  });

  return () => {
    disposed = true;
    controller.abort();
    mp4File?.stop();
    for (const track of tracks) track.queue.length = 0;
    URL.revokeObjectURL(objectUrl);
  };
}
