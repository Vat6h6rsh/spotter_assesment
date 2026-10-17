import type { Coordinate } from "../lib/geometry";
export interface TruckMotion { pos: Coordinate | null; hour: number; now: number }
/** A 90 ms time constant gives identical convergence at different frame rates. */
export function smoothTruck(state: TruckMotion, target: Coordinate, hour: number, now: number, reducedMotion: boolean) {
  const jump = Math.abs(hour - state.hour) > 3;
  const dt = Math.max(0, (now - state.now) / 1000);
  if (!state.pos || jump || reducedMotion) state.pos = target;
  else {
    const t = 1 - Math.exp(-dt / .09);
    state.pos = [state.pos[0] + (target[0] - state.pos[0]) * t, state.pos[1] + (target[1] - state.pos[1]) * t];
    if (Math.max(Math.abs(target[0] - state.pos[0]), Math.abs(target[1] - state.pos[1])) < 1e-7) state.pos = target;
  }
  state.hour = hour; state.now = now;
  return { position: state.pos, pending: state.pos !== target };
}
