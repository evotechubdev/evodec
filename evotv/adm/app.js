const FIREBASE_API_KEY = 'AIzaSyDbSMFXN6pmkqfhtBm3no2bXoAbyT_FoAo';
const LOGIN_DOMAIN = 'evotv.com.br';
const BACKEND = 'https://multimideas-evo-backend.onrender.com';
const MODULE_LOADERS = { 'home-news': loadNewsModule, 'extra-reelshort': loadReelShortModule, 'site-downloads': loadDownloadsModule };
const $ = selector => document.querySelector(selector);
let token = '';
let items = [];
let modules = [];
let uploads = 0;
let currentImportJob = '';
let downloads = [];

function preventSilentCredentialAccess() {
  const request = navigator.credentials?.preventSilentAccess?.();
  request?.catch?.(() => {});
}
function clearCredentials() {
  $('#login-form').reset();
  $('#login').value = '';
  $('#login').readOnly = true;
  $('#password').value = '';
  $('#password').type = 'password';
  $('#password').readOnly = true;
  $('#show-password').checked = false;
}
function unlockCredentialField(event) { event.currentTarget.readOnly = false; }
for (const field of [$('#login'), $('#password')]) {
  field.addEventListener('focus', unlockCredentialField);
  field.addEventListener('pointerdown', unlockCredentialField);
  field.addEventListener('keydown', unlockCredentialField);
  field.addEventListener('blur', () => { if (!field.value) field.readOnly = true; });
}
clearCredentials();
preventSilentCredentialAccess();
window.addEventListener('pageshow', clearCredentials);
window.addEventListener('pagehide', () => { void cancelActiveImport({ keepalive: true, quiet: true }); clearCredentials(); });

function message(text = '', type = '') { const node = $('#status'); node.textContent = text; node.className = type; }
function slug(value) { return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64); }
function loginEmail(value) {
  const suffix = `@${LOGIN_DOMAIN}`;
  const login = String(value || '').trim().toLowerCase().replace(new RegExp(`${suffix.replace('.', '\\.')}$`, 'i'), '');
  return login ? `${login}${suffix}` : '';
}
async function request(path, options = {}) {
  const response = await fetch(`${BACKEND}${path}`, { ...options, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(options.headers || {}) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Não foi possível concluir a operação.');
  return data;
}
async function cancelActiveImport({ keepalive = false, quiet = false } = {}) {
  const hadActiveJob = Boolean(currentImportJob);
  currentImportJob = '';
  if (!token || !hadActiveJob) return false;
  try {
    const response = await fetch(`${BACKEND}/api/admin/reelshort/import/cancel-active`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: '{}',
      keepalive,
    });
    if (!response.ok) throw new Error('Não foi possível cancelar a importação em andamento.');
    if (!quiet) {
      $('#reelshort-status').textContent = 'Importação cancelada. Nenhum conteúdo incompleto foi salvo.';
      $('#reelshort-status').className = 'ignored';
      $('#import-reelshort').disabled = false;
    }
    return true;
  } catch (error) {
    if (!quiet) {
      $('#reelshort-status').textContent = error.message;
      $('#reelshort-status').className = 'error';
      $('#import-reelshort').disabled = false;
    }
    return false;
  }
}
async function uploadImage(file, path = '/api/admin/news/image') {
  if (!file || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) throw new Error('Selecione uma imagem JPEG, PNG ou WebP de até 5 MB.');
  const response = await fetch(`${BACKEND}${path}`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': file.type }, body: file });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.imageUrl) throw new Error(data.error || 'Não foi possível enviar a imagem.');
  return data.imageUrl;
}
async function resizedImage(file, field, mode, width, height) {
  if (mode === 'original') return file;
  const automatic = field === 'featureImage' ? [1125, 400] : [600, 825];
  const targetWidth = Math.max(240, Math.min(3200, Number(mode === 'manual' ? width : automatic[0]) || automatic[0]));
  const targetHeight = Math.max(180, Math.min(2400, Number(mode === 'manual' ? height : automatic[1]) || automatic[1]));
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement('canvas'); canvas.width = targetWidth; canvas.height = targetHeight;
  const context = canvas.getContext('2d', { alpha: false });
  const scale = Math.max(targetWidth / bitmap.width, targetHeight / bitmap.height);
  const drawWidth = bitmap.width * scale, drawHeight = bitmap.height * scale;
  context.drawImage(bitmap, (targetWidth - drawWidth) / 2, (targetHeight - drawHeight) / 2, drawWidth, drawHeight);
  bitmap.close?.();
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Não foi possível redimensionar a imagem.')), 'image/jpeg', .9));
}
function automaticId() { return `novidade-${Date.now().toString(36)}-${crypto.getRandomValues(new Uint32Array(1))[0].toString(36)}`.slice(0, 64); }
function blank() { return { id: automaticId(), title: '', cardImage: '', featureImage: '', synopsis: '', information: '' }; }
function render() {
  const root = $('#cards'); root.replaceChildren();
  items.forEach((item, index) => {
    const node = $('#card-template').content.firstElementChild.cloneNode(true);
    node.querySelector('strong').textContent = `Card ${index + 1}`;
    for (const input of node.querySelectorAll('[data-field]')) {
      const field = input.dataset.field; input.value = item[field] || '';
      input.addEventListener('input', () => {
        item[field] = input.value;
        if (!item.id) item.id = automaticId();
        if (field === 'title') node.querySelector('[data-preview-title]').textContent = input.value.trim() || 'Título da novidade';
        if (field === 'synopsis') node.querySelector('[data-preview-synopsis]').textContent = input.value.trim() || 'A sinopse aparecerá aqui, sobre a imagem de destaque.';
      });
    }
    node.querySelector('[data-preview-title]').textContent = item.title || 'Título da novidade';
    node.querySelector('[data-preview-synopsis]').textContent = item.synopsis || 'A sinopse aparecerá aqui, sobre a imagem de destaque.';
    for (const image of node.querySelectorAll('[data-preview]')) image.src = item[image.dataset.preview] || '';
    for (const input of node.querySelectorAll('[data-upload]')) {
      const field = input.dataset.upload;
      const uploadStatus = node.querySelector(`[data-upload-status="${field}"]`);
      const mode = node.querySelector(`[data-resize-mode="${field}"]`);
      const manual = node.querySelector(`[data-manual-size="${field}"]`);
      mode.addEventListener('change', () => { manual.hidden = mode.value !== 'manual'; });
      if (item[field]) uploadStatus.textContent = 'Imagem atual cadastrada. Selecione outra para substituir.';
      input.addEventListener('change', async () => {
        const file = input.files?.[0]; if (!file) return;
        uploads += 1; $('#publish').disabled = true; input.disabled = true; uploadStatus.textContent = 'Enviando imagem…';
        try {
          const prepared = await resizedImage(file, field, mode.value, node.querySelector(`[data-width="${field}"]`).value, node.querySelector(`[data-height="${field}"]`).value);
          item[field] = await uploadImage(prepared); node.querySelector(`[data-preview="${field}"]`).src = item[field]; node.querySelector(`[data-remove-image="${field}"]`).hidden = false; uploadStatus.textContent = 'Imagem redimensionada, enviada e cadastrada com sucesso.';
        } catch (error) { input.value = ''; uploadStatus.textContent = error.message; }
        finally { uploads -= 1; input.disabled = false; $('#publish').disabled = uploads > 0; }
      });
    }
    for (const button of node.querySelectorAll('[data-remove-image]')) {
      const field = button.dataset.removeImage;
      button.hidden = !item[field];
      button.addEventListener('click', () => {
        item[field] = '';
        const preview = node.querySelector(`[data-preview="${field}"]`); preview.removeAttribute('src');
        const input = node.querySelector(`[data-upload="${field}"]`); input.value = '';
        node.querySelector(`[data-upload-status="${field}"]`).textContent = 'Imagem removida. Selecione outra antes de publicar.';
        button.hidden = true;
      });
    }
    node.querySelector('[data-action="up"]').disabled = index === 0;
    node.querySelector('[data-action="down"]').disabled = index === items.length - 1;
    node.querySelector('[data-action="remove"]').disabled = items.length === 1;
    node.addEventListener('click', event => {
      const action = event.target.closest('[data-action]')?.dataset.action; if (!action) return;
      if (action === 'remove') items.splice(index, 1);
      if (action === 'up' && index > 0) [items[index - 1], items[index]] = [items[index], items[index - 1]];
      if (action === 'down' && index < items.length - 1) [items[index + 1], items[index]] = [items[index], items[index + 1]];
      render();
    });
    root.append(node);
  });
  $('#add-card').disabled = items.length >= 5;
}
async function loadNewsModule() {
  hideModulePanels();
  const data = await request('/api/admin/news');
  items = Array.isArray(data.items) && data.items.length ? data.items.map(item => ({ ...item })) : [blank()];
  $('#page-title').textContent = 'Novidades da Home';
  $('#news-editor-panel').hidden = false;
  render();
}
function hideModulePanels() {
  $('#admin-home').hidden = true;
  $('#news-editor-panel').hidden = true;
  $('#reelshort-panel').hidden = true;
  $('#downloads-panel').hidden = true;
}
function reelShortLinks() {
  return $('#reelshort-links').value.split(/\r?\n/).map(value => value.trim()).filter(Boolean);
}
function normalizedStreamingName(value) {
  return String(value || '').normalize('NFKC').replace(/\s+/g, ' ').trim().toLocaleUpperCase('pt-BR');
}
function updateReelShortCount() {
  const count = reelShortLinks().length;
  if (currentImportJob) return;
  const node = $('#reelshort-status');
  node.textContent = count ? `${count} de 20 links informados.` : 'Nenhum link informado.';
  node.className = count > 20 ? 'error' : '';
}
function renderReelShortCatalog(series = []) {
  $('#reelshort-total').textContent = `Total: ${series.length} mininovela${series.length === 1 ? '' : 's'}`;
  const root = $('#reelshort-catalog'); root.replaceChildren();
  for (const item of series) {
    const article = document.createElement('article');
    const image = document.createElement('img'); image.src = item.imageUrl || ''; image.alt = '';
    const copy = document.createElement('div'); copy.className = 'reelshort-copy';
    const title = document.createElement('strong'); title.textContent = item.name || 'Mininovela';
    const streaming = document.createElement('span'); streaming.className = 'streaming-badge'; streaming.textContent = item.streamingName || 'STREAMING NÃO INFORMADO';
    const meta = document.createElement('span'); meta.textContent = `${Number(item.totalEpisodes) || 0} episódios${item.status ? ` · ${item.status}` : ''}`;
    copy.append(title, streaming, meta); article.append(image, copy);
    if (item.id) {
      const controls = document.createElement('div'); controls.className = 'reelshort-card-actions';
      const editor = document.createElement('div'); editor.className = 'streaming-editor';
      const input = document.createElement('input'); input.value = item.streamingName || ''; input.maxLength = 40; input.setAttribute('list', 'streaming-options'); input.setAttribute('aria-label', `Streaming de ${item.name || 'mininovela'}`);
      const save = document.createElement('button'); save.type = 'button'; save.className = 'secondary'; save.textContent = 'Salvar streaming';
      save.addEventListener('click', async () => {
        const streamingName = normalizedStreamingName(input.value);
        if (!streamingName) return alert('Informe o streaming desta mininovela.');
        input.value = streamingName; input.disabled = true; save.disabled = true;
        try {
          const data = await request(`/api/admin/reelshort/${encodeURIComponent(item.id)}/streaming`, { method: 'POST', body: JSON.stringify({ streamingName }) });
          item.streamingName = data.series?.streamingName || streamingName;
          input.value = item.streamingName; streaming.textContent = item.streamingName;
          $('#reelshort-status').textContent = `Streaming de “${item.name}” atualizado para ${item.streamingName}, sem alterar os episódios.`;
          $('#reelshort-status').className = 'success';
        } catch (error) {
          $('#reelshort-status').textContent = error.message; $('#reelshort-status').className = 'error';
        } finally { input.disabled = false; save.disabled = false; }
      });
      editor.append(input, save); controls.append(editor);
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'danger reelshort-remove'; remove.textContent = 'Excluir';
      remove.addEventListener('click', async () => {
        if (!window.confirm(`Excluir “${item.name}” do catálogo do programa de PC e do aplicativo Android? Depois será possível importar novamente.`)) return;
        remove.disabled = true;
        try {
          await request(`/api/admin/reelshort/${encodeURIComponent(item.id)}`, { method: 'DELETE' });
          const data = await request('/api/admin/reelshort'); renderReelShortCatalog(data.series || []);
          $('#reelshort-status').textContent = `“${item.name}” foi excluída. Agora você pode corrigir o link e importar novamente.`;
          $('#reelshort-status').className = 'success';
        } catch (error) {
          $('#reelshort-status').textContent = error.message; $('#reelshort-status').className = 'error'; remove.disabled = false;
        }
      });
      controls.append(remove); article.append(controls);
    }
    root.append(article);
  }
  if (!series.length) root.textContent = 'Nenhuma mininovela cadastrada.';
}
function renderImportResult(job) {
  const root = $('#reelshort-results'); root.replaceChildren();
  for (const item of job.imported || []) {
    const line = document.createElement('p'); line.className = 'success';
    const unavailable = Number(item.unavailableEpisodes) || 0;
    const dramafren = Number(item.dramafrenEpisodes) || 0;
    line.textContent = `✓ Importada: ${item.name}${item.streamingName ? ` · ${item.streamingName}` : ''} · ${item.totalEpisodes} episódios${dramafren ? ` · ${dramafren} via Dramafren` : ''}${unavailable ? ` · ${unavailable} episódio(s) sem fonte ignorado(s)` : ''}`;
    root.append(line);
  }
  for (const item of job.ignored || []) {
    const line = document.createElement('p'); line.className = 'ignored'; line.textContent = `Linha ${item.index} ignorada: ${item.reason}`; root.append(line);
  }
  for (const item of job.rejected || []) {
    const line = document.createElement('p'); line.className = 'error'; line.textContent = `Linha ${item.index}: ${item.reason}`; root.append(line);
    const unavailable = Array.isArray(item.unavailableEpisodes) ? item.unavailableEpisodes : [];
    if (unavailable.length) {
      const details = document.createElement('details'); details.className = 'episode-errors'; details.open = true;
      const summary = document.createElement('summary'); summary.textContent = `${item.name || 'Mininovela'}: ${unavailable.length} episódio(s) não localizado(s)`;
      const list = document.createElement('ol');
      for (const episode of unavailable) {
        const entry = document.createElement('li');
        const message = document.createElement('span'); message.textContent = `Episódio ${Number(episode.number) || '?'} — ${episode.reason || 'Fonte indisponível.'}`;
        entry.append(message);
        try {
          const page = new URL(episode.pageUrl);
          if (page.protocol === 'https:' && ['reelshort.com', 'www.reelshort.com'].includes(page.hostname)) {
            const link = document.createElement('a'); link.href = page.href; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = 'Ver página consultada';
            entry.append(link);
          }
        } catch { /* URL ausente ou inválida */ }
        list.append(entry);
      }
      details.append(summary, list); root.append(details);
    }
  }
}
function reelShortProgressLabel(progress = {}) {
  const seriesTotal = Number(progress.seriesTotal ?? progress.total) || 0;
  if (!seriesTotal) return '';
  const seriesIndex = Math.min(Number(progress.seriesIndex ?? progress.index) || 0, seriesTotal);
  if (!seriesIndex) return `Preparando ${seriesTotal} série${seriesTotal === 1 ? '' : 's'}…`;
  let label = `Importando Série ${seriesIndex}/${seriesTotal}`;
  const episodeTotal = Number(progress.episodeTotal) || 0;
  const episodeIndex = Math.max(Number(progress.episodeIndex) || 0, Number(progress.startedEpisodes) || 0);
  if (episodeTotal) label += ` · Episódio ${Math.min(episodeIndex, episodeTotal)}/${episodeTotal}`;
  const importedEpisodes = Number(progress.importedEpisodes) || 0;
  if (episodeTotal || importedEpisodes) label += ` · ${importedEpisodes} episódio${importedEpisodes === 1 ? '' : 's'} importado${importedEpisodes === 1 ? '' : 's'}`;
  if (progress.sourceProvider === 'dramafren') label += ' · Dramafren';
  if (progress.name) label += ` · ${progress.name}`;
  return label;
}
async function loadReelShortModule() {
  hideModulePanels();
  const data = await request('/api/admin/reelshort');
  $('#page-title').textContent = 'Conteúdo Extra - Mininovelas';
  $('#reelshort-panel').hidden = false;
  renderReelShortCatalog(Array.isArray(data.series) ? data.series : []);
  updateReelShortCount();
}
function renderDownloads() {
  const root = $('#download-editors'); root.replaceChildren();
  for (const item of downloads) {
    const node = $('#download-template').content.firstElementChild.cloneNode(true);
    node.querySelector('.card-toolbar strong').textContent = item.platform === 'android' ? 'Aplicativo Android' : 'Setup Windows';
    node.querySelector('.platform-badge').textContent = item.platform.toUpperCase();
    for (const input of node.querySelectorAll('[data-download-field]')) {
      const field = input.dataset.downloadField; input.value = item[field] || '';
      input.addEventListener('input', () => { item[field] = input.value; });
    }
    const preview = node.querySelector('[data-download-preview]');
    if (item.imageUrl) preview.src = item.imageUrl; else preview.hidden = true;
    const fileInput = node.querySelector('[data-download-image]');
    const uploadStatus = node.querySelector('[data-download-upload-status]');
    if (item.imageUrl) uploadStatus.textContent = 'Imagem atual cadastrada. Selecione outra para substituir.';
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files?.[0]; if (!file) return;
      uploads += 1; $('#publish-downloads').disabled = true; fileInput.disabled = true; uploadStatus.textContent = 'Enviando imagem…';
      try {
        const prepared = await resizedImage(file, 'featureImage', 'manual', 1200, 675);
        item.imageUrl = await uploadImage(prepared, '/api/admin/site-downloads/image');
        preview.src = item.imageUrl; preview.hidden = false; uploadStatus.textContent = 'Imagem cadastrada com sucesso.';
      } catch (error) { fileInput.value = ''; uploadStatus.textContent = error.message; }
      finally { uploads -= 1; fileInput.disabled = false; $('#publish-downloads').disabled = uploads > 0; }
    });
    root.append(node);
  }
}
async function loadDownloadsModule() {
  hideModulePanels();
  const data = await request('/api/admin/site-downloads');
  downloads = Array.isArray(data.items) ? data.items.map(item => ({ ...item })) : [];
  $('#page-title').textContent = 'Downloads do Site EVOTV';
  $('#downloads-panel').hidden = false;
  renderDownloads();
}
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
async function monitorReelShortImport(jobId) {
  currentImportJob = jobId;
  while (token && currentImportJob === jobId) {
    const job = await request(`/api/admin/reelshort/import/${encodeURIComponent(jobId)}`);
    const progress = job.progress || {};
    const progressLabel = reelShortProgressLabel(progress);
    if (progressLabel) $('#reelshort-status').textContent = progressLabel;
    renderImportResult(job);
    if (job.status === 'complete') {
      const importedEpisodes = Number(job.importedEpisodes) || (job.imported || []).reduce((total, item) => total + (Number(item.totalEpisodes) || 0), 0);
      const importedSeries = (job.imported || []).length;
      $('#reelshort-status').textContent = `Importação concluída: ${importedSeries} série${importedSeries === 1 ? '' : 's'} e ${importedEpisodes} episódio${importedEpisodes === 1 ? '' : 's'} importado${importedEpisodes === 1 ? '' : 's'}; ${(job.ignored || []).length} ignorada(s) e ${(job.rejected || []).length} com erro.`;
      $('#reelshort-status').className = 'success';
      currentImportJob = ''; $('#import-reelshort').disabled = false;
      const catalog = await request('/api/admin/reelshort'); renderReelShortCatalog(catalog.series || []);
      return;
    }
    if (job.status === 'failed') {
      $('#reelshort-status').textContent = job.error || 'A importação falhou.'; $('#reelshort-status').className = 'error';
      currentImportJob = ''; $('#import-reelshort').disabled = false; return;
    }
    if (['cancelled', 'cancelling'].includes(job.status)) {
      $('#reelshort-status').textContent = job.status === 'cancelled'
        ? 'Importação cancelada. Nenhum conteúdo incompleto foi salvo.'
        : 'Cancelando importação…';
      $('#reelshort-status').className = 'ignored';
      if (job.status === 'cancelled') { currentImportJob = ''; $('#import-reelshort').disabled = false; return; }
    }
    const importedEpisodes = Number(job.importedEpisodes) || 0;
    if (job.status === 'saving') $('#reelshort-status').textContent = `Salvando ${importedEpisodes} episódio${importedEpisodes === 1 ? '' : 's'} no catálogo…`;
    await wait(2000);
  }
}
async function openModule(moduleId) {
  if (moduleId !== 'extra-reelshort' && currentImportJob) await cancelActiveImport();
  if (!moduleId) {
    hideModulePanels();
    $('#module-select').value = '';
    $('#page-title').textContent = 'Home';
    $('#admin-home').hidden = false;
    return;
  }
  const module = modules.find(item => item.id === moduleId);
  const loader = MODULE_LOADERS[moduleId];
  if (!module || !loader) throw new Error('Módulo indisponível para esta conta.');
  $('#module-select').value = moduleId;
  await loader();
}

$('#login-form').addEventListener('submit', async event => {
  event.preventDefault(); const button = event.submitter; button.disabled = true; button.textContent = 'Entrando...';
  try {
    const email = loginEmail($('#login').value);
    const password = $('#password').value;
    clearCredentials();
    const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FIREBASE_API_KEY}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password, returnSecureToken: true }) });
    const auth = await response.json();
    if (!response.ok) throw new Error('Login, senha ou autorização administrativa inválidos.');
    token = auth.idToken;
    const access = await request('/api/admin/modules'); modules = Array.isArray(access.modules) ? access.modules : [];
    const home = document.createElement('option'); home.value = ''; home.textContent = 'Home';
    const select = $('#module-select'); select.replaceChildren(home, ...modules.map(module => { const option = document.createElement('option'); option.value = module.id; option.textContent = module.name; return option; }));
    document.body.classList.add('authenticated'); $('#login-panel').hidden = true; $('#module-navigation').hidden = false; $('#logout').hidden = false;
    await openModule('');
  } catch (error) { token = ''; modules = []; clearCredentials(); alert(error.message); }
  finally { button.disabled = false; button.textContent = 'Entrar'; }
});
$('#module-select').addEventListener('change', event => openModule(event.target.value).catch(error => alert(error.message)));
$('#show-password').addEventListener('change', event => { $('#password').type = event.target.checked ? 'text' : 'password'; });
$('#add-card').addEventListener('click', () => { if (items.length < 5) { items.push(blank()); render(); } });
$('#publish').addEventListener('click', async () => {
  if (uploads > 0) return;
  const button = $('#publish'); button.disabled = true; message('Publicando...');
  try {
    if (items.some(item => !item.cardImage || !item.featureImage)) throw new Error('Cada card precisa ter a imagem do card e a imagem de destaque.');
    if (items.some(item => !item.synopsis?.trim())) throw new Error('Informe a sinopse de cada card.');
    const payload = items.map(({ id, title, cardImage, featureImage, synopsis, information }) => ({ id: slug(id || automaticId()), title: title.trim(), cardImage: cardImage.trim(), featureImage: featureImage.trim(), synopsis: synopsis.trim(), information: information.trim() }));
    const data = await request('/api/admin/news', { method: 'POST', body: JSON.stringify({ items: payload }) });
    items = data.items.map(item => ({ ...item })); render(); message('Novidades publicadas com sucesso.', 'success');
  } catch (error) { message(error.message, 'error'); }
  finally { button.disabled = false; }
});
$('#reelshort-links').addEventListener('input', updateReelShortCount);
$('#import-reelshort').addEventListener('click', async () => {
  const links = reelShortLinks();
  if (!links.length || links.length > 20) return alert('Informe de 1 a 20 links, um por linha.');
  const streamingName = normalizedStreamingName($('#reelshort-streaming').value);
  if (!streamingName) return alert('Informe o streaming das mininovelas.');
  $('#reelshort-streaming').value = streamingName;
  const button = $('#import-reelshort'); button.disabled = true; $('#reelshort-results').replaceChildren();
  $('#reelshort-status').className = ''; $('#reelshort-status').textContent = 'Iniciando importação segura…';
  try {
    const data = await request('/api/admin/reelshort/import', { method: 'POST', body: JSON.stringify({ links, streamingName }) });
    await monitorReelShortImport(data.jobId);
  } catch (error) {
    currentImportJob = ''; button.disabled = false; $('#reelshort-status').className = 'error'; $('#reelshort-status').textContent = error.message;
  }
});
$('#publish-downloads').addEventListener('click', async () => {
  if (uploads > 0) return;
  const button = $('#publish-downloads'); button.disabled = true; $('#downloads-status').className = ''; $('#downloads-status').textContent = 'Publicando…';
  try {
    const data = await request('/api/admin/site-downloads', { method: 'POST', body: JSON.stringify({ items: downloads }) });
    downloads = data.items.map(item => ({ ...item })); renderDownloads(); $('#downloads-status').className = 'success'; $('#downloads-status').textContent = 'Downloads publicados no site com sucesso.';
  } catch (error) { $('#downloads-status').className = 'error'; $('#downloads-status').textContent = error.message; }
  finally { button.disabled = false; }
});
$('#logout').addEventListener('click', async () => {
  await cancelActiveImport({ quiet: true });
  token = ''; items = []; downloads = []; modules = []; currentImportJob = ''; document.body.classList.remove('authenticated'); hideModulePanels(); $('#module-navigation').hidden = true; $('#module-select').replaceChildren(new Option('Home', '')); $('#logout').hidden = true; $('#login-panel').hidden = false; $('#page-title').textContent = 'Home'; clearCredentials(); preventSilentCredentialAccess(); message();
});
