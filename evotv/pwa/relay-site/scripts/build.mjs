import { cp, mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const distRoot = resolve(projectRoot, 'dist');

await rm(distRoot, { recursive: true, force: true });
await mkdir(resolve(distRoot, 'server'), { recursive: true });
await mkdir(resolve(distRoot, '.openai'), { recursive: true });
await cp(resolve(projectRoot, 'worker/index.js'), resolve(distRoot, 'server/index.js'));
await cp(resolve(projectRoot, '.openai/hosting.json'), resolve(distRoot, '.openai/hosting.json'));

console.log(`Built ${distRoot}`);
