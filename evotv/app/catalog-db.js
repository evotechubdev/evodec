const CATALOG_BACKEND_URL = 'https://multimideas-evo-backend-app.onrender.com';
const LEGACY_DB_NAME = 'evotv-catalogo-offline';

export async function currentCatalog(idToken, session) {
  if (!idToken) throw new Error('Entre no app para carregar o catÃ¡logo.');
  const response = await fetch(`${CATALOG_BACKEND_URL}/api/catalog/movies`, {
    headers: {
      authorization: `Bearer ${idToken}`, accept: 'application/json', 'x-evo-platform': 'web',
      'x-evo-session': session?.sessionToken || '', 'x-evo-profile': String(session?.profile || ''),
    },
    credentials: 'omit', cache: 'no-store',
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(String(data?.error || `CatÃ¡logo de filmes indisponÃ­vel (${response.status}).`));
  return validateCatalog(data);
}

export function clearLegacyCatalog() {
  try { indexedDB.deleteDatabase(LEGACY_DB_NAME); } catch { /* armazenamento opcional */ }
}

export function validateCatalog(value) {
  if (!value || typeof value !== 'object' || !Array.isArray(value.items) || !Array.isArray(value.patterns)) {
    throw new Error('O arquivo nÃ£o possui o formato de catÃ¡logo offline esperado.');
  }
  const ids = new Set();
  for (const item of value.items) {
    const id = String(item?.stream_id || '');
    if (!/^\d+$/.test(id) || ids.has(id)) throw new Error('O catÃ¡logo possui identificadores invÃ¡lidos ou duplicados.');
    ids.add(id);
  }
  return value;
}

export function normalized(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');
}
