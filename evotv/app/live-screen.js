(() => {
  const video = document.querySelector('#screen-video');
  const title = document.querySelector('#screen-title');
  const status = document.querySelector('#screen-status');
  const topbar = document.querySelector('#screen-topbar');
  const closeButton = document.querySelector('#screen-close');
  const volumeButton = document.querySelector('#screen-volume-button');
  const volumeSlider = document.querySelector('#screen-volume');
  const sizeButton = document.querySelector('#screen-size-button');
  let player = null;
  let started = false;
  let readyRepeater = 0;
  let restoreBounds = null;
  let drag = null;

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

  const syncVolume = () => {
    const isMuted = video.muted || video.volume === 0;
    volumeButton.setAttribute('aria-pressed', String(isMuted));
    volumeButton.setAttribute('aria-label', isMuted ? 'Ativar volume' : 'Silenciar');
    volumeSlider.value = String(isMuted ? 0 : video.volume);
  };

  const startPlayback = (playbackUrl, channelTitle, initialVolume, initiallyMuted, mediaKind) => {
    let url;
    try { url = new URL(String(playbackUrl)); }
    catch { showError('Endereço de reprodução inválido.'); return; }
    if (url.protocol !== 'https:' || !url.pathname.startsWith('/open-stream/') || url.search || url.hash) {
      showError('Endereço de reprodução não autorizado.');
      return;
    }

    title.textContent = String(channelTitle || 'Canal ao vivo');
    document.title = `${title.textContent} • EVOTV`;
    video.volume = Number.isFinite(Number(initialVolume)) ? Math.max(0, Math.min(1, Number(initialVolume))) : 1;
    video.muted = Boolean(initiallyMuted);
    syncVolume();
    status.textContent = 'A carregar…';
    video.addEventListener('playing', announceStarted);

    const mpegts = window.mpegts;
    const transportStream = /\.(?:ts|mpegts)$/i.test(url.pathname);
    if ((mediaKind === 'live' || transportStream) && mpegts?.getFeatureList?.().mseLivePlayback) {
      player = mpegts.createPlayer({
        type: 'mpegts', isLive: mediaKind === 'live', cors: true, withCredentials: false, url: url.href,
      }, {
        enableWorker: false,
        enableStashBuffer: true,
        stashInitialSize: 384 * 1024,
        isLive: mediaKind === 'live',
        lazyLoad: false,
        liveBufferLatencyChasing: false,
        liveSync: false,
        autoCleanupSourceBuffer: true,
        autoCleanupMaxBackwardDuration: 120,
        autoCleanupMinBackwardDuration: 60,
      });
      player.on(mpegts.Events.ERROR, (type, detail) => {
        showError(`Falha ao reproduzir (${String(type || 'erro')}${detail ? `: ${String(detail)}` : ''}).`);
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

  volumeButton.addEventListener('click', () => {
    if (video.muted || video.volume === 0) {
      video.muted = false;
      if (video.volume === 0) video.volume = 0.6;
    } else {
      video.muted = true;
    }
    syncVolume();
  });
  volumeSlider.addEventListener('input', () => {
    video.volume = Number(volumeSlider.value);
    video.muted = video.volume === 0;
    syncVolume();
  });
  video.addEventListener('volumechange', syncVolume);
  video.addEventListener('click', () => {
    if (video.paused) void video.play().catch(() => {});
  });
  video.addEventListener('error', () => showError('Não foi possível reproduzir este conteúdo.'));
  closeButton.addEventListener('click', () => window.close());

  sizeButton.addEventListener('click', () => {
    try {
      if (!restoreBounds) {
        restoreBounds = { left: window.screenX, top: window.screenY, width: window.outerWidth, height: window.outerHeight };
        const display = window.screen;
        window.moveTo(display.availLeft || 0, display.availTop || 0);
        window.resizeTo(display.availWidth, display.availHeight);
        sizeButton.setAttribute('aria-pressed', 'true');
        sizeButton.setAttribute('aria-label', 'Restaurar tamanho do ecrã');
        sizeButton.title = 'Restaurar tamanho';
      } else {
        const bounds = restoreBounds;
        restoreBounds = null;
        window.moveTo(bounds.left, bounds.top);
        window.resizeTo(bounds.width, bounds.height);
        sizeButton.setAttribute('aria-pressed', 'false');
        sizeButton.setAttribute('aria-label', 'Maximizar ecrã');
        sizeButton.title = 'Maximizar ecrã';
      }
    } catch {
      status.textContent = 'O navegador não permitiu alterar o tamanho da janela.';
    }
  });

  topbar.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || event.target.closest('button')) return;
    drag = { pointerId: event.pointerId, x: event.screenX, y: event.screenY, left: window.screenX, top: window.screenY };
    topbar.setPointerCapture(event.pointerId);
    event.preventDefault();
  });
  topbar.addEventListener('pointermove', (event) => {
    if (drag?.pointerId !== event.pointerId) return;
    try { window.moveTo(drag.left + event.screenX - drag.x, drag.top + event.screenY - drag.y); }
    catch { /* alguns navegadores bloqueiam mover janelas */ }
  });
  const finishDrag = (event) => {
    if (drag?.pointerId !== event.pointerId) return;
    drag = null;
    if (topbar.hasPointerCapture(event.pointerId)) topbar.releasePointerCapture(event.pointerId);
  };
  topbar.addEventListener('pointerup', finishDrag);
  topbar.addEventListener('pointercancel', finishDrag);

  window.addEventListener('message', (event) => {
    if (event.source !== window.opener || event.origin !== location.origin
      || event.data?.type !== 'EVOTV_LIVE_SCREEN_START') return;
    window.clearInterval(readyRepeater);
    startPlayback(event.data.playbackUrl, event.data.title, event.data.volume, event.data.muted, event.data.mediaKind);
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
