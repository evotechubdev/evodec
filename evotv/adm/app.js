const FIREBASE_API_KEY = 'AIzaSyDbSMFXN6pmkqfhtBm3no2bXoAbyT_FoAo';
const LOGIN_DOMAIN = 'evotv.com.br';
const BACKEND = 'https://multimideas-evo-backend.onrender.com';
const WINDOWS_BRIDGE = 'http://127.0.0.1:47831';
const WINDOWS_JOB_PREFIX = 'windows:';
const MODULE_LOADERS = { 'home-news': loadNewsModule, 'extra-reelshort': loadReelShortModule, 'site-downloads': loadDownloadsModule };
const $ = selector => document.querySelector(selector);
let token = '';
let items = [];
let modules = [];
let uploads = 0;
let currentImportJob = '';
let downloads = [];
let reelShortCatalog = [];
let windowsBridgeOnline = false;

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
async function windowsBridgeRequest(path, options = {}, timeoutMs = 3_000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${WINDOWS_BRIDGE}${path}`, {
      ...options,
      signal: controller.signal,
      headers: { 'x-evotv-bridge': '1', 'content-type': 'application/json', ...(options.headers || {}) },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'O complemento Windows recusou a operação.');
    return data;
  } finally { clearTimeout(timeout); }
}
function setWindowsConnectorStatus(text, type = '') {
  const node = $('#windows-connector-status');
  if (!node) return;
  node.textContent = text;
  node.className = type;
}
async function refreshWindowsBridgeStatus() {
  try {
    const result = await windowsBridgeRequest('/health', {}, 1_500);
    if (!result.ok) throw new Error('Resposta local inválida.');
    windowsBridgeOnline = true;
    setWindowsConnectorStatus(result.active ? 'Instalado e ativo · importação em andamento' : 'Instalado, ativo e pronto para importar', 'success');
    return true;
  } catch {
    windowsBridgeOnline = false;
    setWindowsConnectorStatus('Não detectado. Baixe o instalador ou clique em Ativar / validar.', 'error');
    return false;
  }
}
function launchWindowsBridge() {
  const launcher = document.createElement('a');
  launcher.href = 'evotv-import://start';
  launcher.hidden = true;
  document.body.append(launcher);
  launcher.click();
  launcher.remove();
}
async function ensureWindowsBridge({ alreadyLaunched = false } = {}) {
  if (await refreshWindowsBridgeStatus()) return true;
  setWindowsConnectorStatus('Autorize o navegador a abrir o Conector EVOTV…');
  if (!alreadyLaunched) launchWindowsBridge();
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await wait(500);
    if (await refreshWindowsBridgeStatus()) return true;
  }
  throw new Error('O complemento Windows não foi encontrado. Use “Baixar instalador”, execute o arquivo uma vez e depois clique em Importar novamente.');
}
async function cancelActiveImport({ keepalive = false, quiet = false } = {}) {
  const hadActiveJob = Boolean(currentImportJob);
  const activeJob = currentImportJob;
  currentImportJob = '';
  if (!token || !hadActiveJob) return false;
  try {
    if (activeJob.startsWith(WINDOWS_JOB_PREFIX)) {
      const jobId = activeJob.slice(WINDOWS_JOB_PREFIX.length);
      await windowsBridgeRequest(`/v1/import/${encodeURIComponent(jobId)}/cancel`, { method: 'POST', body: '{}', keepalive }, keepalive ? 1_000 : 3_000);
      if (!quiet) {
        $('#reelshort-status').textContent = 'Importação local cancelada. Nenhum conteúdo incompleto foi salvo.';
        $('#reelshort-status').className = 'ignored';
        $('#import-reelshort').disabled = false;
      }
      return true;
    }
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
function normalizedCatalogText(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR').trim();
}
function updateReelShortCount() {
  const count = reelShortLinks().length;
  if (currentImportJob) return;
  const node = $('#reelshort-status');
  node.textContent = count ? `${count} de 20 links informados.` : 'Nenhum link informado.';
  node.className = count > 20 ? 'error' : '';
}
function updateReelShortCategoryFilter() {
  const select = $('#reelshort-category-filter');
  const selected = select.value;
  const categories = [...new Map(reelShortCatalog.map(item => {
    const id = String(item.categoryId || normalizedCatalogText(item.streamingName).replace(/[^a-z0-9]+/g, '-'));
    return [id, { id, name: item.streamingName || 'SEM CATEGORIA' }];
  }).filter(([id]) => id)).values()].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  const all = document.createElement('option'); all.value = ''; all.textContent = 'Todas as categorias';
  select.replaceChildren(all, ...categories.map(category => {
    const option = document.createElement('option'); option.value = category.id; option.textContent = category.name; return option;
  }));
  select.value = categories.some(category => category.id === selected) ? selected : '';
}
function renderReelShortCatalog(series) {
  if (Array.isArray(series)) {
    reelShortCatalog = series.map(item => ({ ...item }));
    updateReelShortCategoryFilter();
  }
  const search = normalizedCatalogText($('#reelshort-search').value);
  const category = $('#reelshort-category-filter').value;
  const filtered = reelShortCatalog.filter(item => {
    const itemCategory = String(item.categoryId || normalizedCatalogText(item.streamingName).replace(/[^a-z0-9]+/g, '-'));
    const searchable = normalizedCatalogText(`${item.name || ''} ${item.id || ''}`);
    return (!category || itemCategory === category) && (!search || searchable.includes(search));
  });
  $('#reelshort-total').textContent = `Total: ${reelShortCatalog.length} mininovela${reelShortCatalog.length === 1 ? '' : 's'}`;
  const filtering = Boolean(search || category);
  $('#reelshort-filter-result').textContent = filtering
    ? `${filtered.length} resultado${filtered.length === 1 ? '' : 's'} encontrado${filtered.length === 1 ? '' : 's'}.`
    : '';
  const root = $('#reelshort-catalog'); root.replaceChildren();
  for (const item of filtered) {
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
          item.categoryId = data.series?.categoryId || normalizedCatalogText(item.streamingName).replace(/[^a-z0-9]+/g, '-');
          input.value = item.streamingName; streaming.textContent = item.streamingName;
          updateReelShortCategoryFilter();
          renderReelShortCatalog();
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
  if (!filtered.length) root.textContent = filtering ? 'Nenhuma mininovela encontrada.' : 'Nenhuma mininovela cadastrada.';
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
  const processedEpisodes = Math.min(Number(progress.processedEpisodes) || 0, episodeTotal);
  const currentEpisode = Math.min(processedEpisodes + (processedEpisodes < episodeTotal ? 1 : 0), episodeTotal);
  const stage = String(progress.episodeStage || '');
  const recovering = stage.startsWith('recovery-');
  const recoveryEpisode = Math.min(Number(progress.episodeNumber) || 0, episodeTotal);
  if (episodeTotal && recovering && recoveryEpisode) {
    label += ` · Recuperando Episódio ${recoveryEpisode}/${episodeTotal}`;
    const recoveryPass = Number(progress.recoveryPass) || 0;
    const recoveryPasses = Number(progress.recoveryPasses) || 0;
    if (recoveryPass && recoveryPasses) label += ` · Tentativa ${recoveryPass}/${recoveryPasses}`;
  } else if (episodeTotal) {
    label += ` · Episódio ${Math.max(currentEpisode, 1)}/${episodeTotal}`;
  }
  if (episodeTotal) label += ` · ${processedEpisodes}/${episodeTotal} processados`;
  const locatedEpisodes = Number(progress.availableEpisodes) || 0;
  if (episodeTotal) label += ` · ${locatedEpisodes} fonte${locatedEpisodes === 1 ? '' : 's'} validada${locatedEpisodes === 1 ? '' : 's'}`;
  const unavailableEpisodes = Number(progress.unavailableEpisodes) || 0;
  if (unavailableEpisodes) label += ` · ${unavailableEpisodes} ${unavailableEpisodes === 1 ? 'indisponível' : 'indisponíveis'}`;
  if (progress.sourceProvider === 'dramafren') {
    const resumeAt = Number(progress.dramafrenResumeAt) || 0;
    const waitSeconds = resumeAt > Date.now()
      ? Math.ceil((resumeAt - Date.now()) / 1000)
      : Math.ceil((Number(progress.dramafrenWaitMs) || 0) / 1000);
    if (stage.endsWith('dramafren-waiting') && waitSeconds > 0) label += ` · Dramafren: aguardando ${waitSeconds}s`;
    else if (stage.endsWith('dramafren-requesting')) label += ' · Dramafren: consultando';
    else if (Number(progress.dramafrenStatus) === 403) label += ' · Dramafren: pausa após HTTP 403';
    else label += ' · Dramafren';
  }
  if (progress.name) label += ` · ${progress.name}`;
  return label;
}
async function loadReelShortModule() {
  hideModulePanels();
  const data = await request('/api/admin/reelshort');
  $('#reelshort-search').value = '';
  $('#reelshort-category-filter').value = '';
  $('#page-title').textContent = 'Conteúdo Extra - Mininovelas';
  $('#reelshort-panel').hidden = false;
  renderReelShortCatalog(Array.isArray(data.series) ? data.series : []);
  updateReelShortCount();
  void refreshWindowsBridgeStatus();
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
async function monitorWindowsImport(jobId) {
  currentImportJob = `${WINDOWS_JOB_PREFIX}${jobId}`;
  while (token && currentImportJob === `${WINDOWS_JOB_PREFIX}${jobId}`) {
    const job = await windowsBridgeRequest(`/v1/import/${encodeURIComponent(jobId)}`, {}, 5_000);
    const progressLabel = reelShortProgressLabel(job.progress || {});
    if (progressLabel) $('#reelshort-status').textContent = `${progressLabel} · Windows`;
    renderImportResult(job);
    if (job.status === 'complete') {
      const series = Array.isArray(job.series) ? job.series : [];
      for (const [index, item] of series.entries()) {
        $('#reelshort-status').textContent = `Salvando Série ${index + 1}/${series.length} no backend e no Firestore…`;
        await request('/api/admin/reelshort/sync', { method: 'POST', body: JSON.stringify({ series: item }) });
      }
      await windowsBridgeRequest(`/v1/import/${encodeURIComponent(jobId)}/ack`, { method: 'POST', body: '{}' });
      const importedEpisodes = Number(job.importedEpisodes) || 0;
      const importedSeries = (job.imported || []).length;
      $('#reelshort-status').textContent = `Importação concluída pelo Windows: ${importedSeries} série${importedSeries === 1 ? '' : 's'} e ${importedEpisodes} episódio${importedEpisodes === 1 ? '' : 's'} importado${importedEpisodes === 1 ? '' : 's'}; ${(job.ignored || []).length} ignorada(s) e ${(job.rejected || []).length} com erro.`;
      $('#reelshort-status').className = 'success';
      currentImportJob = '';
      $('#import-reelshort').disabled = false;
      const catalog = await request('/api/admin/reelshort');
      renderReelShortCatalog(catalog.series || []);
      await refreshWindowsBridgeStatus();
      return;
    }
    if (job.status === 'failed') {
      $('#reelshort-status').textContent = job.error || 'A importação pelo Windows falhou.';
      $('#reelshort-status').className = 'error';
      currentImportJob = '';
      $('#import-reelshort').disabled = false;
      return;
    }
    if (['cancelled', 'cancelling'].includes(job.status)) {
      $('#reelshort-status').textContent = job.status === 'cancelled'
        ? 'Importação local cancelada. Nenhum conteúdo incompleto foi salvo.'
        : 'Cancelando importação no Windows…';
      $('#reelshort-status').className = 'ignored';
      if (job.status === 'cancelled') {
        currentImportJob = '';
        $('#import-reelshort').disabled = false;
        return;
      }
    }
    await wait(1_000);
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
$('#reelshort-search').addEventListener('input', () => renderReelShortCatalog());
$('#reelshort-category-filter').addEventListener('change', () => renderReelShortCatalog());
$('#activate-windows-connector').addEventListener('click', async event => {
  const button = event.currentTarget;
  button.disabled = true;
  launchWindowsBridge();
  try { await ensureWindowsBridge({ alreadyLaunched: true }); }
  catch (error) { setWindowsConnectorStatus(error.message, 'error'); }
  finally { button.disabled = false; }
});
$('#import-reelshort').addEventListener('click', async () => {
  const links = reelShortLinks();
  if (!links.length || links.length > 20) return alert('Informe de 1 a 20 links, um por linha.');
  const streamingName = normalizedStreamingName($('#reelshort-streaming').value);
  if (!streamingName) return alert('Informe o streaming das mininovelas.');
  $('#reelshort-streaming').value = streamingName;
  const button = $('#import-reelshort'); button.disabled = true; $('#reelshort-results').replaceChildren();
  $('#reelshort-status').className = ''; $('#reelshort-status').textContent = 'Validando o complemento Windows…';
  const bridgeLaunchRequested = !windowsBridgeOnline;
  if (bridgeLaunchRequested) launchWindowsBridge();
  try {
    await ensureWindowsBridge({ alreadyLaunched: bridgeLaunchRequested });
    const existingIds = reelShortCatalog.flatMap(item => [String(item.id || ''), ...(item.bookId ? [`book:${String(item.bookId).toLowerCase()}`] : [])]).filter(Boolean);
    const data = await windowsBridgeRequest('/v1/import', { method: 'POST', body: JSON.stringify({ links, streamingName, existingIds }) }, 5_000);
    await monitorWindowsImport(data.jobId);
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
  token = ''; items = []; downloads = []; modules = []; reelShortCatalog = []; currentImportJob = ''; document.body.classList.remove('authenticated'); hideModulePanels(); $('#module-navigation').hidden = true; $('#module-select').replaceChildren(new Option('Home', '')); $('#logout').hidden = true; $('#login-panel').hidden = false; $('#page-title').textContent = 'Home'; $('#reelshort-search').value = ''; $('#reelshort-category-filter').value = ''; clearCredentials(); preventSilentCredentialAccess(); message();
});
