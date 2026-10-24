import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import relay from '../worker/index.js';

const clientHeaders = {
  origin: 'https://evotechubdev.github.io',
  'x-evo-session': 'signed-profile-session',
  'x-evo-profile': '1',
  'x-evo-platform': 'pc',
  'x-evo-version': '1.0.6',
  'x-evo-version-code': 'release-code',
};

function packSource(publicKey, payload) {
  const key = crypto.randomBytes(32);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
  const envelope = {
    version: 1,
    key: crypto.publicEncrypt({ key: publicKey, oaepHash: 'sha256', padding: crypto.constants.RSA_PKCS1_OAEP_PADDING }, key).toString('base64url'),
    iv: iv.toString('base64url'),
    tag: cipher.getAuthTag().toString('base64url'),
    data: data.toString('base64url'),
  };
  return Buffer.from(JSON.stringify(envelope)).toString('base64url');
}

test('relay validates the session and streams an encrypted HTTP target', async (t) => {
  const keys = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const privateKey = keys.privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64');
  const packed = packSource(keys.publicKey, {
    target: 'http://provider.example/live/user/pass/42.ts',
    kind: 'live', id: '42', extension: 'ts', profile: 1, expiresAt: Date.now() + 60_000,
  });
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const calls = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input); calls.push(url);
    if (url.includes('/validate?relay=')) {
      const headers = new Headers(init?.headers);
      for (const [name, value] of Object.entries(clientHeaders)) {
        if (name !== 'origin') assert.equal(headers.get(name), value);
      }
      return new Response(null, { status: 204 });
    }
    if (url.includes('/player_api.php?')) {
      const account = new URL(url);
      assert.equal(account.origin, 'http://provider.example');
      assert.equal(account.searchParams.get('username'), 'user');
      assert.equal(account.searchParams.get('password'), 'pass');
      assert.equal(new Headers(init?.headers).get('user-agent'), 'VLC/3.0.21 LibVLC/3.0.21');
      return Response.json({ user_info: { auth: 1 } });
    }
    assert.equal(url, 'http://provider.example/live/user/pass/42.ts');
    const headers = new Headers(init?.headers);
    assert.equal(headers.get('user-agent'), 'VLC/3.0.21 LibVLC/3.0.21');
    assert.equal(headers.get('range'), 'bytes=0-');
    assert.equal(headers.get('icy-metadata'), '1');
    return new Response('mpeg-ts', { headers: { 'content-type': 'video/mp2t' } });
  };
  const response = await relay.fetch(
    new Request(`https://relay.example/stream/session-ticket/${packed}/42.ts`, { headers: clientHeaders }),
    { WEB_RELAY_PRIVATE_KEY: privateKey, AUTH_BACKEND_URL: 'https://backend.example' },
    {},
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'video/mp2t');
  assert.equal(response.headers.get('access-control-allow-origin'), clientHeaders.origin);
  assert.equal(await response.text(), 'mpeg-ts');
  assert.equal(calls.length, 3);
});

test('relay refuses a source envelope that does not match the requested file', async () => {
  const keys = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const privateKey = keys.privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64');
  const packed = packSource(keys.publicKey, {
    target: 'http://provider.example/live/user/pass/42.ts',
    kind: 'live', id: '42', extension: 'ts', profile: 1, expiresAt: Date.now() + 60_000,
  });
  const response = await relay.fetch(
    new Request(`https://relay.example/stream/session-ticket/${packed}/99.ts`, { headers: clientHeaders }),
    { WEB_RELAY_PRIVATE_KEY: privateKey, AUTH_BACKEND_URL: 'https://backend.example' },
    {},
  );
  assert.equal(response.status, 401);
});

test('relay rejects copied links without the official origin and active profile session', async () => {
  const noOrigin = await relay.fetch(
    new Request('https://relay.example/stream/ticket/source/42.ts'),
    {},
    {},
  );
  assert.equal(noOrigin.status, 403);
  assert.equal(noOrigin.headers.get('access-control-allow-origin'), null);

  const noSession = await relay.fetch(
    new Request('https://relay.example/stream/ticket/source/42.ts', {
      headers: { origin: clientHeaders.origin },
    }),
    {},
    {},
  );
  assert.equal(noSession.status, 401);
});
