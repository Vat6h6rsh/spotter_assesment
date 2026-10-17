import { useSyncExternalStore } from "react";
import { clampHour } from "../lib/time";
// A listener may request another frame while a visual interpolates to a paused clock.
type FrameListener = (hour: number, now: number) => boolean | void;
let hour = 0,
  visibleHour = 0,
  maxHour = 48,
  playing = false,
  frame = 0,
  previous = 0,
  lastNotify = 0,
  dirty = true,
  settling = false;
let msPerHour = 1200, held = false, revision = 0;
const frames = new Set<FrameListener>(),
  reads = new Set<() => void>(),
  plays = new Set<() => void>();
function schedule() {
  if (!frame) frame = requestAnimationFrame(tick);
}
function tick(now: number) {
  frame = 0;
  if (playing && !held) {
    hour = clampHour(hour + (previous ? Math.min(100, now - previous) / msPerHour : 0), maxHour);
    dirty = true;
    if (hour >= maxHour) timeline.play(false);
  }
  previous = now;
  if (dirty || settling) {
    dirty = false;
    settling = false;
    frames.forEach((fn) => { if (fn(hour, now)) settling = true; });
  }
  if (now - lastNotify >= 120 || !playing) {
    const value = Math.round(hour * 10) / 10;
    if (value !== visibleHour) {
      visibleHour = value;
      reads.forEach((fn) => fn());
    }
    lastNotify = now;
  }
  if (playing || settling || dirty) schedule();
}
export const timeline = {
  get: () => hour,
  revision: () => revision,
  configure(options: { max?: number; msPerHour?: number; held?: boolean }) {
    if (options.max !== undefined) maxHour = options.max;
    if (options.msPerHour !== undefined) msPerHour = options.msPerHour;
    if (options.held !== undefined) held = options.held;
    previous = 0;
    timeline.requestFrame();
  },
  requestFrame() {
    dirty = true;
    schedule();
  },
  set(value: number) {
    revision++;
    hour = clampHour(value, maxHour);
    dirty = true;
    schedule();
  },
  reset(max = 48) {
    maxHour = max;
    msPerHour = 1200; held = false;
    timeline.play(false);
    timeline.set(0);
  },
  play(value: boolean) {
    if (value && hour >= maxHour) hour = 0;
    playing = value;
    previous = 0;
    plays.forEach((fn) => fn());
    dirty = true;
    schedule();
  },
  isPlaying: () => playing,
  onFrame(fn: FrameListener) {
    frames.add(fn);
    dirty = true;
    schedule();
    return () => {
      frames.delete(fn);
    };
  },
  subscribe(fn: () => void) {
    reads.add(fn);
    return () => {
      reads.delete(fn);
    };
  },
  subscribePlay(fn: () => void) {
    plays.add(fn);
    return () => {
      plays.delete(fn);
    };
  },
};
export const useTimelineHour = () =>
  useSyncExternalStore(timeline.subscribe, () => visibleHour);
export const usePlaying = () =>
  useSyncExternalStore(timeline.subscribePlay, timeline.isPlaying);
