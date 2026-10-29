(() => {
  const surface = $('#video-surface'), frame = $('#player-frame'), toolbar = $('.native-controls'), header = $('.player-meta');
  const pause = $('#native-play-pause'), seek = $('#native-seek'), volume = $('#native-volume'), mute = $('#native-mute');
  const live = $('#native-live'), timeline = $('#native-timeline');
  let current = { time: 0, duration: 0, state: 0, volume: 100, muted: false }, opened = false, seeking = false;
  let popupRect = null, hideTimer, lastPointer = null, keyboard = false, dragging = false, clipKey = '', trackKey = '', lastVolume = 100;
  const bounds = () => { const rect = surface.getBoundingClientRect(); return { left: rect.left, top: rect.top, width: rect.width, height: rect.height, viewportWidth: window.innerWidth, viewportHeight: window.innerHeight }; };
  const command = (name, value) => window.tv.nativeCommand(name, value).catch(() => {});
  const time = value => { const seconds = Math.max(0, Math.floor(value || 0)), minutes = Math.floor(seconds / 60); return minutes >= 60 ? `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}` : `${minutes}:${String(seconds % 60).padStart(2, '0')}`; };
  const contains = (rect, point) => point?.inside && point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom;
  function syncClip() {
    if (!opened) return;
    const rects = frame.classList.contains('controls-visible') ? [header, toolbar].map(element => element.getBoundingClientRect().toJSON()) : [];
    if (popupRect) rects.push(popupRect);
    const key = JSON.stringify(rects);
    if (key !== clipKey) { clipKey = key; command('clip', rects); }
  }
  function keepVisible() {
    return popupRect || seeking || dragging || (keyboard && [header, toolbar].some(element => element.contains(document.activeElement)))
      || (frame.classList.contains('controls-visible') && [header, toolbar].some(element => contains(element.getBoundingClientRect(), lastPointer)));
  }
  function visibility(visible) {
    clearTimeout(hideTimer);
    frame.classList.toggle('controls-visible', visible);
    syncClip();
    if (visible && !keepVisible()) hideTimer = setTimeout(() => visibility(false), 2400);
  }
  function pointer(point) {
    if (!opened) return;
    if (lastPointer && point.x === lastPointer.x && point.y === lastPointer.y && point.inside === lastPointer.inside && point.interaction === lastPointer.interaction) return;
    if (lastPointer) keyboard = false;
    lastPointer = point;
    if (contains(frame.getBoundingClientRect(), point)) visibility(true);
    else if (!keepVisible()) visibility(false);
  }
  function refreshTracks() {
    const key = JSON.stringify([opened, current.audioOptions, current.subtitleOptions, current.audioTrack, current.subtitleTrack]);
    if (key !== trackKey) { trackKey = key; window.downloadOptions?.refresh(); }
  }
  function draw() {
    const paused = current.state === 4 || current.state === 6;
    const livePlayback = state.playback?.kind === 'live';
    if (livePlayback && current.state === 4) state.playback.atLiveEdge = false;
    pause.textContent = paused ? '▶' : '❚❚'; pause.setAttribute('aria-label', paused ? 'Reproduzir' : 'Pausar');
    live.classList.toggle('hidden', !livePlayback); timeline.classList.toggle('hidden', livePlayback);
    const atLiveEdge = livePlayback && state.playback?.atLiveEdge === true && current.state === 3;
    live.classList.toggle('is-live', atLiveEdge); live.setAttribute('aria-pressed', String(atLiveEdge));
    $('#native-time').textContent = time(current.time); $('#native-duration').textContent = current.duration ? time(current.duration) : 'AO VIVO';
    seek.disabled = !current.seekable || !current.duration;
    if (!seeking) seek.value = current.duration ? Math.min(1000, current.time / current.duration * 1000) : 0;
    if (current.volume >= 0 && document.activeElement !== volume) volume.value = current.volume;
    if (Number(volume.value) > 0) lastVolume = Number(volume.value);
    const silent = current.muted || Number(volume.value) === 0;
    mute.querySelector('.volume-icon').textContent = silent ? '\uE74F' : Number(volume.value) <= 33 ? '\uE993' : Number(volume.value) <= 66 ? '\uE994' : '\uE995';
    mute.setAttribute('aria-label', silent ? 'Ativar som' : 'Silenciar'); mute.setAttribute('aria-pressed', String(silent));
  }
  window.tv.onNativeState(update => {
    if (!opened || update.generation !== state.playback?.id) return;
    current = update; draw(); refreshTracks();
    trackPlaybackProgress(update);
    if (update.pointer) pointer(update.pointer);
    const recovering = state.playback?.liveQuality?.observe(update) === true;
    if (update.state === 7 && !recovering) { $('#status-line').textContent = 'Não foi possível reproduzir esta mídia da lista.'; closePlayer(); }
  });
  function togglePause() {
    if (!opened) return;
    if (current.state === 6 && state.playback?.url) play(state.playback.url).catch(() => {});
    else {
      if (state.playback?.kind === 'live' && current.state !== 4) state.playback.atLiveEdge = false;
      command('pause', current.state === 4 ? 0 : 1);
    }
  }
  pause.addEventListener('click', togglePause);
  live.addEventListener('click', async () => {
    if (!opened || state.playback?.kind !== 'live' || live.disabled) return;
    if (state.playback.atLiveEdge && current.state === 3) return;
    live.disabled = true; state.playback.atLiveEdge = true; draw(); visibility(true);
    await restartLiveAtEdge(); live.disabled = false; draw(); visibility(true);
  });
  surface.addEventListener('click', () => { visibility(true); togglePause(); });
  seek.addEventListener('pointerdown', () => { seeking = true; visibility(true); });
  seek.addEventListener('input', () => { $('#native-time').textContent = time(Number(seek.value) / 1000 * current.duration); });
  seek.addEventListener('change', () => { seeking = false; command('seek', Number(seek.value) / 1000 * current.duration); visibility(true); });
  seek.addEventListener('pointerup', () => { seeking = false; visibility(true); });
  seek.addEventListener('pointercancel', () => { seeking = false; visibility(true); });
  for (const control of [seek, volume]) {
    control.addEventListener('pointerdown', () => { dragging = true; visibility(true); });
    for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) control.addEventListener(event, () => { dragging = false; visibility(true); });
  }
  volume.addEventListener('input', () => {
    current.volume = Number(volume.value); command('volume', current.volume);
    if (current.muted && current.volume > 0) { current.muted = false; command('mute', 0); }
    draw(); visibility(true);
  });
  mute.addEventListener('click', () => {
    const silent = current.muted || Number(volume.value) === 0;
    if (silent && Number(volume.value) === 0) { current.volume = lastVolume; volume.value = lastVolume; command('volume', lastVolume); }
    current.muted = !silent; command('mute', current.muted ? 1 : 0); draw();
  });
  $('#native-fullscreen').addEventListener('click', () => { const operation = document.fullscreenElement ? document.exitFullscreen() : frame.requestFullscreen(); operation.catch(() => {}); });
  frame.addEventListener('pointermove', event => { keyboard = false; pointer({ x: event.clientX, y: event.clientY, inside: true, interaction: lastPointer?.interaction }); });
  frame.addEventListener('focusin', () => { keyboard = true; visibility(true); });
  frame.addEventListener('focusout', () => { keyboard = false; if (opened && frame.classList.contains('controls-visible')) visibility(true); });
  frame.addEventListener('keydown', event => {
    keyboard = true; visibility(true);
    if ((event.key === ' ' || event.key === 'k') && !event.target.closest('button, input, [role="menu"]')) { event.preventDefault(); togglePause(); }
  });
  const resize = () => { if (opened) { command('resize', bounds()); clipKey = ''; syncClip(); } };
  new ResizeObserver(resize).observe(surface);
  window.addEventListener('resize', resize); document.addEventListener('fullscreenchange', resize);
  async function play(url, options = {}) {
    opened = true; lastPointer = null; popupRect = null; seeking = false; dragging = false; keyboard = false; clipKey = '';
    current = { ...current, state: 1, time: options.position || 0, duration: 0, seekable: false, audioOptions: [], subtitleOptions: [], audioTrack: -1, subtitleTrack: -1 };
    visibility(false); draw(); refreshTracks();
    await window.tv.nativePlay(url, bounds(), { ...options, generation: state.playback.id });
    clipKey = ''; syncClip();
  }
  window.nativePlayer = {
    play,
    stop({ notifyEngine = true } = {}) {
      const wasOpened = opened;
      opened = false; clearTimeout(hideTimer); popupRect = null; current.audioOptions = []; current.subtitleOptions = []; refreshTracks();
      if (notifyEngine && wasOpened) command('stop');
    },
    position: () => current.time || 0,
    paused: () => current.state === 4,
    tracks: () => ({ audio: opened ? current.audioOptions || [] : [], subtitles: opened ? current.subtitleOptions || [] : [], audioTrack: current.audioTrack, subtitleTrack: current.subtitleTrack }),
    selectTrack(type, id) {
      if (!opened || !state.playback || !['audio', 'subtitle'].includes(type)) return Promise.reject(new Error('A reprodução foi encerrada.'));
      return window.tv.nativeCommand(type === 'audio' ? 'audio-track' : 'subtitle-track', { id, generation: state.playback.id });
    },
    clip(rect) { popupRect = rect; if (rect) visibility(true); else if (opened) visibility(frame.classList.contains('controls-visible')); },
  };
})();
