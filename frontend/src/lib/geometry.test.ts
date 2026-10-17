import { describe, expect, it } from "vitest";
import {
  interpolateProgress,
  pointAtDistance,
  truckPosition,
} from "./geometry";
describe("progress and truck position", () => {
  const progress: [number, number][] = [
    [0, 0],
    [28800, 500],
    [30600, 500],
    [41400, 700],
    [77400, 700],
    [90000, 1000],
  ];
  it("interpolates driving, holds rest plateaus, and clamps outside the trip", () => {
    expect(interpolateProgress(progress, 14400)).toBe(250);
    expect(interpolateProgress(progress, 29500)).toBe(500);
    expect(interpolateProgress(progress, 60000)).toBe(700);
    expect(interpolateProgress(progress, -60)).toBe(0);
    expect(interpolateProgress(progress, 100000)).toBe(1000);
    expect(interpolateProgress([], 1)).toBe(0);
  });
  it("handles exact boundaries and duplicate elapsed knots", () => {
    expect(interpolateProgress(progress, 30600)).toBe(500);
    expect(
      interpolateProgress(
        [
          [0, 0],
          [10, 2],
          [10, 2],
          [20, 5],
        ],
        10,
      ),
    ).toBe(2);
  });
  it("uses road-distance geometry rather than jumping between checkpoints", () => {
    const geometry = {
      points: [
        [-100, 40],
        [-99, 40],
        [-99, 41],
      ] as [number, number][],
      prefix: [0, 500, 1000],
      distance: 1000,
      progress,
    };
    expect(truckPosition(geometry, 14400)).toEqual([-99.5, 40]);
    expect(truckPosition(geometry, 29500)).toEqual([-99, 40]);
    expect(truckPosition(geometry, 100000)).toEqual([-99, 41]);
    expect(pointAtDistance(geometry.points, geometry.prefix, -1)).toEqual([
      -100, 40,
    ]);
  });
});
