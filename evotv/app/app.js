import { currentCatalog, normalized } from './catalog-db.js';

const PAGE_SIZE = 45;
const AUTO_PAGING = 'IntersectionObserver' in window;
const state = { catalog: null, filtered: [], visible: PAGE_SIZE, selected: null, candidateIndex: 0 };
const elements = {
  search: document.querySelector('#catalog-search'),
  category: document.querySelector('#category-filter'),
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
  renderGrid();
}

function renderGrid() {
  const items = state.filtered.slice(0, state.visible);
  elements.grid.replaceChildren(...items.map((item) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'catalog-card';
    button.addEventListener('click', () => openItem(item));
    const image = document.createElement('img');
    image.loading = 'lazy';
    image.alt = '';
    image.src = safeImage(item.stream_icon) || './assets/poster-placeholder.svg';
    image.addEventListener('error', () => { image.src = './assets/poster-placeholder.svg'; }, { once: true });
    const copy = document.createElement('span');
    copy.className = 'catalog-card-copy';
    const title = document.createElement('strong');
    title.textContent = item.name || 'Sem título';
    const meta = document.createElement('small');
    meta.textContent = `${item.category_name || 'Sem categoria'} · padrão ${item.url_padrao || '—'}`;
    copy.append(title, meta);
    button.append(image, copy);
    return button;
  }));
  elements.count.textContent = `${items.length.toLocaleString('pt-BR')} de ${state.filtered.length.toLocaleString('pt-BR')} filmes`;
  const finished = state.visible >= state.filtered.length;
  elements.sentinel.hidden = !AUTO_PAGING || finished;
  elements.loadMore.hidden = AUTO_PAGING || finished;
}

function openItem(item) {
  state.selected = item;
  state.candidateIndex = 0;
  elements.modalTitle.textContent = item.name || 'Sem título';
  elements.modalMeta.textContent = `${item.category_name || 'Sem categoria'} · ID ${item.stream_id} · ${String(item.container_extension || '').toUpperCase()} · padrão ${item.url_padrao || '—'}`;
  elements.modalImage.src = safeImage(item.stream_icon) || './assets/poster-placeholder.svg';
  elements.playerMessage.textContent = 'O catálogo e o endereço estão disponíveis offline. A reprodução requer acesso ao servidor de mídia.';
  elements.video.removeAttribute('src');
  elements.video.load();
  elements.video.hidden = true;
  elements.modal.showModal();
}

function tryCandidate() {
  if (!state.selected) return;
  const candidates = mediaCandidates(state.selected);
  const source = candidates[state.candidateIndex];
  if (!source) {
    elements.playerMessage.textContent = 'Nenhum dos endereços disponíveis respondeu neste navegador.';
    elements.video.hidden = true;
    return;
  }
  const url = new URL(source);
  if (location.protocol === 'https:' && url.protocol === 'http:') {
    elements.playerMessage.textContent = 'Tentando mídia HTTP. Navegadores que bloqueiam conteúdo misto exigem um proxy HTTPS.';
  } else {
    elements.playerMessage.textContent = `Tentando padrão ${state.selected.url_padrao || 'alternativo'}…`;
  }
  elements.video.hidden = false;
  elements.video.src = url.href;
  void elements.video.play().catch(() => {});
}

elements.video.addEventListener('playing', () => {
  elements.playerMessage.textContent = 'Reproduzindo pelo endereço offline salvo.';
});
elements.video.addEventListener('error', () => {
  state.candidateIndex += 1;
  tryCandidate();
});
elements.play.addEventListener('click', tryCandidate);
elements.close.addEventListener('click', () => elements.modal.close());
elements.modal.addEventListener('close', () => {
  elements.video.pause();
  elements.video.removeAttribute('src');
  elements.video.load();
});
elements.search.addEventListener('input', applyFilters);
elements.category.addEventListener('change', applyFilters);
elements.loadMore.addEventListener('click', () => {
  state.visible += PAGE_SIZE;
  renderGrid();
});
if (AUTO_PAGING) {
  const observer = new IntersectionObserver((entries) => {
    if (!entries.some((entry) => entry.isIntersecting) || state.visible >= state.filtered.length) return;
    state.visible += PAGE_SIZE;
    renderGrid();
  }, { rootMargin: '700px 0px' });
  observer.observe(elements.sentinel);
}

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
    elements.status.textContent = `Snapshot ${new Date(state.catalog.generatedAt).toLocaleString('pt-BR')} · ${state.catalog.patterns.length} padrões`;
    applyFilters();
  } catch (error) {
    elements.status.textContent = error instanceof Error ? error.message : 'Não foi possível abrir o catálogo offline.';
    elements.status.classList.add('error');
  }
}

if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
void start();
