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
const mp4boxDist = resolve(packageRoot, 'node_modules', 'mp4box', 'dist');
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
    'index.html', 'admin.html', 'styles.css', 'app.js', 'admin.js',
    'direct-http-mp4.js',
    'catalog-db.js', 'sw.js', 'manifest.webmanifest', 'assets', 'data',
  ]) {
    const source = resolve(offlineAppSource, entry);
    if (existsSync(source)) cpSync(source, resolve(offlineAppBuild, entry), { recursive: true });
  }
  const vendorBuild = resolve(offlineAppBuild, 'vendor');
  mkdirSync(vendorBuild, { recursive: true });
  for (const entry of [
    'mp4box.all.mjs',
    'rolldown-runtime-CNh9ExCG.mjs',
    'styp-BV5G3FS-.mjs',
  ]) {
    copyFileSync(resolve(mp4boxDist, entry), resolve(vendorBuild, entry));
  }
}

if (existsSync(publicAssets)) {
  cpSync(publicAssets, resolve(pagesBuild, 'public'), { recursive: true });
}

console.log('GitHub Pages preparado em pages-dist/.');
