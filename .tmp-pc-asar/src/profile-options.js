(() => {
  let mode = 'settings', pendingAdults = false, settings = null, busy = false, noticeTimer, openGeneration = 0;
  const dialog = $('#parental-dialog');
  // The API numbers profiles from 1; profileNames[0] is the principal profile.
  const principal = () => Number(state.profile) === 1;
  const adultsVisible = () => state.session?.adultVisible !== false && state.session?.parental?.adultVisible !== false;
  const clearSecrets = () => { for (const id of ['#parental-pin', '#parental-new-pin']) $(id).value = ''; };
  function notice(message) {
    const element = $('#app-notice'); clearTimeout(noticeTimer);
    element.textContent = message; element.classList.remove('hidden');
    noticeTimer = setTimeout(() => element.classList.add('hidden'), 8000);
  }
  const validPin = value => /^\d{4,8}$/.test(value);
  function collapseAdults() {
    state.adultMenuOpen = false;
    $('#adult-types').classList.add('hidden'); $('#adult-nav').setAttribute('aria-expanded', 'false');
  }
  function expandAdults() {
    if (!adultsVisible() || !state.session?.adultAllowed) return;
    state.adultMenuOpen = true;
    $('#adult-types').classList.remove('hidden'); $('#adult-nav').setAttribute('aria-expanded', 'true');
    positionAdults();
  }
  function positionAdults() {
    if (!state.adultMenuOpen) return;
    const top = Math.max(12, Math.min($('#adult-nav').getBoundingClientRect().top, window.innerHeight - $('#adult-types').offsetHeight - 12));
    $('#adult-types').style.setProperty('--adult-menu-top', `${top}px`);
  }
  window.addEventListener('resize', positionAdults);
  document.querySelector('.sidebar').addEventListener('scroll', positionAdults);
  function changed() {
    const type = window.resolveAccountType(state.user?.accountType);
    if (state.session?.parental?.adultMode === 'free') state.session.adultAllowed = true;
    $('#account-type').textContent = type; $('#account-type').classList.toggle('premium', type === 'PREMIUM');
    $('#parental-settings').classList.toggle('hidden', !principal());
    $('#profile-settings').classList.toggle('hidden', !principal());
    $('#adult-nav').classList.toggle('hidden', !adultsVisible());
    if (!adultsVisible() || !state.session?.adultAllowed) collapseAdults();
    window.downloadOptions?.refresh();
  }
  function renderProfiles() {
    const list = $('#parental-profiles'); list.replaceChildren();
    for (const profile of settings.profiles) {
      const row = document.createElement('label'), name = document.createElement('span'), select = document.createElement('select');
      row.className = 'parental-profile'; name.textContent = `${profile.name}${profile.profile === 1 ? ' · principal' : ''}`;
      select.dataset.profile = String(profile.profile); select.setAttribute('aria-label', `Conteúdo adulto de ${profile.name}`);
      for (const [value, label] of [['free', 'Liberado'], ['pin', 'Pedir PIN'], ['hidden', 'Oculto e bloqueado']]) {
        const option = document.createElement('option'); option.value = value; option.textContent = label; select.append(option);
      }
      select.value = profile.adultMode; row.append(name, select); list.append(row);
    }
  }
  async function open(manage = true, adult = false) {
    if (manage && !principal()) return;
    if (!manage && !adultsVisible()) return;
    if (busy) return;
    const generation = ++openGeneration, session = state.session, profile = state.profile;
    pendingAdults = adult; clearSecrets(); $('#parental-error').textContent = '';
    try {
      mode = manage ? 'settings' : 'unlock';
      const controls = manage ? await window.evoAuth.parentalSettings() : await window.evoAuth.parental();
      if (generation !== openGeneration || session !== state.session || profile !== state.profile) return;
      if (manage) { settings = controls; renderProfiles(); }
      else state.session.parental = controls;
      $('#parental-title').textContent = manage ? 'Controle parental' : 'Liberar conteúdo adulto';
      $('#parental-description').textContent = manage ? 'Escolha o acesso de cada perfil. O mesmo PIN protege estas configurações e libera adultos onde for solicitado.' : controls.configured ? 'Digite o PIN definido no perfil principal.' : 'Peça ao perfil principal para definir o PIN de conteúdo adulto.';
      $('#parental-options').classList.toggle('hidden', !manage);
      $('#parental-current-field').classList.toggle('hidden', manage && !controls.configured);
      $('#parental-pin-label').textContent = manage ? 'PIN atual' : 'PIN';
      $('#parental-pin').required = !manage || controls.configured;
      $('#parental-new-pin-label').textContent = controls.configured ? 'Novo PIN · opcional' : 'Definir PIN · 4 a 8 números';
      $('#parental-new-pin').required = manage && !controls.configured;
      $('#parental-pin').disabled = manage && !controls.configured;
      $('#parental-new-pin').disabled = !manage;
      $('#parental-submit').textContent = manage ? 'Salvar permissões' : 'Liberar';
      $('#parental-submit').disabled = !manage && !controls.configured;
      if (!dialog.open) dialog.showModal();
      (manage && !controls.configured ? $('#parental-new-pin') : $('#parental-pin')).focus();
    } catch (error) { $('#status-line').textContent = errorMessage(error); }
  }
  $('#adult-nav').addEventListener('click', () => {
    if (!adultsVisible()) return;
    if (state.adultMenuOpen) { collapseAdults(); if (state.adult) loadSection('channels'); }
    else if (state.session?.adultAllowed || state.session?.parental?.adultMode === 'free') {
      state.session.adultAllowed = true; expandAdults(); loadSection('channels', true);
    }
    else open(false, true);
  });
  $$('[data-adult-section]').forEach(button => button.addEventListener('click', () => { if (state.adultMenuOpen && adultsVisible() && state.session?.adultAllowed) loadSection(button.dataset.adultSection, true); }));
  $('#parental-settings').addEventListener('click', () => open(true));

  const profileSettingsDialog = $('#profile-settings-dialog');
  let profileSettings = null;
  function closeProfileSettings() {
    $('#profile-settings-list').replaceChildren();
    $('#profile-settings-error').textContent = '';
    if (profileSettingsDialog.open) profileSettingsDialog.close();
  }
  $('#profile-settings').addEventListener('click', async () => {
    if (!principal() || busy) return;
    $('#profile-settings-error').textContent = '';
    try {
      profileSettings = await window.evoAuth.profileSettings();
      const list = $('#profile-settings-list'); list.replaceChildren();
      for (const profile of profileSettings.profiles) {
        const row = document.createElement('div'); row.className = 'profile-settings-row'; row.dataset.profile = String(profile.profile);
        const number = document.createElement('strong'); number.textContent = String(profile.profile);
        const nameLabel = document.createElement('label'); nameLabel.className = 'field'; nameLabel.innerHTML = '<span>NOME</span>';
        const name = document.createElement('input'); name.className = 'profile-setting-name'; name.value = profile.name; name.maxLength = 60; name.required = true; nameLabel.append(name);
        const pinLabel = document.createElement('label'); pinLabel.className = 'field'; pinLabel.innerHTML = '<span>NOVO PIN · OPCIONAL</span>';
        const pin = document.createElement('input'); pin.className = 'profile-setting-pin'; pin.type = 'password'; pin.maxLength = 128; pin.autocomplete = 'new-password'; pinLabel.append(pin);
        row.append(number, nameLabel, pinLabel); list.append(row);
      }
      profileSettingsDialog.showModal();
      list.querySelector('input')?.focus();
    } catch (error) { notice(errorMessage(error)); }
  });
  $('#close-profile-settings').addEventListener('click', () => { if (!busy) closeProfileSettings(); });
  profileSettingsDialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); else closeProfileSettings(); });
  $('#profile-settings-form').addEventListener('submit', async event => {
    event.preventDefault(); if (busy || !profileSettings) return;
    const button = $('#profile-settings-submit'); $('#profile-settings-error').textContent = '';
    try {
      const profiles = $$('#profile-settings-list .profile-settings-row').map(row => ({
        profile: Number(row.dataset.profile), name: row.querySelector('.profile-setting-name').value,
        pin: row.querySelector('.profile-setting-pin').value,
      }));
      if (profiles.some(item => !item.name.trim())) throw new Error('Defina o nome de todos os perfis.');
      if (profiles.some(item => item.pin && item.pin.length < 4)) throw new Error('Use PINs de perfil com 4 a 128 caracteres.');
      busy = true; button.disabled = true; button.textContent = 'Salvando...'; $('#close-profile-settings').disabled = true;
      const result = await window.evoAuth.saveProfiles({ profiles, expectedRevision: profileSettings.revision });
      state.user.profileNames = result.profileNames;
      closeProfileSettings(); notice('Perfis atualizados. Digite o PIN do perfil para continuar.');
      await switchProfile();
    } catch (error) { $('#profile-settings-error').textContent = errorMessage(error); }
    finally { busy = false; button.disabled = false; button.textContent = 'Salvar perfis'; $('#close-profile-settings').disabled = false; }
  });
  $('#close-parental').addEventListener('click', () => { if (!busy) { openGeneration++; clearSecrets(); dialog.close(); } });
  dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); else { openGeneration++; clearSecrets(); } });
  $('#parental-form').addEventListener('submit', async event => {
    event.preventDefault(); if (busy) return;
    const button = $('#parental-submit'); $('#parental-error').textContent = '';
    const newPin = $('#parental-new-pin').value;
    const session = state.session, profile = state.profile;
    try {
      if (!$('#parental-pin').disabled && !validPin($('#parental-pin').value)) throw new Error('Informe o PIN de 4 a 8 números.');
      if (mode === 'settings') {
        if (($('#parental-new-pin').required || newPin) && !validPin(newPin)) throw new Error('Defina um PIN de 4 a 8 números.');
      }
      busy = true; button.disabled = true; button.textContent = mode === 'unlock' ? 'Liberando...' : 'Salvando...';
      $('#close-parental').disabled = true;
      if (mode === 'unlock') {
        if (!adultsVisible()) throw new Error('Conteúdo adulto está oculto e bloqueado neste perfil.');
        const unlocked = await window.evoAuth.unlockParental($('#parental-pin').value);
        if (session !== state.session || profile !== state.profile) return;
        if (!unlocked?.adultAllowed) throw new Error('O PIN não liberou este perfil.');
        Object.assign(state.session, unlocked);
      } else {
        if (!principal()) throw new Error('Somente o perfil principal pode alterar as permissões.');
        const result = await window.evoAuth.saveParental({
          profiles: $$('#parental-profiles select').map(select => ({ profile: Number(select.dataset.profile), adultMode: select.value })),
          expectedRevision: settings.revision, currentPin: $('#parental-pin').value, newPin,
        });
        if (result?.saved !== true) throw new Error('O servidor não confirmou o salvamento. Reabra o controle parental para conferir.');
        clearSecrets(); dialog.close();
        notice('Permissões salvas com sucesso. Escolha um perfil para continuar.');
        await switchProfile();
        return;
      }
      clearNavigation(); changed(); clearSecrets(); dialog.close();
      notice('Conteúdo adulto liberado.');
      if (pendingAdults && adultsVisible() && state.session.adultAllowed) { expandAdults(); await loadSection('channels', true); }
      else await loadSection(state.section, adultsVisible() && state.adult && state.session.adultAllowed);
    } catch (error) { $('#parental-error').textContent = errorMessage(error); }
    finally { busy = false; button.disabled = false; button.textContent = mode === 'unlock' ? 'Liberar' : 'Salvar permissões'; $('#close-parental').disabled = false; }
  });
  let targetProfile = null;
  const pinDialog = $('#profile-pin-dialog');
  const closeProfilePin = () => { $('#profile-pin').value = ''; $('#remember-profile-pin').checked = false; $('#profile-error').textContent = ''; if (pinDialog.open) pinDialog.close(); };
  $('#close-profile-pin').addEventListener('click', closeProfilePin);
  pinDialog.addEventListener('cancel', () => { $('#profile-pin').value = ''; });
  $('#profile-pin-form').addEventListener('submit', async event => {
    event.preventDefault();
    const pin = $('#profile-pin').value;
    if (pin.length < 4 || pin.length > 128) { $('#profile-pin-error').textContent = 'Digite o PIN deste perfil (4 a 128 caracteres).'; return; }
    await selectProfile(targetProfile, pin, $('#remember-profile-pin').checked); $('#profile-pin').value = '';
  });
  window.profileOptions = { changed, collapseAdults, closeProfilePin, notice, requestProfilePin(profile, message = '') { targetProfile = profile; $('#profile-pin-error').textContent = message; $('#profile-pin').value = ''; $('#remember-profile-pin').checked = false; if (!pinDialog.open) pinDialog.showModal(); $('#profile-pin').focus(); }, close() { openGeneration++; collapseAdults(); clearSecrets(); closeProfilePin(); if (dialog.open) dialog.close(); } };
})();
