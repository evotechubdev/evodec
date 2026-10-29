import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

process.on('unhandledRejection', () => {
  console.error(JSON.stringify({ error: 'Falha inesperada; nenhum dado sensível foi exibido.' }));
  process.exitCode = 1;
});

const argumentsMap = Object.fromEntries(process.argv.slice(2).map((argument) => {
  const separator = argument.indexOf('=');
  return separator > 2
    ? [argument.slice(2, separator), argument.slice(separator + 1)]
    : [argument.replace(/^--/, ''), ''];
}));

if (!argumentsMap.server) throw new Error('Informe o servidor explicitamente com --server.');
const server = new URL(argumentsMap.server);
const credentialsPath = argumentsMap.credentials;
const outputPath = resolve(argumentsMap.output || 'evotv/pwa-secundario/data/vod-direct-catalog.json');
const checkpointPath = `${outputPath}.jsonl`;
const concurrency = Math.max(1, Math.min(4, Number.parseInt(argumentsMap.concurrency || '2', 10) || 2));
const delayMs = Math.max(100, Math.min(2_000, Number.parseInt(argumentsMap.delay || '250', 10) || 250));
const limit = Math.max(0, Number.parseInt(argumentsMap.limit || '0', 10) || 0);

if (!credentialsPath) throw new Error('Informe --credentials=<arquivo>.');
if (!['http:', 'https:'].includes(server.protocol) || server.username || server.password) throw new Error('Origem inválida.');

const sleep = (milliseconds) => new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
const credentialsText = await readFile(credentialsPath, 'utf8');
const credentialEntries = Object.fromEntries(
  credentialsText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
    const match = /^([^:=]+)\s*[:=]\s*(.+)$/.exec(line);
    return match ? [match[1].trim().toLowerCase(), match[2].trim()] : ['', ''];
  }).filter(([key, value]) => key && value),
);
const username = credentialEntries.login || credentialEntries.username || credentialEntries.user;
const password = credentialEntries.senha || credentialEntries.password || credentialEntries.pass;
if (!username || !password) throw new Error('Credenciais rotuladas não encontradas.');

const providerJson = async (action) => {
  const url = new URL('/player_api.php', server);
  url.searchParams.set('username', username);
  url.searchParams.set('password', password);
  url.searchParams.set('action', action);
  const response = await fetch(url, {
    headers: { accept: 'application/json', 'user-agent': 'EvoCatalogExporter/1.0' },
    signal: AbortSignal.timeout(45_000),
  });
  if (!response.ok) throw new Error(`Catálogo indisponível (${response.status}).`);
  const data = await response.json();
  if (!Array.isArray(data)) throw new Error('Resposta de catálogo inválida.');
  return data;
};

const [catalog, categories] = await Promise.all([
  providerJson('get_vod_streams'),
  providerJson('get_vod_categories'),
]);
const categoryNames = new Map(categories.map((category) => [
  String(category?.category_id || ''),
  String(category?.category_name || ''),
]));

await mkdir(dirname(outputPath), { recursive: true });
const resolvedItems = new Map();
try {
  const checkpoint = await readFile(checkpointPath, 'utf8');
  for (const line of checkpoint.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const item = JSON.parse(line);
      if (/^\d+$/.test(String(item?.id || '')) && item?.url) resolvedItems.set(String(item.id), item);
    } catch { /* Uma linha incompleta será refeita. */ }
  }
} catch { /* Primeiro processamento. */ }

const safeTarget = (candidate) => {
  if (!['http:', 'https:'].includes(candidate.protocol) || candidate.username || candidate.password) return false;
  let decoded = candidate.href;
  try { decoded = decodeURIComponent(candidate.href); } catch { /* Permanece codificada. */ }
  return ![username, password].some((secret) =>
    decoded.includes(secret) || candidate.href.includes(encodeURIComponent(secret)),
  );
};

const normalizedPattern = (url, id, extension) => {
  const segments = url.pathname.split('/');
  const filename = segments.at(-1) || '';
  const suffix = `.${extension}`;
  const stem = filename.toLowerCase().endsWith(suffix.toLowerCase())
    ? filename.slice(0, -suffix.length)
    : filename;
  if (stem === id) {
    segments[segments.length - 1] = `{id}.{ext}`;
  } else if (segments.length > 1 && decodeURIComponent(segments.at(-2) || '') === decodeURIComponent(stem)) {
    segments[segments.length - 2] = '{slug}';
    segments[segments.length - 1] = '{slug}.{ext}';
  } else {
    segments[segments.length - 1] = '{filename}.{ext}';
  }
  return `${url.protocol}//${url.host}${segments.join('/')}`;
};

const resolveItem = async (entry) => {
  const id = String(entry?.stream_id || '');
  const extension = String(entry?.container_extension || 'mp4').replace(/[^a-z0-9]/gi, '').slice(0, 8) || 'mp4';
  const metadata = {
    id,
    name: String(entry?.name || ''),
    categoryId: String(entry?.category_id || ''),
    categoryName: categoryNames.get(String(entry?.category_id || '')) || '',
    extension,
  };
  if (!/^\d+$/.test(id)) return { ...metadata, error: 'INVALID_ID' };
  const source = new URL(`/movie/${encodeURIComponent(username)}/${encodeURIComponent(password)}/${id}.${extension}`, server);
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      let current = source;
      for (let hop = 0; hop < 5; hop += 1) {
        const response = await fetch(current, {
          headers: {
            accept: '*/*',
            'accept-encoding': 'identity',
            range: 'bytes=0-0',
            'user-agent': 'VLC/3.0.23 LibVLC/3.0.23',
          },
          redirect: 'manual',
          signal: AbortSignal.timeout(20_000),
        });
        await response.body?.cancel();
        if ([429, 500, 502, 503, 504].includes(response.status)) throw new Error('TRANSIENT');
        const location = response.headers.get('location') || '';
        if (!location) return { ...metadata, error: `HTTP_${response.status}` };
        const target = new URL(location, current);
        if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password) {
          return { ...metadata, error: 'UNSAFE_REDIRECT' };
        }
        if (safeTarget(target)) {
          return {
            ...metadata,
            url: target.href,
            pattern: normalizedPattern(target, id, extension),
          };
        }
        current = target;
      }
      return { ...metadata, error: 'REDIRECT_LIMIT' };
    } catch {
      if (attempt < 3) await sleep(attempt * 1_500);
    }
  }
  return { ...metadata, error: 'NETWORK_FAILED' };
};

const targetCatalog = limit ? catalog.slice(0, limit) : catalog;
const pending = targetCatalog.filter((entry) => !resolvedItems.has(String(entry?.stream_id || '')));
const failures = [];
let cursor = 0;
let completed = 0;
let checkpointBatch = [];

const flushCheckpoint = async () => {
  if (!checkpointBatch.length) return;
  const block = `${checkpointBatch.map((item) => JSON.stringify(item)).join('\n')}\n`;
  checkpointBatch = [];
  await appendFile(checkpointPath, block, 'utf8');
};

const worker = async () => {
  while (true) {
    const index = cursor;
    cursor += 1;
    if (index >= pending.length) return;
    const result = await resolveItem(pending[index]);
    if (result.url) {
      resolvedItems.set(result.id, result);
      checkpointBatch.push(result);
      if (checkpointBatch.length >= 50) await flushCheckpoint();
    } else {
      failures.push(result);
    }
    completed += 1;
    if (completed % 100 === 0 || completed === pending.length) {
      console.log(JSON.stringify({
        progress: completed,
        pending: pending.length,
        resolved: resolvedItems.size,
        failures: failures.length,
      }));
    }
    await sleep(delayMs);
  }
};

await Promise.all(Array.from({ length: concurrency }, () => worker()));
await flushCheckpoint();

const selectedIds = new Set(targetCatalog.map((entry) => String(entry?.stream_id || '')));
const items = [...resolvedItems.values()]
  .filter((item) => selectedIds.has(item.id))
  .sort((left, right) => Number(left.id) - Number(right.id));
const patternCounts = new Map();
const hostCounts = new Map();
for (const item of items) {
  patternCounts.set(item.pattern, (patternCounts.get(item.pattern) || 0) + 1);
  const host = new URL(item.url).host;
  hostCounts.set(host, (hostCounts.get(host) || 0) + 1);
}

const manifest = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  sourceItems: targetCatalog.length,
  resolvedItems: items.length,
  unresolvedItems: failures.length,
  hosts: [...hostCounts].sort((left, right) => right[1] - left[1]).map(([host, count]) => ({ host, count })),
  patterns: [...patternCounts].sort((left, right) => right[1] - left[1]).map(([pattern, count]) => ({ pattern, count })),
  failures,
  items,
};
const temporaryPath = `${outputPath}.tmp`;
await writeFile(temporaryPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
await rename(temporaryPath, outputPath);
console.log(JSON.stringify({
  done: true,
  output: outputPath,
  sourceItems: manifest.sourceItems,
  resolvedItems: manifest.resolvedItems,
  unresolvedItems: manifest.unresolvedItems,
  patternCount: manifest.patterns.length,
  patterns: manifest.patterns,
}, null, 2));
