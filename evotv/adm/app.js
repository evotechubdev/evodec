const FIREBASE_API_KEY = 'AIzaSyDbSMFXN6pmkqfhtBm3no2bXoAbyT_FoAo';
const LOGIN_DOMAIN = 'evotv.com.br';
const BACKEND = 'https://multimideas-evo-backend.onrender.com';
const MODULE_LOADERS = { 'home-news': loadNewsModule };
const $ = selector => document.querySelector(selector);
let token = '';
let items = [];
let modules = [];

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
function blank() { return { id: `novidade-${items.length + 1}`, title: '', cardImage: '', featureImage: '', information: '' }; }
function render() {
  const root = $('#cards'); root.replaceChildren();
  items.forEach((item, index) => {
    const node = $('#card-template').content.firstElementChild.cloneNode(true);
    node.querySelector('strong').textContent = `Card ${index + 1}`;
    for (const input of node.querySelectorAll('[data-field]')) {
      const field = input.dataset.field; input.value = item[field] || '';
      input.addEventListener('input', () => {
        item[field] = input.value;
        if (field === 'title' && !item.idEdited) { item.id = slug(input.value) || `novidade-${index + 1}`; node.querySelector('[data-field="id"]').value = item.id; }
        if (field === 'id') item.idEdited = true;
        if (field === 'cardImage' || field === 'featureImage') node.querySelector(`[data-preview="${field}"]`).src = input.value;
      });
    }
    for (const image of node.querySelectorAll('[data-preview]')) image.src = item[image.dataset.preview] || '';
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
  $('#editor-panel').hidden = true;
  const data = await request('/api/admin/news');
  items = Array.isArray(data.items) && data.items.length ? data.items.map(item => ({ ...item })) : [blank()];
  $('#page-title').textContent = 'Novidades da Home';
  $('#editor-panel').hidden = false;
  render();
}
async function openModule(moduleId) {
  const module = modules.find(item => item.id === moduleId);
  const loader = MODULE_LOADERS[moduleId];
  if (!module || !loader) throw new Error('Módulo indisponível para esta conta.');
  $('#module-select').value = moduleId;
  await loader();
}

$('#login-form').addEventListener('submit', async event => {
  event.preventDefault(); const button = event.submitter; button.disabled = true; button.textContent = 'Entrando...';
  try {
    const selectedModule = $('#login-module').value;
    const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FIREBASE_API_KEY}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: loginEmail($('#login').value), password: $('#password').value, returnSecureToken: true }) });
    const auth = await response.json();
    if (!response.ok) throw new Error('Login, senha ou autorização administrativa inválidos.');
    token = auth.idToken;
    const access = await request('/api/admin/modules'); modules = Array.isArray(access.modules) ? access.modules : [];
    if (!modules.some(module => module.id === selectedModule)) throw new Error('Este login não possui acesso ao módulo selecionado.');
    const select = $('#module-select'); select.replaceChildren(...modules.map(module => { const option = document.createElement('option'); option.value = module.id; option.textContent = module.name; return option; }));
    document.body.classList.add('authenticated'); $('#login-panel').hidden = true; $('#module-panel').hidden = false; $('#logout').hidden = false;
    await openModule(selectedModule);
  } catch (error) { token = ''; modules = []; alert(error.message); }
  finally { button.disabled = false; button.textContent = 'Acessar painel'; }
});
$('#module-select').addEventListener('change', event => openModule(event.target.value).catch(error => alert(error.message)));
$('#show-password').addEventListener('change', event => { $('#password').type = event.target.checked ? 'text' : 'password'; });
$('#add-card').addEventListener('click', () => { if (items.length < 5) { items.push(blank()); render(); } });
$('#publish').addEventListener('click', async () => {
  const button = $('#publish'); button.disabled = true; message('Publicando...');
  try {
    const payload = items.map(({ id, title, cardImage, featureImage, information }) => ({ id: slug(id), title: title.trim(), cardImage: cardImage.trim(), featureImage: featureImage.trim(), information: information.trim() }));
    const data = await request('/api/admin/news', { method: 'POST', body: JSON.stringify({ items: payload }) });
    items = data.items.map(item => ({ ...item })); render(); message('Novidades publicadas com sucesso.', 'success');
  } catch (error) { message(error.message, 'error'); }
  finally { button.disabled = false; }
});
$('#logout').addEventListener('click', () => {
  token = ''; items = []; modules = []; document.body.classList.remove('authenticated'); $('#editor-panel').hidden = true; $('#module-panel').hidden = true; $('#logout').hidden = true; $('#login-panel').hidden = false; $('#page-title').textContent = 'Central de Módulos'; $('#password').value = ''; $('#password').type = 'password'; $('#show-password').checked = false; message();
});
