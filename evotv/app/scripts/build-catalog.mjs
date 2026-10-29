import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const options = Object.fromEntries(process.argv.slice(2).map((argument) => {
  const separator = argument.indexOf('=');
  return separator > 2
    ? [argument.slice(2, separator), argument.slice(separator + 1)]
    : [argument.replace(/^--/, ''), ''];
}));

const server = new URL(options.server || 'http://p.xvply.net');
const credentialsPath = options.credentials;
const directCatalogPath = resolve(options.direct || 'evotv/pwa/data/vod-direct-catalog.json');
const rawOutputPath = resolve(options.raw || 'evotv/app/data/catalogo-get-completo.json');
const offlineOutputPath = resolve(options.output || 'evotv/app/data/catalogo-offline.json');

if (!credentialsPath) throw new Error('Informe --credentials=<arquivo>.');
if (!['http:', 'https:'].includes(server.protocol) || server.username || server.password) throw new Error('Servidor inválido.');

const credentialText = await readFile(credentialsPath, 'utf8');
const credentials = Object.fromEntries(
  credentialText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
    const match = /^([^:=]+)\s*[:=]\s*(.+)$/.exec(line);
    return match ? [match[1].trim().toLowerCase(), match[2].trim()] : ['', ''];
  }).filter(([key, value]) => key && value),
);
const username = credentials.login || credentials.username || credentials.user;
const password = credentials.senha || credentials.password || credentials.pass;
if (!username || !password) throw new Error('Credenciais rotuladas não encontradas.');

const providerJson = async (action) => {
  const url = new URL('/player_api.php', server);
  url.searchParams.set('username', username);
  url.searchParams.set('password', password);
  url.searchParams.set('action', action);
  const response = await fetch(url, {
    headers: { accept: 'application/json', 'user-agent': 'EvoOfflineCatalogBuilder/1.0' },
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`GET ${action} falhou (${response.status}).`);
  const data = await response.json();
  if (!Array.isArray(data)) throw new Error(`GET ${action} não retornou uma lista.`);
  return data;
};

const [rawCatalog, categories, directCatalog] = await Promise.all([
  providerJson('get_vod_streams'),
  providerJson('get_vod_categories'),
  readFile(directCatalogPath, 'utf8').then(JSON.parse),
]);
const categoryNames = new Map(categories.map((category) => [
  String(category?.category_id || ''),
  String(category?.category_name || ''),
]));
const patterns = directCatalog.patterns.map((pattern, index) => ({
  id: index + 1,
  template: pattern.pattern,
  count: pattern.count,
}));
const patternIds = new Map(patterns.map((pattern) => [pattern.template, pattern.id]));
const directItems = new Map(directCatalog.items.map((item) => [String(item.id), item]));

const items = rawCatalog.flatMap((raw) => {
  const id = String(raw?.stream_id || '');
  const direct = directItems.get(id);
  if (!direct) return [];
  return [{
    ...raw,
    category_name: categoryNames.get(String(raw?.category_id || '')) || direct.categoryName || '',
    url_padrao: patternIds.get(direct.pattern) || null,
    url_final: direct.url,
  }];
});
const ignored = directCatalog.failures.map((failure) => ({
  stream_id: String(failure.id),
  name: failure.name || '',
  category_id: failure.categoryId || '',
  category_name: failure.categoryName || '',
  container_extension: failure.extension || '',
  reason: failure.error || 'UNRESOLVED',
}));
const offlineCatalog = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  source: {
    totalFromGet: rawCatalog.length,
    availableOffline: items.length,
    ignored: ignored.length,
  },
  patterns,
  categories,
  ignored,
  items,
};

await Promise.all([
  mkdir(dirname(rawOutputPath), { recursive: true }),
  mkdir(dirname(offlineOutputPath), { recursive: true }),
]);
await Promise.all([
  writeFile(rawOutputPath, `${JSON.stringify(rawCatalog, null, 2)}\n`, 'utf8'),
  writeFile(offlineOutputPath, `${JSON.stringify(offlineCatalog)}\n`, 'utf8'),
]);

const containsSecret = [username, password].some((secret) =>
  JSON.stringify(offlineCatalog).includes(secret) || JSON.stringify(rawCatalog).includes(secret),
);
console.log(JSON.stringify({
  rawOutputPath,
  offlineOutputPath,
  rawItems: rawCatalog.length,
  offlineItems: items.length,
  patterns: patterns.length,
  ignored: ignored.length,
  containsSecret,
}, null, 2));
