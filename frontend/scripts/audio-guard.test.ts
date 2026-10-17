import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync, readFileSync } from 'node:fs';
import { basename, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { auditAudio, creditedAudio } from './audio-guard.mjs';
const fixtures: string[] = [];
const fixtureRoot = resolve(tmpdir());
function fixture() {
  const dir = mkdtempSync(resolve(fixtureRoot, 'drive-audio-')); fixtures.push(dir);
  mkdirSync(resolve(dir, 'public/audio'), { recursive: true }); mkdirSync(resolve(dir, 'local-audio')); mkdirSync(resolve(dir, 'dist'));
  writeFileSync(resolve(dir, 'public/audio/CREDITS.txt'), 'gnossienne-no-1.mp3 — Satie; founder-supplied recording.\n');
  writeFileSync(resolve(dir, 'public/audio/gnossienne-no-1.mp3'), 'public music');
  return dir;
}
afterEach(() => fixtures.splice(0).forEach(path => {
  const target = resolve(path);
  if (!target.startsWith(`${fixtureRoot}${sep}`) || !basename(target).startsWith('drive-audio-')) throw new Error('Unsafe test cleanup path');
  rmSync(target, { recursive: true, force: true });
}));
describe('audio deployment boundary', () => {
  it('allows only explicitly credited public audio, including case-insensitive extensions', () => {
    const dir = fixture(); expect(auditAudio(dir)).toBe(1);
    writeFileSync(resolve(dir, 'public/secret.MP3'), 'copyright');
    expect(() => auditAudio(dir)).toThrow('Uncredited public audio');
  });
  it('does not treat incidental filenames in credit prose as permission', () => {
    expect([...creditedAudio('Note: never deploy private.mp3\ntrack.mp3 — Artist, CC0.')]).toEqual(['audio/track.mp3']);
  });
  it('rejects renamed local files by content and private directories', () => {
    const dir = fixture(); writeFileSync(resolve(dir, 'local-audio/private.mp3'), 'private song');
    writeFileSync(resolve(dir, 'dist/innocent.bin'), 'private song');
    expect(() => auditAudio(dir, true)).toThrow('Private local-audio');
  });
  it('rejects uncredited dist audio and permits a clean deployment beside local music', () => {
    const dir = fixture(); writeFileSync(resolve(dir, 'local-audio/private.mp3'), 'private song');
    mkdirSync(resolve(dir, 'dist/audio')); writeFileSync(resolve(dir, 'dist/audio/gnossienne-no-1.mp3'), 'public music');
    expect(auditAudio(dir, true)).toBe(1);
    writeFileSync(resolve(dir, 'dist/stowaway.ogg'), 'bad'); expect(() => auditAudio(dir, true)).toThrow('Uncredited build audio');
  });
  it('keeps the removed music asset and its references out of the frontend', () => {
    const removed = ['ta', 'bla'].join('');
    const hits: string[] = [];
    function scan(dir: string) {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (['node_modules', 'dist', '.git', 'local-audio'].includes(entry.name)) continue;
        const path = resolve(dir, entry.name);
        if (entry.isDirectory()) scan(path);
        else if (entry.name.toLowerCase().includes(removed) || (/\.(?:tsx?|m?js|json|md|txt)$|THIRD_PARTY_LICENSES$/.test(entry.name) && readFileSync(path, 'utf8').toLowerCase().includes(removed))) hits.push(path);
      }
    }
    scan(resolve('.'));
    expect(hits).toEqual([]);
  });
});
