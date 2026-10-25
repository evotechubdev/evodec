import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { createRelayServer } from '../src/server.mjs';

const servers = [];
const sessionHeaders = {
  origin: 'https://evotechubdev.github.io',
  'x-evo-session': 'signed-session',
  'x-evo-profile': '1',
  'x-evo-platform': 'android',
  'x-evo-version': '1.0.6',
  'x-evo-version-code': 'version-code',
};

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
});

async function start(options = {}) {
  const server = createRelayServer({
    backendOrigin: 'https://backend.example',
    allowedOrigin: 'https://evotechubdev.github.io',
    assertTarget: async () => {},
    ...options,
  });
  servers.push(server);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  return `http://127.0.0.1:${address.port}`;
}

function relayPath(openUrl, file = '194567.ts') {
  return `/stream/${Buffer.from(openUrl).toString('base64url')}/${file}`;
}

test('health is public and reveals no provider data', async () => {
  const relay = await start();
  const response = await fetch(`${relay}/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    service: 'evotv-render-media-relay',
    release: '4',
    region: 'configured-by-render',
  });
});

test('rejects requests outside the EVOTV origin', async () => {
  const relay = await start();
  const response = await fetch(`${relay}/stream/bad/194567.ts`, { headers: { origin: 'https://attacker.example' } });
  assert.equal(response.status, 403);
  assert.equal((await response.json()).code, 'ORIGIN_FORBIDDEN');
});

test('resolves a signed backend ticket and streams media with range support', async () => {
  const calls = [];
  const openUrl = 'https://backend.example/open-stream/signed-ticket/194567.ts';
  const providerUrl = 'http://provider.example/live/user/password/194567.ts';
  const fetchImpl = async (input, init) => {
    const url = String(input);
    calls.push({ url, headers: new Headers(init.headers) });
    if (url === openUrl) return new Response(null, { status: 302, headers: { location: providerUrl } });
    if (url.startsWith('http://provider.example/player_api.php?')) {
      return Response.json({ user_info: { auth: 1 } });
    }
    if (url === providerUrl) {
      return new Response(new Uint8Array([0x47, 0x40, 0x00, 0x10]), {
        status: 206,
        headers: { 'content-type': 'video/mp2t', 'content-range': 'bytes 0-3/4' },
      });
    }
    throw new Error('unexpected URL');
  };
  const relay = await start({ fetchImpl });
  const first = await fetch(`${relay}${relayPath(openUrl)}`, { headers: { ...sessionHeaders, range: 'bytes=0-' } });
  assert.equal(first.status, 206);
  assert.equal(first.headers.get('content-type'), 'video/mp2t');
  assert.deepEqual([...new Uint8Array(await first.arrayBuffer())], [0x47, 0x40, 0x00, 0x10]);
  const firstProviderCall = calls.find((call) => call.url === providerUrl);
  assert.equal(firstProviderCall.headers.get('range'), 'bytes=0-');

  const second = await fetch(`${relay}${relayPath(openUrl)}`, { headers: { ...sessionHeaders, range: 'bytes=2-' } });
  assert.equal(second.status, 206);
  await second.body.cancel();
  assert.equal(calls.filter((call) => call.url === openUrl).length, 1, 'the one-use backend ticket must only be resolved once');
  assert.equal(calls.filter((call) => call.url === providerUrl).at(-1).headers.get('range'), 'bytes=2-');
  assert.ok(calls.some((call) => call.url.startsWith('http://provider.example/player_api.php?')));
});

test('opens a live stream without forcing Range on the first attempt', async () => {
  const calls = [];
  const openUrl = 'https://backend.example/open-stream/live-ticket/55.ts';
  const providerUrl = 'http://provider.example/live/user/password/55.ts';
  const fetchImpl = async (input, init) => {
    const url = String(input);
    calls.push({ url, headers: new Headers(init.headers) });
    if (url === openUrl) return new Response(null, { status: 302, headers: { location: providerUrl } });
    if (url.startsWith('http://provider.example/player_api.php?')) {
      return Response.json({ user_info: { auth: 1 } });
    }
    if (url === providerUrl && !new Headers(init.headers).has('range')) {
      return new Response(new Uint8Array([0x47, 0x40, 0x00, 0x10]), {
        status: 200,
        headers: { 'content-type': 'video/mp2t' },
      });
    }
    return new Response(null, { status: 500 });
  };
  const relay = await start({ fetchImpl });
  const response = await fetch(`${relay}${relayPath(openUrl, '55.ts')}`, { headers: sessionHeaders });
  assert.equal(response.status, 200);
  await response.body.cancel();
  assert.equal(calls.find((call) => call.url === providerUrl).headers.get('range'), null);
  assert.equal(calls.filter((call) => call.url === providerUrl).length, 1);
});

test('rejects a URL that is not an exact backend open-stream ticket', async () => {
  const relay = await start();
  const forged = 'https://attacker.example/open-stream/ticket/194567.ts';
  const response = await fetch(`${relay}${relayPath(forged)}`, { headers: sessionHeaders });
  assert.equal(response.status, 401);
  assert.equal((await response.json()).code, 'STREAM_TICKET_INVALID');
});
