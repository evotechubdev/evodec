(() => {
  const video = document.querySelector('#screen-video');
  const title = document.querySelector('#screen-title');
  const status = document.querySelector('#screen-status');
  let player = null;
  let started = false;
  let readyRepeater = 0;

  const send = (type, message = '') => {
    if (window.opener && !window.opener.closed) {
      window.opener.postMessage({ type, message }, location.origin);
    }
  };

  const showError = (message) => {
    status.textContent = message;
    send('EVOTV_LIVE_SCREEN_ERROR', message);
  };

  const announceStarted = () => {
    if (started) return;
    started = true;
    status.textContent = '';
    send('EVOTV_LIVE_SCREEN_STARTED');
  };

  const startPlayback = (playbackUrl, channelTitle) => {
    let url;
    try { url = new URL(String(playbackUrl)); }
    catch { showError('Endereço de reprodução inválido.'); return; }
    if (url.protocol !== 'https:' || !url.pathname.startsWith('/open-stream/') || url.search || url.hash) {
      showError('Endereço de reprodução não autorizado.');
      return;
    }

    title.textContent = String(channelTitle || 'Canal ao vivo');
    document.title = `${title.textContent} • EVOTV`;
    video.addEventListener('playing', announceStarted);

    const mpegts = window.mpegts;
    if (mpegts?.getFeatureList?.().mseLivePlayback) {
      player = mpegts.createPlayer({
        type: 'mpegts', isLive: true, cors: true, withCredentials: false, url: url.href,
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
      player.on(mpegts.Events.ERROR, (type, detail) => {
        showError(`Falha ao reproduzir o canal (${String(type || 'erro')}${detail ? `: ${String(detail)}` : ''}).`);
      });
      player.attachMediaElement(video);
      player.load();
      void video.play().catch(() => { status.textContent = 'Clique no vídeo para iniciar.'; });
      return;
    }

    video.src = url.href;
    video.load();
    void video.play().catch(() => { status.textContent = 'Clique no vídeo para iniciar.'; });
  };

  video.addEventListener('click', () => {
    if (video.paused) void video.play().catch(() => {});
  });
  video.addEventListener('error', () => showError('Não foi possível reproduzir este canal.'));

  window.addEventListener('message', (event) => {
    if (event.source !== window.opener || event.origin !== location.origin
      || event.data?.type !== 'EVOTV_LIVE_SCREEN_START') return;
    window.clearInterval(readyRepeater);
    startPlayback(event.data.playbackUrl, event.data.title);
  });

  window.addEventListener('pagehide', () => {
    try {
      if (player) {
        player.pause();
        player.unload();
        player.detachMediaElement();
        player.destroy();
        player = null;
      }
    } catch { /* janela encerrada */ }
    video.pause();
    video.removeAttribute('src');
    video.load();
  });

  send('EVOTV_LIVE_SCREEN_READY');
  readyRepeater = window.setInterval(() => send('EVOTV_LIVE_SCREEN_READY'), 300);
})();
