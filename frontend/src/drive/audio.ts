// Uses the shared clock, no second animation scheduler. Play/unmute is the audio gesture.
import { timeline } from '../state/timeline';
export function randomStartOffset(duration: number, rng: () => number = Math.random) {
  return Number.isFinite(duration) && duration > 5 ? Math.max(0, Math.min(1, rng())) * (duration - 5) : 0;
}
export function previewAudio(rng: () => number = Math.random) {
  let audio: HTMLAudioElement | null = null, source = '/audio/gnossienne-no-1.mp3', objectUrl = '';
  let wanted = false, current = 0, target = 0;
  const startAtRandomOffset = () => { if (audio) audio.currentTime = randomStartOffset(audio.duration, rng); };
  const ensure = () => { if (!audio) { audio = new Audio(source); audio.loop = true; audio.preload = 'none'; audio.volume = 0; audio.addEventListener('loadedmetadata', startAtRandomOffset); } return audio; };
  const play = () => {
    // play() returns a Promise in browsers; guard environments (jsdom) where it returns undefined.
    const result = ensure().play() as Promise<void> | undefined;
    result?.catch?.(() => { wanted = false; target = 0; });
  };
  return {
    unmute(value: boolean) { wanted = value; target = value ? .45 : 0; if (value) play(); },
    select(value: string) {
      if (objectUrl && objectUrl !== value) { URL.revokeObjectURL(objectUrl); objectUrl = ''; }
      source = value; if (audio) { audio.pause(); audio.src = source; current = 0; audio.volume = 0; if (wanted) play(); }
    },
    file(file: File) {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      objectUrl = URL.createObjectURL(file); this.select(objectUrl);
    },
    tick(dt: number, playing: boolean, ending: boolean) {
      if (!audio) return false;
      const goal = wanted && playing && !ending ? target : 0;
      current += Math.max(-dt * .7, Math.min(dt * .7, goal - current)); audio.volume = Math.max(0, Math.min(.45, current));
      if (current < .001 && !goal) audio.pause();
      return Math.abs(goal - current) > .001;
    },
    resume() { if (wanted) play(); },
    finish() {
      if (!audio || current < .001) { this.dispose(); return; }
      this.unmute(false);
      let previous = performance.now();
      const stop = timeline.onFrame((_hour, now) => {
        const pending = this.tick(Math.min(.1, (now - previous) / 1000), false, true); previous = now;
        if (!pending) { stop(); this.dispose(); }
        return pending;
      });
    },
    dispose() { audio?.pause(); if (audio) { audio.removeEventListener('loadedmetadata', startAtRandomOffset); audio.removeAttribute('src'); audio.load(); } audio = null; if (objectUrl) URL.revokeObjectURL(objectUrl); objectUrl = ''; },
  };
}
