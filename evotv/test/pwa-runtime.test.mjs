import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../app/', import.meta.url);
const source = name => readFile(new URL(name, root), 'utf8');

test('PWA consumes the unified backend and never the retired app backend', async () => {
  const files = await Promise.all(['app.js', 'auth-api.js', 'catalog-db.js', 'series-catalog-db.js', 'index.html'].map(source));
  const combined = files.join('\n');
  assert.match(combined, /https:\/\/multimideas-evo-backend\.onrender\.com/);
  assert.doesNotMatch(combined, /multimideas-evo-backend-app\.onrender\.com/);
  assert.match(files[0], /transport:\s*'edge'/);
  assert.match(files[4], /Versão:\s*Jupiter-02/);
  assert.match(files[0], /new URL\(authorizedUrl\.pathname, MEDIA_PROXY_ORIGIN\)/);
  assert.doesNotMatch(files[0], /debugMediaPlayback|LINK HTTP COMPLETO|LINK HTTPS FINAL/);
});

test('PWA cache version and application version stay in lockstep', async () => {
  const [auth, worker] = await Promise.all([source('auth-api.js'), source('sw.js')]);
  const version = /APP_PWA_VERSION = '([^']+)'/.exec(auth)?.[1];
  const code = /APP_PWA_VERSION_CODE = '([a-f0-9]{64})'/.exec(auth)?.[1];
  assert.ok(version && code);
  assert.match(worker, new RegExp(`const CACHE = '${version}${code}'`));
});

test('standalone live screen accepts only the fixed Cloudflare relay', async () => {
  const screen = await source('live-screen.js');
  assert.match(screen, /url\.origin !== MEDIA_PROXY_ORIGIN/);
  assert.match(screen, /url\.pathname\.startsWith\('\/open-stream\/'\)/);
});
