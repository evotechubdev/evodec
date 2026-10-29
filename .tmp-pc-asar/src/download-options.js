(() => {
  const panel = $('#download-panel'), playerButton = $('#download-player'), cancel = $('#cancel-download');
  const favoriteButton = $('#favorite-media'), favoriteLabel = $('#favorite-media-label'), favoriteStar = favoriteButton.querySelector('.favorite-menu-star');
  const playerTrigger = $('#player-download-options'), popup = $('#media-actions-menu'), folderButton = $('#show-download-folder');
  const languageButton = $('#select-language'), languageOptions = $('#language-options'), languageStatus = $('#language-status');
  const qualityButton = $('#select-quality'), qualityList = $('#quality-options'), qualitySelection = $('#quality-selection');
  const audioButton = $('#select-audio'), subtitleButton = $('#select-subtitles');
  const audioList = $('#audio-tracks'), subtitleList = $('#subtitle-tracks');
  let busy = false, status = 'idle';
  let menuMedia = null, menuAnchor = null, menuOpen = false;
  let trackListKey = '';
  const tracks = () => window.nativePlayer?.tracks() || { audio: [], subtitles: [] };
  const canChooseLanguage = media => {
    const selection = tracks();
    return Boolean(media && media === state.playback && (selection.audio.length > 1 || selection.subtitles.length));
  };
  const canChooseQuality = media => Boolean(media && media === state.playback && media.kind === 'live' && media.liveQuality?.qualityOptions().length > 2);
  function canDownload(media) {
    return window.resolveAccountType(state.user?.accountType) === 'PREMIUM'
      && (['movie', 'series'].includes(media?.kind) || media?.sourceKind === 'extra')
      && media?.downloadable !== false
      && (media?.sourceKind === 'extra' || String(media.extension || 'mp4').toLowerCase() !== 'm3u8');
  }
  const canFavorite = media => Boolean(window.favoriteContent?.key(media));
  function renderFavorite() {
    const available = canFavorite(menuMedia), active = available && window.favoriteContent.contains(menuMedia);
    favoriteButton.classList.toggle('hidden', !available);
    favoriteButton.setAttribute('aria-pressed', String(active));
    favoriteLabel.textContent = active ? 'Desfavoritar' : 'Favoritar';
    favoriteStar.textContent = active ? '★' : '☆';
  }
  function refresh() {
    playerTrigger.classList.toggle('hidden', !canFavorite(state.playback) && !canDownload(state.playback) && !canChooseLanguage(state.playback) && !canChooseQuality(state.playback));
    playerButton.disabled = busy;
    if (menuOpen) {
      if (!canFavorite(menuMedia) && !canDownload(menuMedia) && !canChooseLanguage(menuMedia) && !canChooseQuality(menuMedia)) closeMenu();
      else {
        playerButton.classList.toggle('hidden', !canDownload(menuMedia));
        renderFavorite();
        renderQualities();
        renderLanguages();
      }
    }
  }
  function renderQualities() {
    const available = canChooseQuality(menuMedia);
    qualityButton.classList.toggle('hidden', !available);
    if (!available) { qualityList.classList.add('hidden'); qualityButton.setAttribute('aria-expanded', 'false'); return; }
    const options = menuMedia.liveQuality.qualityOptions();
    qualitySelection.textContent = options.find(option => option.selected)?.label || 'Automática';
    qualityList.replaceChildren();
    for (const option of options) {
      const button = document.createElement('button');
      button.className = 'media-menu-download'; button.type = 'button'; button.textContent = option.label;
      button.setAttribute('role', 'menuitemradio'); button.setAttribute('aria-checked', String(option.selected));
      button.addEventListener('click', async () => {
        const playback = menuMedia; button.disabled = true;
        try { await playback?.liveQuality?.selectQuality(option.value); }
        catch { if (menuOpen && playback === state.playback) { languageStatus.textContent = 'Não foi possível selecionar esta qualidade.'; languageStatus.classList.remove('hidden'); } }
        finally { button.disabled = false; if (menuOpen && playback === state.playback) renderQualities(); }
      });
      qualityList.append(button);
    }
    positionMenu();
  }
  function positionMenu() {
    if (!menuOpen || !menuAnchor) return;
    const rect = menuAnchor.getBoundingClientRect(), bounds = popup.getBoundingClientRect();
    popup.style.left = `${Math.max(12, Math.min(rect.right - bounds.width, window.innerWidth - bounds.width - 12))}px`;
    popup.style.top = `${Math.max(12, rect.bottom + bounds.height + 8 < window.innerHeight ? rect.bottom + 6 : rect.top - bounds.height - 6)}px`;
    window.nativePlayer?.clip(popup.getBoundingClientRect().toJSON());
  }
  function renderLanguages() {
    const available = canChooseLanguage(menuMedia), selection = tracks();
    const audioAvailable = available && selection.audio.length > 1;
    const subtitleAvailable = available && selection.subtitles.length > 0;
    languageButton.classList.toggle('hidden', !available);
    subtitleButton.classList.toggle('hidden', !subtitleAvailable);
    audioButton.classList.toggle('hidden', !audioAvailable);
    for (const [button, list, enabled] of [[languageButton, languageOptions, available], [subtitleButton, subtitleList, subtitleAvailable], [audioButton, audioList, audioAvailable]]) {
      if (!enabled) { list.classList.add('hidden'); button.setAttribute('aria-expanded', 'false'); }
    }
    const key = available ? JSON.stringify([selection.audio, selection.subtitles]) : '';
    if (key !== trackListKey) {
      trackListKey = key;
      for (const [list, options, type] of [[audioList, selection.audio, 'audio'], [subtitleList, selection.subtitles.length ? [{ id: -1, name: 'Desativar legendas' }, ...selection.subtitles] : [], 'subtitle']]) {
        list.replaceChildren();
        for (const track of options) {
          const button = document.createElement('button');
          button.className = 'media-menu-download'; button.type = 'button'; button.textContent = track.name;
          button.setAttribute('role', 'menuitemradio'); button.dataset.trackId = track.id;
          button.addEventListener('click', async () => {
            const playback = state.playback;
            languageStatus.classList.add('hidden'); button.disabled = true;
            try { await window.nativePlayer.selectTrack(type, track.id); }
            catch {
              if (menuOpen && playback === state.playback) { languageStatus.textContent = 'Não foi possível selecionar esta faixa. Tente novamente.'; languageStatus.classList.remove('hidden'); positionMenu(); }
            } finally { button.disabled = false; }
          });
          list.append(button);
        }
      }
    }
    for (const [list, selected] of [[audioList, selection.audioTrack], [subtitleList, selection.subtitleTrack]]) {
      for (const button of list.children) button.setAttribute('aria-checked', String(Number(button.dataset.trackId) === selected));
    }
    positionMenu();
  }
  function toggleSubmenu(button, list) {
    const expand = list.classList.contains('hidden');
    list.classList.toggle('hidden', !expand); button.setAttribute('aria-expanded', String(expand));
    positionMenu();
    if (expand) list.querySelector('button:not(.hidden)')?.focus({ preventScroll: true });
  }
  function closeMenu(restoreFocus = false) {
    if (menuOpen) popup.hidePopover();
    menuOpen = false;
    menuAnchor?.setAttribute('aria-expanded', 'false');
    if (restoreFocus) menuAnchor?.focus({ preventScroll: true });
    menuAnchor = null; menuMedia = null;
    for (const [button, list] of [[qualityButton, qualityList], [languageButton, languageOptions], [audioButton, audioList], [subtitleButton, subtitleList]]) {
      button.setAttribute('aria-expanded', 'false'); list.classList.add('hidden');
    }
    languageStatus.classList.add('hidden');
    window.nativePlayer?.clip(null);
  }
  function openMenu(media, anchor) {
    if (!canFavorite(media) && !canDownload(media) && !canChooseLanguage(media) && !canChooseQuality(media)) return;
    if (menuOpen && anchor === menuAnchor) { closeMenu(); return; }
    closeMenu();
    menuMedia = media; menuAnchor = anchor;
    (document.fullscreenElement || anchor.closest('dialog') || document.body).append(popup);
    playerButton.classList.toggle('hidden', !canDownload(media));
    renderFavorite();
    popup.showPopover(); menuOpen = true;
    anchor.setAttribute('aria-expanded', 'true');
    playerButton.disabled = busy;
    renderQualities(); renderLanguages();
    (canFavorite(media) ? favoriteButton : canDownload(media) ? playerButton : canChooseQuality(media) ? qualityButton : languageButton).focus({ preventScroll: true });
  }
  const showStatus = message => { panel.classList.remove('hidden'); $('#download-status').textContent = message; };
  window.tv.onDownloadProgress(progress => {
    status = progress.status;
    busy = status === 'downloading';
    cancel.classList.toggle('hidden', !busy);
    folderButton.classList.toggle('hidden', status !== 'completed');
    if (progress.filePath) folderButton.title = progress.filePath;
    const mb = bytes => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    showStatus(status === 'completed' ? 'Download concluído.' : status === 'canceled' ? 'Download cancelado.' : status === 'failed' ? 'O download falhou. Tente novamente.' : `Baixando ${mb(progress.bytes || 0)}${progress.total ? ` de ${mb(progress.total)}` : ''}`);
    refresh();
  });
  async function start(media, trigger) {
    if (busy || !canDownload(media)) return;
    busy = true; status = 'preparing'; refresh();
    if (trigger) trigger.disabled = true;
    const current = state.playback;
    const position = window.nativePlayer?.position() || 0;
    const paused = window.nativePlayer?.paused() ?? true;
    const suspended = Boolean(current?.url);
    if (suspended) resetVideo();
    const resume = () => {
      if (!suspended || state.playback !== current) return;
      attachStream(current.url, { position, paused });
    };
    try {
      const result = await window.tv.download({
        kind: media.sourceKind === 'extra' ? 'series' : media.kind,
        sourceKind: media.sourceKind || media.kind,
        show: media.show === true,
        mediaId: media.mediaId,
        extension: media.extension || 'mp4',
        title: media.title,
      });
      if (result.canceled) { busy = false; status = 'idle'; resume(); }
      else if (result.started) {
        if (state.playback === current) closePlayer();
        closeSeriesDetails();
        if (status === 'preparing') { status = 'downloading'; busy = true; showStatus('Iniciando download…'); }
        cancel.classList.toggle('hidden', !busy);
      } else { busy = false; status = 'idle'; resume(); }
    } catch (error) {
      busy = false; status = 'failed'; showStatus(errorMessage(error)); cancel.classList.add('hidden'); resume();
    } finally {
      refresh();
      if (trigger) trigger.disabled = busy;
    }
  }
  function buttonFor(media) {
    if (!canFavorite(media) && !canDownload(media)) return null;
    const button = document.createElement('button');
    button.className = 'media-options-button'; button.type = 'button'; button.textContent = '⋮';
    button.setAttribute('aria-label', `Opções de ${media.title || 'mídia'}`);
    button.setAttribute('aria-haspopup', 'menu'); button.setAttribute('aria-controls', 'media-actions-menu'); button.setAttribute('aria-expanded', 'false');
    button.addEventListener('click', event => { event.stopPropagation(); openMenu(media, button); });
    button.addEventListener('keydown', event => { if (event.key === 'ArrowDown') { event.preventDefault(); event.stopPropagation(); openMenu(media, button); } });
    return button;
  }
  cancel.addEventListener('click', () => window.tv.cancelDownload());
  languageButton.addEventListener('click', () => toggleSubmenu(languageButton, languageOptions));
  qualityButton.addEventListener('click', () => toggleSubmenu(qualityButton, qualityList));
  audioButton.addEventListener('click', () => toggleSubmenu(audioButton, audioList));
  subtitleButton.addEventListener('click', () => toggleSubmenu(subtitleButton, subtitleList));
  popup.addEventListener('keydown', event => {
    const buttons = [...popup.querySelectorAll('button')].filter(button => button.getClientRects().length && !button.disabled);
    const index = buttons.indexOf(document.activeElement);
    let target;
    if (event.key === 'ArrowDown') target = buttons[(index + 1) % buttons.length];
    if (event.key === 'ArrowUp') target = buttons[(index - 1 + buttons.length) % buttons.length];
    if (event.key === 'Home') target = buttons[0];
    if (event.key === 'End') target = buttons.at(-1);
    if (target) { event.preventDefault(); target.focus({ preventScroll: true }); }
    if (event.key === 'ArrowRight' && document.activeElement?.getAttribute('aria-expanded') === 'false') { event.preventDefault(); document.activeElement.click(); }
    if (event.key === 'ArrowLeft') {
      const list = document.activeElement?.closest('.track-options, .language-options, .quality-options');
      if (list) { event.preventDefault(); const button = popup.querySelector(`[aria-controls="${list.id}"]`); toggleSubmenu(button, list); button.focus({ preventScroll: true }); }
    }
  });
  playerTrigger.addEventListener('click', event => { event.stopPropagation(); if (state.playback) openMenu(state.playback, playerTrigger); });
  favoriteButton.addEventListener('click', () => {
    const media = menuMedia;
    if (!media || !canFavorite(media)) return;
    const result = window.favoriteContent.toggle(media);
    window.dispatchEvent(new CustomEvent('content-favorites:changed', { detail: result }));
    renderFavorite(); positionMenu();
  });
  playerButton.addEventListener('click', () => { const media = menuMedia; closeMenu(); if (media) start(media, playerButton); });
  folderButton.addEventListener('click', () => window.tv.showDownloadedFile().catch(error => showStatus(errorMessage(error))));
  document.addEventListener('pointerdown', event => { if (menuOpen && !popup.contains(event.target) && event.target !== menuAnchor) closeMenu(); });
  document.addEventListener('keydown', event => { if (menuOpen && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeMenu(true); } }, true);
  document.addEventListener('scroll', event => { if (menuOpen && !popup.contains(event.target)) closeMenu(); }, true);
  window.addEventListener('resize', () => { if (menuOpen) closeMenu(); });
  new ResizeObserver(() => positionMenu()).observe(popup);
  window.downloadOptions = { canDownload, canFavorite, refresh, start, buttonFor, closeMenu };
})();
