import { afterEach, describe, expect, it, vi } from 'vitest';
import { previewAudio, randomStartOffset } from './audio';
afterEach(() => vi.unstubAllGlobals());
describe('preview music privacy and gestures', () => {
  it('does not create or fetch audio until a user explicitly unmutes, then fades and releases it', () => {
    const made: any[] = [];
    vi.stubGlobal('Audio', class extends EventTarget {
      src: string; volume = 1; loop = false; preload = '';
      play = vi.fn(async () => {}); pause = vi.fn(); load = vi.fn(); removeAttribute = vi.fn();
      constructor(src: string) { super(); this.src = src; made.push(this); }
    });
    const audio = previewAudio(); audio.tick(.1, true, false); expect(made).toHaveLength(0);
    audio.unmute(true); expect(made).toHaveLength(1); expect(made[0].play).toHaveBeenCalledOnce(); expect(made[0].volume).toBe(0);
    expect(made[0].src).toBe('/audio/gnossienne-no-1.mp3'); expect(made[0].loop).toBe(true);
    for (let i = 0; i < 10; i++) audio.tick(.1, true, false);
    expect(made[0].volume).toBeCloseTo(.45);
    for (let i = 0; i < 10; i++) audio.tick(.1, false, false);
    expect(made[0].volume).toBe(0); expect(made[0].pause).toHaveBeenCalled();
    audio.resume(); expect(made[0].play).toHaveBeenCalledTimes(2);
    audio.dispose(); expect(made[0].removeAttribute).toHaveBeenCalledWith('src');
  });
  it('seeks on metadata for each selected source, and never re-randomizes a resume', () => {
    const made: any[] = [];
    vi.stubGlobal('Audio', class extends EventTarget {
      duration = 125; currentTime = 0; src: string; volume = 0;
      play = vi.fn(async () => {}); pause = vi.fn(); load = vi.fn(); removeAttribute = vi.fn();
      constructor(src: string) { super(); this.src = src; made.push(this); }
    });
    const rng = vi.fn().mockReturnValueOnce(.25).mockReturnValueOnce(.75).mockReturnValueOnce(.5);
    const audio = previewAudio(rng); audio.unmute(true);
    expect(made[0].currentTime).toBe(0);
    made[0].dispatchEvent(new Event('loadedmetadata')); expect(made[0].currentTime).toBe(30);
    audio.resume(); expect(rng).toHaveBeenCalledTimes(1);
    audio.select('/audio/mausam-aaj-tak.mp3'); made[0].duration = 45;
    made[0].dispatchEvent(new Event('loadedmetadata')); expect(made[0].currentTime).toBe(30);
    const create = vi.fn().mockReturnValue('blob:own'); vi.stubGlobal('URL', { createObjectURL: create, revokeObjectURL: vi.fn() });
    audio.file(new File(['music'], 'own.mp3')); made[0].duration = 65;
    made[0].dispatchEvent(new Event('loadedmetadata')); expect(made[0].currentTime).toBe(30);
    audio.dispose(); made[0].dispatchEvent(new Event('loadedmetadata')); expect(rng).toHaveBeenCalledTimes(3);
  });
  it.each([0, .25, .5, .999999, 1])('bounds the random start and keeps five seconds for RNG %s', value => {
    expect(randomStartOffset(125, () => value)).toBeCloseTo(120 * value);
    for (const duration of [0, 3, 5, 6, 60, 3600, Infinity, NaN]) {
      const offset = randomStartOffset(duration, () => value);
      expect(offset).toBeGreaterThanOrEqual(0);
      expect(offset).toBeLessThanOrEqual(Number.isFinite(duration) ? Math.max(0, duration - 5) : 0);
    }
  });
  it('uses only object URLs for personal files and revokes replaced and discarded files', () => {
    const create = vi.fn().mockReturnValueOnce('blob:one').mockReturnValueOnce('blob:two'), revoke = vi.fn();
    vi.stubGlobal('URL', { createObjectURL: create, revokeObjectURL: revoke });
    const audio = previewAudio(), file = new File(['private'], 'own.mp3', { type: 'audio/mpeg' });
    const fetch = vi.spyOn(globalThis, 'fetch');
    audio.file(file); audio.file(file); expect(revoke).toHaveBeenCalledWith('blob:one');
    audio.dispose(); expect(revoke).toHaveBeenCalledWith('blob:two'); expect(fetch).not.toHaveBeenCalled();
  });
});
