import { describe, expect, it } from "vitest";
import { isValidCell, getResolution } from "h3-js";
import { makeMockHeatmap, makeMockPlan, demoPlaces } from "./mock";
import { decodeLevels } from "../lib/heatmap";
import type { PlanRequest } from "./types";
const inputs: PlanRequest = {
  origin: demoPlaces[0],
  destination: demoPlaces[1],
  departure_local: "2026-10-16T06:00",
  cargo_lb: 42000,
  spacing_mi: 25,
  wind_measure: "gust",
  rest: { mode: "auto" },
};
describe("realistic demo contract", () => {
  it("has an explicit No Travel stretch with ETA-relative clearing and an uncleared endpoint", () => {
    const plan = makeMockPlan(inputs), blocked = plan.routes[2].checkpoints.filter(cp => cp.level === 4);
    expect(blocked.length).toBeGreaterThan(1); expect(plan.routes[2].eligible).toBe(false);
    expect(blocked.some(cp => cp.clears_in_h === null && cp.clears_at_utc === null)).toBe(true);
    expect(blocked.some(cp => cp.clears_in_h !== null)).toBe(true);
    for (const cp of plan.routes.flatMap(route => route.checkpoints)) {
      if (cp.clears_in_h !== null) {
        expect(cp.level).toBeGreaterThanOrEqual(3);
        expect(Date.parse(cp.clears_at_utc!) - Date.parse(cp.eta_utc)).toBe(cp.clears_in_h! * 3_600_000);
      } else expect(cp.clears_at_utc).toBeNull();
    }
  });
  it("has consistent mileage, Severe / High stretches, and truck rest plateaus", () => {
    const plan = makeMockPlan(inputs);
    expect(plan.routes.map((r) => r.id)).toEqual(["A", "B", "C"]);
    expect(plan.routes[0].risk.miles_by_level.high).toBeGreaterThan(
      plan.routes[1].risk.miles_by_level.high,
    );
    expect(plan.routes[2].risk.miles_by_level.severe).toBeGreaterThan(0);
    expect(plan.routes[2].risk.miles_by_level.no_travel).toBeGreaterThan(0);
    for (const route of plan.routes) {
      expect(
        Object.values(route.risk.miles_by_level).reduce((a, b) => a + b, 0),
      ).toBeCloseTo(route.distance_mi);
      expect(route.total_s).toBe(route.drive_s + route.rest_s);
      expect(route.rests.map((r) => r.kind)).toEqual(["break30", "rest10h"]);
      expect(route.progress.at(-1)).toEqual([route.total_s, route.distance_mi]);
      for (const cp of route.checkpoints) {
        expect(cp.place).toMatchObject({ road: expect.any(String), town: expect.any(String), state: expect.any(String), distance_mi: expect.any(Number), direction: expect.stringMatching(/^(N|NE|E|SE|S|SW|W|NW)$/) });
        expect(cp.place_label).toContain(`${cp.place!.town}, ${cp.place!.state}`);
      }
    }
  });
  it("returns genuine res-4 corridor cells with 49 changing hourly levels", () => {
    const heatmap = makeMockHeatmap(makeMockPlan(inputs));
    expect(heatmap.cells.length).toBeGreaterThan(100);
    expect(heatmap.cells.length).toBeLessThanOrEqual(600);
    expect(
      heatmap.cells.every(
        (cell) => isValidCell(cell) && getResolution(cell) === 4,
      ),
    ).toBe(true);
    const levels = decodeLevels(heatmap.levels_b64, 49, heatmap.cells.length);
    expect(levels.slice(0, heatmap.cells.length)).not.toEqual(
      levels.slice(24 * heatmap.cells.length, 25 * heatmap.cells.length),
    );
    expect(levels.includes(255)).toBe(true);
  });
});
