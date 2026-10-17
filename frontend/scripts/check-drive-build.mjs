import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
const root = fileURLToPath(new URL('../dist/', import.meta.url)), files = readdirSync(resolve(root, 'assets'));
const main = files.find(name => /^index-.*\.js$/.test(name));
const three = files.find(name => /^drive-3d-.*\.js$/.test(name));
const loader = files.find(name => /^truckLayer-.*\.js$/.test(name));
if (!main || !three || !loader) throw new Error('Expected separate app, three.js and truck layer chunks.');
const html = readFileSync(resolve(root, 'index.html'), 'utf8');
if (/drive-3d-|truckLayer-/.test(html)) throw new Error('3D code was added to the eager HTML entry.');
const worker = readFileSync(resolve(root, 'sw.js'), 'utf8'), start = worker.indexOf('precacheAndRoute(');
if (start < 0) throw new Error('Cannot verify the generated PWA precache.');
const precache = worker.slice(start, worker.indexOf(']', start) + 1);
if (/drive-3d-|truckLayer-|audio\/|models\/|local-audio/.test(precache)) throw new Error('Preview assets entered the PWA precache.');
for (const name of [main, three, loader]) {
  const data = readFileSync(resolve(root, 'assets', name)), gzip = gzipSync(data).length;
  if (name === three && gzip > 250_000) throw new Error('three.js exceeds the 250 KB gzip preview budget.');
  console.log(`${name}: ${(data.length / 1000).toFixed(2)} KB raw / ${(gzip / 1000).toFixed(2)} KB gzip`);
}
console.log('Preview bundle/PWA check passed (3D, models and music excluded from precache).');
