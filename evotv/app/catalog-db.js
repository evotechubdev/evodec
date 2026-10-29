const DB_NAME = 'evotv-catalogo-offline';
const DB_VERSION = 2;
const STATE_KEY = 'catalog';
const DB_OPEN_TIMEOUT_MS = 2_000;

const timeoutAfter = (milliseconds, message) => new Promise((_, reject) => {
  setTimeout(() => reject(new Error(message)), milliseconds);
});

const requestResult = (request) => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error || new Error('Falha no banco local.'));
});

const transactionDone = (transaction) => new Promise((resolve, reject) => {
  transaction.oncomplete = () => resolve();
  transaction.onerror = () => reject(transaction.error || new Error('Falha na transação local.'));
  transaction.onabort = () => reject(transaction.error || new Error('Transação local cancelada.'));
});

async function openCatalogDb() {
  const request = indexedDB.open(DB_NAME, DB_VERSION);
  request.onupgradeneeded = () => {
    const db = request.result;
    if (!db.objectStoreNames.contains('state')) db.createObjectStore('state', { keyPath: 'key' });
    if (db.objectStoreNames.contains('backups')) db.deleteObjectStore('backups');
  };
  return requestResult(request);
}

async function availableCatalogDb() {
  try {
    return await Promise.race([
      openCatalogDb(),
      timeoutAfter(DB_OPEN_TIMEOUT_MS, 'Armazenamento local indisponível.'),
    ]);
  } catch { return null; }
}

async function bundledCatalog() {
  const response = await fetch('./data/catalogo-offline.json', { cache: 'no-cache' });
  if (!response.ok) throw new Error(`Catálogo incorporado indisponível (${response.status}).`);
  return validateCatalog(await response.json());
}

async function saveCatalog(catalog) {
  const db = await availableCatalogDb();
  if (!db) return;
  const transaction = db.transaction('state', 'readwrite');
  const done = transactionDone(transaction);
  transaction.objectStore('state').put({ key: STATE_KEY, catalog, savedAt: new Date().toISOString() });
  await done;
  db.close();
}

export async function currentCatalog() {
  try {
    const db = await availableCatalogDb();
    if (!db) throw new Error('Armazenamento local indisponível.');
    const transaction = db.transaction('state', 'readonly');
    const done = transactionDone(transaction);
    const stored = await requestResult(transaction.objectStore('state').get(STATE_KEY));
    await done;
    db.close();
    if (stored?.catalog) return validateCatalog(stored.catalog);
  } catch { /* O catálogo incorporado mantém a aplicação funcional. */ }
  const initial = await bundledCatalog();
  void saveCatalog(initial).catch(() => {});
  return initial;
}

export function validateCatalog(value) {
  if (!value || typeof value !== 'object' || !Array.isArray(value.items) || !Array.isArray(value.patterns)) {
    throw new Error('O arquivo não possui o formato de catálogo offline esperado.');
  }
  const ids = new Set();
  for (const item of value.items) {
    const id = String(item?.stream_id || '');
    if (!/^\d+$/.test(id) || ids.has(id)) throw new Error('O catálogo possui identificadores inválidos ou duplicados.');
    ids.add(id);
  }
  return value;
}

export function normalized(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');
}
