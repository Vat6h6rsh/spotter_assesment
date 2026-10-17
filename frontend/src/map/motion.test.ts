import { describe, expect, it } from "vitest";
import { smoothTruck } from "./motion";
import type { TruckMotion } from "./motion";
describe("time-based truck smoothing", () => {
  it("uses a 90ms time constant independently of frame rate", () => {
    const run = (step: number) => {
      const state: TruckMotion = { pos: [0, 0], hour: 0, now: 0 };
      for (let now = step; now <= 180 + 1e-8; now += step) smoothTruck(state, [1, 2], 1, now, false);
      return state.pos!;
    };
    expect(run(10)[0]).toBeCloseTo(1 - Math.exp(-2), 8);
    expect(run(30)).toEqual([expect.closeTo(run(10)[0], 8), expect.closeTo(run(10)[1], 8)]);
  });
  it("snaps first paint, jumps beyond 3 hours and reduced motion, and eventually stops requesting frames", () => {
    const state: TruckMotion = { pos: null, hour: 0, now: 0 };
    expect(smoothTruck(state, [1, 1], 0, 1, false)).toEqual({ position: [1, 1], pending: false });
    expect(smoothTruck(state, [5, 5], 4, 16, false)).toEqual({ position: [5, 5], pending: false });
    expect(smoothTruck(state, [6, 6], 4.1, 32, true)).toEqual({ position: [6, 6], pending: false });
    expect(smoothTruck(state, [7, 7], 4.2, 48, false).pending).toBe(true);
    expect(smoothTruck(state, [7, 7], 4.2, 2000, false)).toEqual({ position: [7, 7], pending: false });
  });
});
