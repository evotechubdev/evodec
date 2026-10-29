import {
  backupById,
  backupCatalog,
  bundledCatalog,
  currentCatalog,
  downloadJson,
  listBackups,
  saveCatalog,
  timestampFilename,
  validateCatalog,
} from './catalog-db.js';

const state = { catalog: null, comparison: null, syncing: false };
const elements = {
  status: document.querySelector('#admin-status'),
  form: document.querySelector('#sync-form'),
  server: document.querySelector('#provider-server'),
  login: document.querySelector('#provider-login'),
  password: document.querySelector('#provider-password'),
  compare: document.querySelector('#compare-catalog'),
  apply: document.querySelector('#apply-sync'),
  comparison: document.querySelector('#comparison-result'),
  progress: document.querySelector('#sync-progress'),
  progressText: document.querySelector('#sync-progress-text'),
  export: document.querySelector('#export-catalog'),
  importInput: document.querySelector('#import-catalog'),
  reset: document.querySelector('#reset-bundled'),
  backups: document.querySelector('#backup-list'),
  currentSummary: document.querySelector('#current-summary'),
};

const providerRequest = async (server, login, password, action) => {
  const url = new URL('/player_api.php', server);
  url.searchParams.set('username', login);
  url.searchParams.set('password', password);
  url.searchParams.set('action', action);
  const response = await fetch(url, {
    headers: { accept: 'application/json' },
    cache: 'no-store',
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`O provedor respondeu ${response.status} ao consultar ${action}.`);
  const data = await response.json();
  if (!Array.isArray(data)) throw new Error(`A resposta ${action} não contém uma lista.`);
  return data;
};

const cleanExtension = (item) => String(item?.container_extension || 'mp4').replace(/[^a-z0-9]/gi, '').slice(0, 8) || 'mp4';

const normalizePattern = (url, id, extension) => {
  const segments = url.pathname.split('/');
  const filename = segments.at(-1) || '';
  const suffix = `.${extension}`;
  const stem = filename.toLowerCase().endsWith(suffix.toLowerCase()) ? filename.slice(0, -suffix.length) : filename;
  let parent = segments.at(-2) || '';
  try { parent = decodeURIComponent(parent); } catch { /* Mantém o valor original. */ }
  let decodedStem = stem;
  try { decodedStem = decodeURIComponent(stem); } catch { /* Mantém o valor original. */ }
  if (stem === id) segments[segments.length - 1] = '{id}.{ext}';
  else if (parent === decodedStem) {
    segments[segments.length - 2] = '{slug}';
    segments[segments.length - 1] = '{slug}.{ext}';
  } else segments[segments.length - 1] = '{filename}.{ext}';
  return `${url.protocol}//${url.host}${segments.join('/')}`;
};

const credentialFree = (url, login, password) => {
  let decoded = url.href;
  try { decoded = decodeURIComponent(url.href); } catch { /* Mantém codificada. */ }
  return ![login, password].some((secret) => secret && (decoded.includes(secret) || url.href.includes(encodeURIComponent(secret))));
};

const resolveFinalUrl = async (server, login, password, item) => {
  const id = String(item.stream_id || '');
  const extension = cleanExtension(item);
  const source = new URL(`/movie/${encodeURIComponent(login)}/${encodeURIComponent(password)}/${id}.${extension}`, server);
  const response = await fetch(source, {
    method: 'GET',
    headers: { accept: '*/*', 'accept-encoding': 'identity', range: 'bytes=0-0' },
    redirect: 'follow',
    cache: 'no-store',
    signal: AbortSignal.timeout(30_000),
  });
  await response.body?.cancel();
  const target = new URL(response.url);
  if (!response.ok || !['http:', 'https:'].includes(target.protocol) || target.username || target.password || !credentialFree(target, login, password)) {
    throw new Error(`Não resolvido (${response.status || 0}).`);
  }
  return { url: target.href, pattern: normalizePattern(target, id, extension) };
};

function renderCurrent() {
  elements.currentSummary.textContent = `${state.catalog.items.length.toLocaleString('pt-BR')} mídias · ${state.catalog.patterns.length} padrões · atualizado em ${new Date(state.catalog.generatedAt).toLocaleString('pt-BR')}`;
}

async function renderBackups() {
  const backups = await listBackups();
  elements.backups.replaceChildren(...(backups.length ? backups.map((backup) => {
    const row = document.createElement('li');
    const copy = document.createElement('span');
    copy.textContent = `${new Date(backup.createdAt).toLocaleString('pt-BR')} · ${backup.itemCount.toLocaleString('pt-BR')} itens · ${backup.reason}`;
    const actions = document.createElement('span');
    actions.className = 'backup-actions';
    const download = document.createElement('button');
    download.type = 'button';
    download.textContent = 'Baixar';
    download.addEventListener('click', async () => {
      const full = await backupById(backup.id);
      if (full) downloadJson(full.catalog, timestampFilename('backup-catalogo'));
    });
    const restore = document.createElement('button');
    restore.type = 'button';
    restore.textContent = 'Restaurar';
    restore.addEventListener('click', async () => {
      const full = await backupById(backup.id);
      if (!full || !confirm('Restaurar este backup e substituir o catálogo local atual?')) return;
      await backupCatalog(state.catalog, 'Antes de restaurar backup');
      state.catalog = await saveCatalog(full.catalog);
      renderCurrent();
      await renderBackups();
      elements.status.textContent = 'Backup restaurado.';
    });
    actions.append(download, restore);
    row.append(copy, actions);
    return row;
  }) : [Object.assign(document.createElement('li'), { textContent: 'Nenhum backup local criado.' })]));
}

async function compareCatalog(event) {
  event.preventDefault();
  if (state.syncing) return;
  const server = elements.server.value.trim().replace(/\/+$/, '');
  const login = elements.login.value.trim();
  const password = elements.password.value;
  if (!server || !login || !password) {
    elements.status.textContent = 'Informe servidor, login e senha.';
    return;
  }
  state.syncing = true;
  elements.compare.disabled = true;
  elements.status.textContent = 'Consultando o catálogo atual…';
  try {
    const [items, categories] = await Promise.all([
      providerRequest(server, login, password, 'get_vod_streams'),
      providerRequest(server, login, password, 'get_vod_categories'),
    ]);
    const offlineIds = new Set(state.catalog.items.map((item) => String(item.stream_id)));
    const missing = items.filter((item) => /^\d+$/.test(String(item?.stream_id || '')) && !offlineIds.has(String(item.stream_id)));
    state.comparison = { server, login, password, items, categories, missing };
    elements.comparison.textContent = `Atual: ${items.length.toLocaleString('pt-BR')} · Offline: ${state.catalog.items.length.toLocaleString('pt-BR')} · Novos: ${missing.length.toLocaleString('pt-BR')}`;
    elements.apply.disabled = missing.length === 0;
    elements.status.textContent = missing.length ? 'Comparação concluída. Revise e aplique a sincronização.' : 'O catálogo offline já contém todos os itens atuais.';
  } catch (error) {
    state.comparison = null;
    elements.apply.disabled = true;
    elements.status.textContent = error instanceof Error ? error.message : 'Falha ao comparar catálogos.';
  } finally {
    state.syncing = false;
    elements.compare.disabled = false;
  }
}

async function applySync() {
  if (state.syncing || !state.comparison?.missing.length) return;
  state.syncing = true;
  elements.apply.disabled = true;
  const { server, login, password, missing, categories } = state.comparison;
  try {
    const backup = await backupCatalog(state.catalog, 'Antes da sincronização manual');
    downloadJson(backup.catalog, timestampFilename('backup-catalogo'));
    const categoryNames = new Map(categories.map((category) => [String(category.category_id || ''), String(category.category_name || '')]));
    const patterns = state.catalog.patterns.map((pattern) => ({ ...pattern }));
    const patternByTemplate = new Map(patterns.map((pattern) => [pattern.template, pattern]));
    const additions = [];
    const ignored = [];
    elements.progress.hidden = false;
    for (let index = 0; index < missing.length; index += 1) {
      const item = missing[index];
      elements.progress.value = index;
      elements.progress.max = missing.length;
      elements.progressText.textContent = `Resolvendo ${index + 1} de ${missing.length}: ${item.name || item.stream_id}`;
      try {
        const resolved = await resolveFinalUrl(server, login, password, item);
        let pattern = patternByTemplate.get(resolved.pattern);
        if (!pattern) {
          pattern = { id: Math.max(0, ...patterns.map((entry) => Number(entry.id) || 0)) + 1, template: resolved.pattern, count: 0 };
          patterns.push(pattern);
          patternByTemplate.set(pattern.template, pattern);
        }
        additions.push({
          ...item,
          category_name: categoryNames.get(String(item.category_id || '')) || '',
          url_padrao: pattern.id,
          url_final: resolved.url,
        });
      } catch (error) {
        ignored.push({
          stream_id: String(item.stream_id || ''),
          name: String(item.name || ''),
          category_id: String(item.category_id || ''),
          category_name: categoryNames.get(String(item.category_id || '')) || '',
          container_extension: cleanExtension(item),
          reason: error instanceof Error ? error.message : 'UNRESOLVED',
        });
      }
    }
    const allItems = [...state.catalog.items, ...additions];
    const counts = new Map();
    for (const item of allItems) counts.set(Number(item.url_padrao), (counts.get(Number(item.url_padrao)) || 0) + 1);
    for (const pattern of patterns) pattern.count = counts.get(Number(pattern.id)) || 0;
    const updated = {
      ...state.catalog,
      generatedAt: new Date().toISOString(),
      source: { totalFromGet: state.comparison.items.length, availableOffline: allItems.length, ignored: [...(state.catalog.ignored || []), ...ignored].length },
      patterns: patterns.sort((left, right) => Number(left.id) - Number(right.id)),
      categories,
      ignored: [...(state.catalog.ignored || []), ...ignored],
      items: allItems,
    };
    state.catalog = await saveCatalog(updated);
    downloadJson(updated, timestampFilename('catalogo-offline-atualizado'));
    elements.progress.value = missing.length;
    elements.progressText.textContent = `Concluído: ${additions.length} adicionados, ${ignored.length} ignorados.`;
    elements.status.textContent = 'Sincronização aplicada. O catálogo anterior foi salvo como backup.';
    state.comparison = null;
    elements.comparison.textContent = '';
    elements.login.value = '';
    elements.password.value = '';
    renderCurrent();
    await renderBackups();
  } catch (error) {
    elements.status.textContent = error instanceof Error ? error.message : 'Não foi possível aplicar a sincronização.';
  } finally {
    state.syncing = false;
  }
}

elements.form.addEventListener('submit', compareCatalog);
elements.apply.addEventListener('click', applySync);
elements.export.addEventListener('click', () => downloadJson(state.catalog, timestampFilename('catalogo-offline')));
elements.importInput.addEventListener('change', async () => {
  const file = elements.importInput.files?.[0];
  if (!file) return;
  try {
    const imported = validateCatalog(JSON.parse(await file.text()));
    const backup = await backupCatalog(state.catalog, 'Antes da importação manual');
    if (backup.volatile) downloadJson(backup.catalog, timestampFilename('backup-catalogo'));
    state.catalog = await saveCatalog(imported);
    renderCurrent();
    await renderBackups();
    elements.status.textContent = 'Catálogo importado; a versão anterior foi preservada em backup.';
  } catch (error) {
    elements.status.textContent = error instanceof Error ? error.message : 'Arquivo inválido.';
  } finally {
    elements.importInput.value = '';
  }
});
elements.reset.addEventListener('click', async () => {
  if (!confirm('Restaurar o catálogo incorporado ao PWA? O estado atual será preservado em backup.')) return;
  const backup = await backupCatalog(state.catalog, 'Antes de restaurar catálogo incorporado');
  if (backup.volatile) downloadJson(backup.catalog, timestampFilename('backup-catalogo'));
  state.catalog = await saveCatalog(await bundledCatalog());
  renderCurrent();
  await renderBackups();
  elements.status.textContent = 'Catálogo incorporado restaurado.';
});

async function start() {
  try {
    state.catalog = await currentCatalog();
    renderCurrent();
    elements.status.textContent = 'Administração pronta. As credenciais são usadas somente em memória durante a consulta.';
    void renderBackups().catch(() => {
      elements.backups.replaceChildren(Object.assign(document.createElement('li'), { textContent: 'Backups locais indisponíveis neste navegador; a exportação em arquivo continuará disponível.' }));
    });
  } catch (error) {
    elements.status.textContent = error instanceof Error ? error.message : 'Falha ao abrir o catálogo local.';
  }
}

void start();
