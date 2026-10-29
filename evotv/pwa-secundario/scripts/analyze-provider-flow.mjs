import { readFile } from 'node:fs/promises';

process.on('unhandledRejection', () => {
  console.error(JSON.stringify({ error: 'Falha de rede ou resposta inválida; nenhum endereço sensível foi exibido.' }));
  process.exitCode = 1;
});
process.on('uncaughtException', () => {
  console.error(JSON.stringify({ error: 'Falha no diagnóstico; nenhum endereço sensível foi exibido.' }));
  process.exitCode = 1;
});

const options = Object.fromEntries(process.argv.slice(2).map((argument) => {
  const separator = argument.indexOf('=');
  return separator > 2
    ? [argument.slice(2, separator), argument.slice(separator + 1)]
    : [argument.replace(/^--/, ''), ''];
}));

if (!options.server) throw new Error('Informe o servidor explicitamente com --server.');
const server = new URL(options.server);
const credentialsPath = options.credentials;
const requestedId = String(options.id || '166538');

if (!credentialsPath || !/^\d+$/.test(requestedId)) {
  throw new Error('Use --credentials=<arquivo> --id=<numero> [--server=<url>].');
}
if (!['http:', 'https:'].includes(server.protocol) || server.username || server.password) {
  throw new Error('Origem inválida.');
}

const credentialText = await readFile(credentialsPath, 'utf8');
const credentialEntries = Object.fromEntries(
  credentialText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = /^([^:=]+)\s*[:=]\s*(.+)$/.exec(line);
      return match ? [match[1].trim().toLowerCase(), match[2].trim()] : ['', ''];
    })
    .filter(([key, value]) => key && value),
);
const username = credentialEntries.login || credentialEntries.username || credentialEntries.user;
const password = credentialEntries.senha || credentialEntries.password || credentialEntries.pass;
if (!username || !password) throw new Error('O arquivo precisa conter login e senha rotulados.');

const apiRequest = async (authenticated) => {
  const url = new URL('/player_api.php', server);
  if (authenticated) {
    url.searchParams.set('username', username);
    url.searchParams.set('password', password);
  }
  url.searchParams.set('action', 'get_vod_streams');
  const response = await fetch(url, {
    headers: { accept: 'application/json', 'user-agent': 'EvoFlowDiagnostic/1.0' },
    redirect: 'manual',
    signal: AbortSignal.timeout(30_000),
  });
  const body = await response.text();
  let data = null;
  try { data = JSON.parse(body); } catch { /* A resposta será descrita sem imprimir o corpo. */ }
  return { response, data, bytes: Buffer.byteLength(body) };
};

const categoryRequest = async () => {
  const url = new URL('/player_api.php', server);
  url.searchParams.set('username', username);
  url.searchParams.set('password', password);
  url.searchParams.set('action', 'get_vod_categories');
  const response = await fetch(url, {
    headers: { accept: 'application/json', 'user-agent': 'EvoFlowDiagnostic/1.0' },
    redirect: 'manual',
    signal: AbortSignal.timeout(30_000),
  });
  const body = await response.text();
  let data = null;
  try { data = JSON.parse(body); } catch { /* Somente o formato será relatado. */ }
  return Array.isArray(data) ? data : [];
};

const compactResponse = (response) => ({
  status: response.status,
  type: response.headers.get('content-type') || '',
  location: Boolean(response.headers.get('location')),
});

const unauthenticatedCatalog = await apiRequest(false);
const authenticatedCatalog = await apiRequest(true);
const categories = await categoryRequest();
const categoryNames = new Map(categories.map((category) => [
  String(category?.category_id || ''),
  String(category?.category_name || ''),
]));
const catalog = Array.isArray(authenticatedCatalog.data) ? authenticatedCatalog.data : [];
const item = catalog.find((entry) => String(entry?.stream_id || '') === requestedId);
const extension = String(item?.container_extension || 'mp4').replace(/[^a-z0-9]/gi, '').slice(0, 8) || 'mp4';
const catalogFieldCoverage = (() => {
  const fields = new Map();
  for (const entry of catalog) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    for (const [key, value] of Object.entries(entry)) {
      const current = fields.get(key) || { present: 0, nonEmpty: 0, urlValues: 0 };
      current.present += 1;
      if (value !== '' && value !== null && value !== undefined) current.nonEmpty += 1;
      if (typeof value === 'string' && /^https?:\/\//i.test(value)) current.urlValues += 1;
      fields.set(key, current);
    }
  }
  return [...fields]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([field, coverage]) => ({ field, ...coverage }));
})();

const mediaUrl = new URL(
  `/movie/${encodeURIComponent(username)}/${encodeURIComponent(password)}/${requestedId}.${extension}`,
  server,
);
const mediaResponse = await fetch(mediaUrl, {
  headers: {
    accept: '*/*',
    'accept-encoding': 'identity',
    range: 'bytes=0-0',
    'user-agent': 'VLC/3.0.23 LibVLC/3.0.23',
  },
  redirect: 'manual',
  signal: AbortSignal.timeout(30_000),
});
await mediaResponse.body?.cancel();

const locationValue = mediaResponse.headers.get('location') || '';
let finalTarget = null;
let locationSummary = { present: false };
if (locationValue) {
  const candidate = new URL(locationValue, mediaUrl);
  const decoded = (() => {
    try { return decodeURIComponent(candidate.href); } catch { return candidate.href; }
  })();
  const credentialFree = ![username, password].some((secret) =>
    decoded.includes(secret) || candidate.href.includes(encodeURIComponent(secret)),
  );
  locationSummary = {
    present: true,
    credentialFree,
    protocol: candidate.protocol,
    host: candidate.host,
    pathPattern: credentialFree
      ? candidate.pathname.replaceAll(requestedId, '{id}')
      : '[credencial-presente]',
  };
  if (credentialFree && ['http:', 'https:'].includes(candidate.protocol)) finalTarget = candidate;
}

let directResponse = null;
if (finalTarget) {
  const response = await fetch(finalTarget, {
    headers: {
      accept: '*/*',
      'accept-encoding': 'identity',
      range: 'bytes=0-0',
      'user-agent': 'VLC/3.0.23 LibVLC/3.0.23',
    },
    redirect: 'manual',
    signal: AbortSignal.timeout(30_000),
  });
  directResponse = {
    ...compactResponse(response),
    acceptRanges: response.headers.get('accept-ranges') || '',
    contentRange: response.headers.get('content-range') || '',
    cors: response.headers.get('access-control-allow-origin') || '',
  };
  await response.body?.cancel();
}

const requestedSampleSize = Math.max(0, Math.min(12, Number.parseInt(options.sample || '0', 10) || 0));
let redirectSample = null;
if (requestedSampleSize && catalog.length) {
  const indexes = [...new Set(Array.from(
    { length: requestedSampleSize },
    (_, index) => Math.round((catalog.length - 1) * index / Math.max(1, requestedSampleSize - 1)),
  ))];
  const patterns = new Map();
  const hosts = new Map();
  const comparisons = [];
  let redirects = 0;
  let credentialFree = 0;
  let failures = 0;

  for (const index of indexes) {
    const entry = catalog[index];
    const id = String(entry?.stream_id || '');
    const itemExtension = String(entry?.container_extension || 'mp4').replace(/[^a-z0-9]/gi, '').slice(0, 8) || 'mp4';
    if (!/^\d+$/.test(id)) { failures += 1; continue; }
    try {
      const url = new URL(
        `/movie/${encodeURIComponent(username)}/${encodeURIComponent(password)}/${id}.${itemExtension}`,
        server,
      );
      const response = await fetch(url, {
        headers: {
          accept: '*/*',
          'accept-encoding': 'identity',
          range: 'bytes=0-0',
          'user-agent': 'VLC/3.0.23 LibVLC/3.0.23',
        },
        redirect: 'manual',
        signal: AbortSignal.timeout(15_000),
      });
      await response.body?.cancel();
      const location = response.headers.get('location') || '';
      if (!location) { failures += 1; continue; }
      redirects += 1;
      const target = new URL(location, url);
      const decoded = (() => {
        try { return decodeURIComponent(target.href); } catch { return target.href; }
      })();
      const safe = ![username, password].some((secret) =>
        decoded.includes(secret) || target.href.includes(encodeURIComponent(secret)),
      );
      if (!safe) continue;
      credentialFree += 1;
      const pattern = target.pathname
        .replaceAll(id, '{id}')
        .replace(new RegExp(`\\.${itemExtension}$`, 'i'), '.{ext}');
      hosts.set(target.host, (hosts.get(target.host) || 0) + 1);
      patterns.set(pattern, (patterns.get(pattern) || 0) + 1);
      comparisons.push({
        id,
        categoryId: String(entry?.category_id || ''),
        categoryName: categoryNames.get(String(entry?.category_id || '')) || '',
        finalPath: target.pathname,
        filenameUsesId: target.pathname.toLowerCase().endsWith(`/${id}.${itemExtension}`.toLowerCase()),
      });
    } catch { failures += 1; }
  }
  redirectSample = {
    requested: indexes.length,
    redirects,
    credentialFree,
    failures,
    hosts: [...hosts].map(([host, count]) => ({ host, count })),
    pathPatterns: [...patterns].map(([pattern, count]) => ({ pattern, count })),
    comparisons,
  };
}

const output = {
  catalogWithoutCredentials: {
    ...compactResponse(unauthenticatedCatalog.response),
    isList: Array.isArray(unauthenticatedCatalog.data),
    responseBytes: unauthenticatedCatalog.bytes,
  },
  authorizedCatalog: {
    ...compactResponse(authenticatedCatalog.response),
    isList: Array.isArray(authenticatedCatalog.data),
    itemCount: catalog.length,
    selectedItemFound: Boolean(item),
    selectedItem: item ? {
      id: requestedId,
      extension,
      categoryId: String(item.category_id || ''),
      categoryName: categoryNames.get(String(item.category_id || '')) || '',
      hasDirectSource: Boolean(item.direct_source || item.stream_url),
    } : null,
    fieldCoverage: catalogFieldCoverage,
  },
  authorizedMediaOpening: {
    ...compactResponse(mediaResponse),
    redirect: locationSummary,
  },
  credentialFreeTargetProbe: directResponse,
  redirectSample,
};

console.log(JSON.stringify(output, null, 2));
