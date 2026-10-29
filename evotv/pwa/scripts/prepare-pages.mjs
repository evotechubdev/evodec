import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  rmSync,
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

if (existsSync(offlineAppSource)) {
  mkdirSync(offlineAppBuild, { recursive: true });
  for (const entry of [
    'index.html', 'styles.css', 'app.js', 'auth-api.js',
    'catalog-db.js', 'sw.js', 'manifest.webmanifest', 'assets', 'data',
  ]) {
    const source = resolve(offlineAppSource, entry);
    if (existsSync(source)) cpSync(source, resolve(offlineAppBuild, entry), { recursive: true });
  }
}

if (existsSync(publicAssets)) {
  cpSync(publicAssets, resolve(pagesBuild, 'public'), { recursive: true });
}

console.log('GitHub Pages preparado em pages-dist/.');
