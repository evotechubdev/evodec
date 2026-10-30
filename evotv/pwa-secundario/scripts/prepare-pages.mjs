import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = resolve(packageRoot, '..', '..');
const applicationBuild = resolve(packageRoot, 'dist');
const pagesBuild = resolve(packageRoot, 'pages-dist');
const evotvBuild = resolve(pagesBuild, 'evotv');
const offlineAppSource = resolve(repositoryRoot, 'evotv', 'app');
const offlineAppBuild = resolve(evotvBuild, 'app');
const mainPage = resolve(repositoryRoot, 'index.html');
const publicAssets = resolve(repositoryRoot, 'public');

if (!existsSync(applicationBuild)) {
  throw new Error('Execute o build do PWA antes de preparar o GitHub Pages.');
}
if (!existsSync(mainPage)) {
  throw new Error('A página principal index.html do EVODEC não foi encontrada.');
}

rmSync(pagesBuild, { recursive: true, force: true });
mkdirSync(pagesBuild, { recursive: true });
copyFileSync(mainPage, resolve(pagesBuild, 'index.html'));
cpSync(applicationBuild, evotvBuild, { recursive: true });

// Mantem os atalhos e instalacoes antigas utilizaveis durante a mudanca de
// /pwa/ para /pwa-secundario/. A consulta (incluindo direct_http=1) e o hash
// sao preservados, mas nenhum dado de autenticacao e colocado no HTML.
const legacyPwaBuild = resolve(evotvBuild, 'pwa');
mkdirSync(legacyPwaBuild, { recursive: true });
writeFileSync(resolve(legacyPwaBuild, 'index.html'), `<!doctype html>
<html lang="pt-BR"><head><meta charset="UTF-8"><meta name="robots" content="noindex">
<meta http-equiv="refresh" content="0; url=../pwa-secundario/index.html">
<title>EVOTV</title></head><body><script>
location.replace('../pwa-secundario/index.html' + location.search + location.hash);
</script></body></html>\n`);

if (existsSync(offlineAppSource)) {
  mkdirSync(offlineAppBuild, { recursive: true });
  for (const entry of [
    'index.html', 'styles.css', 'app.js', 'auth-api.js', 'device-vault.js',
    'catalog-db.js', 'series-catalog-db.js', 'sw.js', 'manifest.webmanifest', 'assets', 'data', 'vendor',
  ]) {
    const source = resolve(offlineAppSource, entry);
    if (existsSync(source)) cpSync(source, resolve(offlineAppBuild, entry), { recursive: true });
  }
}

if (existsSync(publicAssets)) {
  cpSync(publicAssets, resolve(pagesBuild, 'public'), { recursive: true });
}

console.log('GitHub Pages preparado em pages-dist/.');
