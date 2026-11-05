const DB_NAME = 'evotv-device-vault';
const DB_VERSION = 1;
const MASTER_KEY_ID = 'device-master-key';
const AUTH_SECRET_ID = 'firebase-session';
const CREDENTIALS_SECRET_ID = 'login-credentials';

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Falha no armazenamento protegido.'));
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error('Falha no armazenamento protegido.'));
    transaction.onabort = () => reject(transaction.error || new Error('Operação de armazenamento cancelada.'));
  });
}

async function openVault() {
  if (!globalThis.indexedDB || !globalThis.crypto?.subtle) throw new Error('DEVICE_VAULT_UNAVAILABLE');
  const request = indexedDB.open(DB_NAME, DB_VERSION);
  request.onupgradeneeded = () => {
    const database = request.result;
    if (!database.objectStoreNames.contains('keys')) database.createObjectStore('keys', { keyPath: 'id' });
    if (!database.objectStoreNames.contains('secrets')) database.createObjectStore('secrets', { keyPath: 'id' });
  };
  return requestResult(request);
}

async function masterKey() {
  const database = await openVault();
  try {
    const read = database.transaction('keys', 'readonly');
    const readDone = transactionDone(read);
    const existing = await requestResult(read.objectStore('keys').get(MASTER_KEY_ID));
    await readDone;
    if (existing?.key && existing.key.type === 'secret') return existing.key;

    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    const write = database.transaction('keys', 'readwrite');
    const done = transactionDone(write);
    write.objectStore('keys').put({ id: MASTER_KEY_ID, key, createdAt: new Date().toISOString() });
    await done;
    return key;
  } finally { database.close(); }
}

async function saveSecret(id, value) {
  const key = await masterKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const clear = new TextEncoder().encode(JSON.stringify(value));
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, clear));
  const database = await openVault();
  try {
    const transaction = database.transaction('secrets', 'readwrite');
    const done = transactionDone(transaction);
    transaction.objectStore('secrets').put({ id, iv, encrypted, updatedAt: new Date().toISOString() });
    await done;
  } finally { database.close(); }
  try { await navigator.storage?.persist?.(); } catch { /* persistência é opcional */ }
}

async function readSecret(id) {
  try {
    const database = await openVault();
    let record;
    try {
      const transaction = database.transaction('secrets', 'readonly');
      const done = transactionDone(transaction);
      record = await requestResult(transaction.objectStore('secrets').get(id));
      await done;
    } finally { database.close(); }
    if (!record) return null;
    const key = await masterKey();
    const clear = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: record.iv }, key, record.encrypted);
    return JSON.parse(new TextDecoder().decode(clear));
  } catch {
    await deleteSecret(id).catch(() => {});
    return null;
  }
}

async function deleteSecret(id) {
  const database = await openVault();
  try {
    const transaction = database.transaction('secrets', 'readwrite');
    const done = transactionDone(transaction);
    transaction.objectStore('secrets').delete(id);
    await done;
  } finally { database.close(); }
}

function profileSecretId(login, profile) {
  const normalizedLogin = String(login || '').trim().toLowerCase();
  const number = Number(profile);
  if (!/^[a-z0-9._-]{1,64}$/.test(normalizedLogin) || !Number.isInteger(number) || number < 1 || number > 20) {
    throw new Error('DEVICE_PROFILE_INVALID');
  }
  return `profile-pin:${normalizedLogin}:${number}`;
}

export async function saveRememberedAuth(auth) {
  if (!auth?.login || !auth.refreshToken) throw new Error('DEVICE_AUTH_INVALID');
  await saveSecret(AUTH_SECRET_ID, { login: auth.login, refreshToken: auth.refreshToken });
}

export async function readRememberedAuth() {
  const saved = await readSecret(AUTH_SECRET_ID);
  if (!saved?.login || !saved.refreshToken) return null;
  return { login: String(saved.login), refreshToken: String(saved.refreshToken), idToken: '', expiresAt: 0 };
}

export function clearRememberedAuth() { return deleteSecret(AUTH_SECRET_ID); }

export function saveRememberedCredentials(login, password) {
  if (typeof login !== 'string' || !login.trim() || typeof password !== 'string' || !password) {
    throw new Error('DEVICE_CREDENTIALS_INVALID');
  }
  return saveSecret(CREDENTIALS_SECRET_ID, { login: login.trim(), password });
}

export async function readRememberedCredentials() {
  const saved = await readSecret(CREDENTIALS_SECRET_ID);
  if (!saved?.login || typeof saved.password !== 'string' || !saved.password) return null;
  return { login: String(saved.login), password: saved.password };
}

export function clearRememberedCredentials() { return deleteSecret(CREDENTIALS_SECRET_ID); }

export function saveProfilePin(login, profile, pin) {
  if (typeof pin !== 'string' || pin.length < 4 || pin.length > 128) throw new Error('DEVICE_PIN_INVALID');
  return saveSecret(profileSecretId(login, profile), { pin });
}

export async function readProfilePin(login, profile) {
  const saved = await readSecret(profileSecretId(login, profile));
  return typeof saved?.pin === 'string' && saved.pin.length >= 4 && saved.pin.length <= 128 ? saved.pin : '';
}

export function deleteProfilePin(login, profile) { return deleteSecret(profileSecretId(login, profile)); }

export async function clearProfilePins(login) {
  const prefix = `profile-pin:${String(login || '').trim().toLowerCase()}:`;
  const database = await openVault();
  try {
    const transaction = database.transaction('secrets', 'readwrite');
    const done = transactionDone(transaction);
    const store = transaction.objectStore('secrets');
    const cursor = store.openCursor();
    cursor.onsuccess = () => {
      const item = cursor.result;
      if (!item) return;
      if (String(item.key).startsWith(prefix)) item.delete();
      item.continue();
    };
    await done;
  } finally { database.close(); }
}
