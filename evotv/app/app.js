import { currentCatalog, normalized } from './catalog-db.js';

const PAGE_SIZE = 45;
const BACKEND_BASE_URL = 'https://multimideas-evo-backend-app.onrender.com';
const TICKET_TIMEOUT_MS = 45_000;
let storedView = 'grid';
try { storedView = localStorage.getItem('evotv-catalog-view') === 'list' ? 'list' : 'grid'; } catch { /* armazenamento opcional */ }
const state = {
  catalog: null,
  filtered: [],
  visible: PAGE_SIZE,
  selected: null,
  candidateIndex: 0,
  ticketController: null,
  playbackAttempt: 0,
  view: storedView,
};
const elements = {
  search: document.querySelector('#catalog-search'),
  category: document.querySelector('#category-filter'),
  categoryStrip: document.querySelector('#category-strip'),
  grid: document.querySelector('#catalog-grid'),
  count: document.querySelector('#catalog-count'),
  status: document.querySelector('#app-status'),
  sentinel: document.querySelector('#load-sentinel'),
  loadMore: document.querySelector('#load-more'),
  modal: document.querySelector('#media-modal'),
  modalTitle: document.querySelector('#media-title'),
  modalMeta: document.querySelector('#media-meta'),
  modalImage: document.querySelector('#media-image'),
  video: document.querySelector('#media-player'),
  playerMessage: document.querySelector('#player-message'),
  play: document.querySelector('#play-media'),
  close: document.querySelector('#close-modal'),
  viewButtons: [...document.querySelectorAll('[data-view]')],
};

const safeImage = (value) => {
  try {
    const url = new URL(String(value || ''), location.href);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
  } catch { return ''; }
};

const mediaCandidates = (item) => {
  const candidates = [];
  if (item.url_final) candidates.push(item.url_final);
  const extension = String(item.container_extension || 'mp4').replace(/[^a-z0-9]/gi, '') || 'mp4';
  const id = String(item.stream_id || '');
  const patterns = [...state.catalog.patterns].sort((left, right) => {
    if (left.id === item.url_padrao) return -1;
    if (right.id === item.url_padrao) return 1;
    return Number(right.count || 0) - Number(left.count || 0);
  });
  for (const pattern of patterns) {
    if (!pattern.template.includes('{id}')) continue;
    const url = pattern.template.replaceAll('{id}', id).replaceAll('{ext}', extension);
    if (!candidates.includes(url)) candidates.push(url);
  }
  return candidates;
};

function applyFilters() {
  if (!state.catalog) return;
  const query = normalized(elements.search.value.trim());
  const category = elements.category.value;
  state.filtered = state.catalog.items.filter((item) =>
    (!query || normalized(item.name).includes(query))
    && (!category || String(item.category_id || '') === category));
  state.visible = PAGE_SIZE;
  elements.categoryStrip.querySelectorAll('[data-category]').forEach((button) => {
    button.classList.toggle('active', button.dataset.category === category);
  });
  renderGrid();
}

function renderGrid() {
  const items = state.filtered.slice(0, state.visible);
  elements.grid.classList.toggle('list-view', state.view === 'list');
  elements.grid.replaceChildren(...items.map((item) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'catalog-card';
    button.setAttribute('aria-label', `Abrir ${item.name || 'filme'}`);
    button.addEventListener('click', () => openItem(item));
    const poster = document.createElement('span');
    poster.className = 'catalog-poster';
    const image = document.createElement('img');
    image.loading = 'lazy';
    image.decoding = 'async';
    image.alt = '';
    image.src = safeImage(item.stream_icon) || './assets/poster-placeholder.svg';
    image.addEventListener('error', () => { image.src = './assets/poster-placeholder.svg'; }, { once: true });
    const play = document.createElement('span');
    play.className = 'poster-play';
    poster.append(image, play);
    const copy = document.createElement('span');
    copy.className = 'catalog-card-copy';
    const title = document.createElement('strong');
    title.textContent = item.name || 'Sem título';
    const meta = document.createElement('small');
    meta.textContent = item.category_name || 'Filme';
    copy.append(title, meta);
    button.append(poster, copy);
    return button;
  }));
  elements.count.textContent = `${items.length.toLocaleString('pt-BR')} de ${state.filtered.length.toLocaleString('pt-BR')} filmes`;
  elements.sentinel.hidden = true;
  elements.loadMore.hidden = true;
}

function openItem(item) {
  stopPlayback();
  state.selected = item;
  state.candidateIndex = 0;
  elements.modalTitle.textContent = item.name || 'Sem título';
  elements.modalMeta.textContent = `${item.category_name || 'Filme'} · ${String(item.container_extension || 'mp4').toUpperCase()}`;
  elements.modalImage.src = safeImage(item.stream_icon) || './assets/poster-placeholder.svg';
  elements.playerMessage.textContent = 'Pronto para abrir a mídia pela conexão HTTPS protegida.';
  elements.video.removeAttribute('src');
  elements.video.load();
  elements.video.hidden = true;
  elements.play.hidden = false;
  elements.modal.showModal();
}

function stopPlayback() {
  state.playbackAttempt += 1;
  state.ticketController?.abort();
  state.ticketController = null;
  elements.video.pause();
  elements.video.removeAttribute('src');
  elements.video.load();
}

async function tryCandidate() {
  if (!state.selected) return;
  stopPlayback();
  const attempt = state.playbackAttempt;
  const candidates = mediaCandidates(state.selected);
  const source = candidates[state.candidateIndex];
  if (!source) {
    elements.playerMessage.textContent = 'Nenhum dos endereços disponíveis respondeu neste navegador.';
    elements.video.hidden = true;
    elements.play.hidden = false;
    return;
  }
  elements.playerMessage.textContent = 'Solicitando reprodução HTTPS segura…';
  elements.play.hidden = true;
  const controller = new AbortController();
  state.ticketController = controller;
  const timer = window.setTimeout(() => controller.abort(), TICKET_TIMEOUT_MS);
  try {
    const response = await fetch(`${BACKEND_BASE_URL}/api/media-ticket`, {
      method: 'POST',
      mode: 'cors',
      credentials: 'omit',
      cache: 'no-store',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ target: source }),
      signal: controller.signal,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(String(data?.code || `HTTP_${response.status}`));
    if (attempt !== state.playbackAttempt) return;
    const playbackUrl = new URL(String(data?.playbackUrl || ''));
    if (playbackUrl.protocol !== 'https:') throw new Error('INVALID_PLAYBACK_URL');
    state.ticketController = null;
    elements.playerMessage.textContent = 'Preparando mídia pelo Cloudflare…';
    elements.video.crossOrigin = 'anonymous';
    elements.video.hidden = false;
    elements.video.src = playbackUrl.href;
    elements.video.load();
    void elements.video.play().catch(() => {});
  } catch (error) {
    if (attempt !== state.playbackAttempt) return;
    state.ticketController = null;
    elements.video.hidden = true;
    elements.play.hidden = false;
    const aborted = error instanceof DOMException && error.name === 'AbortError';
    const code = error instanceof Error ? error.message : 'UNKNOWN';
    elements.playerMessage.textContent = aborted
      ? 'O serviço demorou para responder. Tente novamente.'
      : `O serviço HTTPS ainda não conseguiu preparar esta mídia (${code}).`;
  } finally {
    window.clearTimeout(timer);
  }
}

elements.video.addEventListener('playing', () => {
  elements.playerMessage.textContent = 'Reproduzindo por HTTPS seguro.';
  elements.play.hidden = true;
});
elements.video.addEventListener('canplay', () => {
  void elements.video.play().catch(() => {
    elements.playerMessage.textContent = 'Mídia pronta. Pressione o botão de reprodução do player.';
  });
});
elements.video.addEventListener('error', () => {
  state.candidateIndex += 1;
  void tryCandidate();
});
elements.play.addEventListener('click', () => { void tryCandidate(); });
elements.close.addEventListener('click', () => elements.modal.close());
elements.modal.addEventListener('close', () => {
  stopPlayback();
});
elements.search.addEventListener('input', applyFilters);
elements.category.addEventListener('change', applyFilters);
elements.viewButtons.forEach((button) => {
  button.classList.toggle('active', button.dataset.view === state.view);
  button.addEventListener('click', () => {
    state.view = button.dataset.view === 'list' ? 'list' : 'grid';
    try { localStorage.setItem('evotv-catalog-view', state.view); } catch { /* armazenamento opcional */ }
    elements.viewButtons.forEach((item) => item.classList.toggle('active', item === button));
    renderGrid();
  });
});
elements.categoryStrip.addEventListener('wheel', (event) => {
  if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
  event.preventDefault();
  elements.categoryStrip.scrollLeft += event.deltaY;
}, { passive: false });
elements.loadMore.addEventListener('click', () => {
  state.visible += PAGE_SIZE;
  renderGrid();
});
elements.grid.addEventListener('scroll', () => {
  if (state.visible >= state.filtered.length) return;
  if (elements.grid.scrollTop + elements.grid.clientHeight >= elements.grid.scrollHeight - 700) {
    state.visible += PAGE_SIZE;
    renderGrid();
  }
});

async function start() {
  try {
    elements.status.textContent = 'Abrindo armazenamento local…';
    state.catalog = await currentCatalog();
    elements.status.textContent = 'Preparando filtros e categorias…';
    const categories = [...state.catalog.categories].sort((left, right) =>
      String(left.category_name || '').localeCompare(String(right.category_name || ''), 'pt-BR'));
    elements.category.append(...categories.map((category) => {
      const option = document.createElement('option');
      option.value = String(category.category_id || '');
      option.textContent = category.category_name || 'Sem nome';
      return option;
    }));
    elements.categoryStrip.replaceChildren(...[
      { category_id: '', category_name: 'Todos' },
      ...categories,
    ].map((category) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `pc-category-button${String(category.category_id || '') === elements.category.value ? ' active' : ''}`;
      button.dataset.category = String(category.category_id || '');
      button.textContent = category.category_name || 'Sem nome';
      button.addEventListener('click', () => {
        elements.category.value = button.dataset.category;
        applyFilters();
      });
      return button;
    }));
    elements.status.textContent = `Snapshot ${new Date(state.catalog.generatedAt).toLocaleString('pt-BR')} · ${state.catalog.patterns.length} padrões`;
    applyFilters();
  } catch (error) {
    elements.status.textContent = error instanceof Error ? error.message : 'Não foi possível abrir o catálogo offline.';
    elements.status.classList.add('error');
  }
}

if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
void start();
