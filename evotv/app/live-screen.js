const MEDIA_PROXY_ORIGIN = 'https://evotv-offline-media-proxy.evotechubdev.workers.dev';
const video = document.querySelector('#screen-video');
const title = document.querySelector('#channel-title');
const status = document.querySelector('#screen-status');

document.querySelector('#close-screen').addEventListener('click', () => window.close());

function postToOpener(type, message = '') {
  if (window.opener && !window.opener.closed) {
    window.opener.postMessage({ type, message }, location.origin);
  }
}

function validPlaybackUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:' && url.origin === MEDIA_PROXY_ORIGIN
      && url.pathname.startsWith('/open-stream/') && !url.search && !url.hash;
  } catch { return false; }
}

async function startPlayback(playbackUrl) {
  const mpegts = window.mpegts;
  if (!mpegts?.getFeatureList?.().mseLivePlayback) throw new Error('Este navegador não oferece suporte a este canal.');
  const player = mpegts.createPlayer({
    type: 'mpegts', isLive: true, cors: true, withCredentials: false, url: playbackUrl,
  }, {
    enableWorker: false,
    enableStashBuffer: true,
    stashInitialSize: 384 * 1024,
    isLive: true,
    lazyLoad: false,
    liveBufferLatencyChasing: false,
    liveSync: false,
    autoCleanupSourceBuffer: true,
    autoCleanupMaxBackwardDuration: 120,
    autoCleanupMinBackwardDuration: 60,
  });
  let startRequested = false;
  const play = async () => {
    if (startRequested) return;
    startRequested = true;
    video.muted = true;
    try {
      await video.play();
    } catch {
      video.muted = false;
      video.classList.remove('live-controls-no-seek');
      status.textContent = 'O navegador bloqueou a reprodução automática. Use os controles do vídeo para iniciar.';
    }
  };
  video.addEventListener('playing', () => {
    video.muted = false;
    status.textContent = '';
    postToOpener('EVOTV_LIVE_SCREEN_STARTED');
  });
  player.on(mpegts.Events.MEDIA_INFO, () => { void play(); });
  player.on(mpegts.Events.ERROR, (type, detail) => {
    status.textContent = `Não foi possível reproduzir o canal (${String(type || 'erro')}${detail ? `: ${String(detail)}` : ''}).`;
  });
  player.attachMediaElement(video);
  player.load();
  void play();
  window.addEventListener('beforeunload', () => {
    try { player.pause(); player.unload(); player.detachMediaElement(); player.destroy(); } catch { /* player já encerrado */ }
  }, { once: true });
}

window.addEventListener('message', (event) => {
  if (event.origin !== location.origin || event.source !== window.opener
    || event.data?.type !== 'EVOTV_LIVE_SCREEN_PLAY') return;
  const { playbackUrl, channelName } = event.data;
  if (!validPlaybackUrl(playbackUrl)) {
    status.textContent = 'O endereço de reprodução recebido não é válido.';
    postToOpener('EVOTV_LIVE_SCREEN_ERROR', status.textContent);
    return;
  }
  title.textContent = String(channelName || 'Canal ao vivo');
  document.title = `${title.textContent} · EVOTV`;
  void startPlayback(playbackUrl).catch(error => {
    status.textContent = String(error?.message || 'Não foi possível iniciar o canal.');
    postToOpener('EVOTV_LIVE_SCREEN_ERROR', status.textContent);
  });
});

if (window.opener) window.opener.postMessage({ type: 'EVOTV_LIVE_SCREEN_READY' }, location.origin);
else status.textContent = 'Abra esta janela pelo botão Ecrã de um canal no EVOTV.';
