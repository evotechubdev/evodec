const DB_NAME = 'evotv-catalogo-offline';
const DB_VERSION = 1;
const STATE_KEY = 'catalog';
const MAX_BACKUPS = 5;
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

export async function openCatalogDb() {
  const request = indexedDB.open(DB_NAME, DB_VERSION);
  request.onupgradeneeded = () => {
    const db = request.result;
    if (!db.objectStoreNames.contains('state')) db.createObjectStore('state', { keyPath: 'key' });
    if (!db.objectStoreNames.contains('backups')) db.createObjectStore('backups', { keyPath: 'id', autoIncrement: true });
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

export async function bundledCatalog() {
  const response = await fetch('./data/catalogo-offline.json', { cache: 'no-cache' });
  if (!response.ok) throw new Error(`Catálogo incorporado indisponível (${response.status}).`);
  return validateCatalog(await response.json());
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

export async function saveCatalog(catalog) {
  const validated = validateCatalog(catalog);
  const db = await availableCatalogDb();
  if (!db) return validated;
  const transaction = db.transaction('state', 'readwrite');
  const done = transactionDone(transaction);
  transaction.objectStore('state').put({ key: STATE_KEY, catalog: validated, savedAt: new Date().toISOString() });
  await done;
  db.close();
  return validated;
}

export async function backupCatalog(catalog, reason = 'Sincronização manual') {
  const validated = validateCatalog(catalog);
  const createdAt = new Date().toISOString();
  const db = await availableCatalogDb();
  if (!db) return { id: null, createdAt, reason, itemCount: validated.items.length, catalog: validated, volatile: true };
  const transaction = db.transaction('backups', 'readwrite');
  const done = transactionDone(transaction);
  const store = transaction.objectStore('backups');
  store.add({
    createdAt,
    reason,
    itemCount: validated.items.length,
    catalog: validated,
  });
  await done;

  const readTransaction = db.transaction('backups', 'readonly');
  const readDone = transactionDone(readTransaction);
  const backups = await requestResult(readTransaction.objectStore('backups').getAll());
  await readDone;
  const obsolete = backups.sort((left, right) => right.id - left.id).slice(MAX_BACKUPS);
  if (obsolete.length) {
    const deleteTransaction = db.transaction('backups', 'readwrite');
    const deleteDone = transactionDone(deleteTransaction);
    for (const backup of obsolete) deleteTransaction.objectStore('backups').delete(backup.id);
    await deleteDone;
  }
  db.close();
  return backups.sort((left, right) => right.id - left.id)[0];
}

export async function listBackups() {
  const db = await availableCatalogDb();
  if (!db) return [];
  const transaction = db.transaction('backups', 'readonly');
  const done = transactionDone(transaction);
  const backups = await requestResult(transaction.objectStore('backups').getAll());
  await done;
  db.close();
  return backups.sort((left, right) => right.id - left.id).map(({ catalog, ...metadata }) => metadata);
}

export async function backupById(id) {
  const db = await availableCatalogDb();
  if (!db) return null;
  const transaction = db.transaction('backups', 'readonly');
  const done = transactionDone(transaction);
  const backup = await requestResult(transaction.objectStore('backups').get(Number(id)));
  await done;
  db.close();
  return backup || null;
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

export function downloadJson(value, filename) {
  const blob = new Blob([`${JSON.stringify(value, null, 2)}\n`], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export function timestampFilename(prefix) {
  return `${prefix}-${new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_')}.json`;
}

export function normalized(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');
}
