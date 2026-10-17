import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

export const isAudio = (name) => /\.(mp3|wav|ogg|oga|opus|m4a|aac|flac|aiff?|wma|weba|mid|midi)$/i.test(name);
export function filesUnder(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(dir, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Audio guard: symlinks are not allowed: ${path}`);
    return entry.isDirectory() ? filesUnder(path) : [path];
  });
}
export function creditedAudio(credits) {
  // Only the first filename on a credit line grants permission, never a URL or prose mention.
  return new Set(credits.split(/\r?\n/).flatMap((line) => {
    const match = line.match(/^([\w./ -]+\.(?:mp3|wav|ogg|oga|opus|m4a|aac|flac|aiff?|wma|weba|mid|midi))\s+(?:—|–|-)/i);
    return match ? [`audio/${match[1]}`] : [];
  }));
}
export function auditAudio(root, output = false) {
  const allowed = creditedAudio(readFileSync(resolve(root, 'public/audio/CREDITS.txt'), 'utf8'));
  const publicDir = resolve(root, 'public');
  for (const path of filesUnder(publicDir)) {
    const name = relative(publicDir, path).split(sep).join('/');
    if (isAudio(name) && !allowed.has(name)) throw new Error(`Uncredited public audio: ${name}`);
  }
  // Hash every local file: renaming a private song must not bypass the deployment check.
  const hash = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
  const privateHashes = new Set(filesUnder(resolve(root, 'local-audio')).map(hash));
  const targets = output ? [publicDir, resolve(root, 'dist')] : [publicDir];
  for (const dir of targets) for (const path of filesUnder(dir)) {
    const name = relative(dir, path).split(sep).join('/');
    if (/(^|\/)local-audio(\/|$)/i.test(name) || (privateHashes.size && privateHashes.has(hash(path))))
      throw new Error(`Private local-audio would be deployed: ${name}`);
    if (output && dir.endsWith(`${sep}dist`) && isAudio(name) && !allowed.has(name))
      throw new Error(`Uncredited build audio: ${name}`);
  }
  return allowed.size;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
  try {
    const count = auditAudio(root, process.argv.includes('--dist'));
    console.log(`Audio guard passed (${count} credited public track${count === 1 ? '' : 's'}; local music excluded).`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
