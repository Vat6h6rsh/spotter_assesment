import { describe, expect, it } from "vitest";
import { featureFilter } from "@maplibre/maplibre-gl-style-spec";
import { checkpointVisibility, pickedCheckpointFilter, routeEtaFilter } from "./filters";

const points = ["A", "B", "C"].flatMap((route) => [0, 1, 2, 3, 4, 255].map((level, i) => ({ type: "Point" as const, properties: { route, i, level } })));
describe("checkpoint filters", () => {
  it("matches exactly one ring/label, or none, through every selection and clearing state", () => {
    for (const route of [null, "A", "B", "C", "missing"]) for (const index of [null, -1, 0, 1, 5, 99, NaN]) {
      const filter = featureFilter(pickedCheckpointFilter(route, index), "checkpoint-selected.filter").filter;
      for (const zoom of [0, 4, 7, 13]) {
        const matches = points.filter((p) => filter({ zoom }, p));
        const expected = points.filter((p) => p.properties.route === route && p.properties.i === index);
        expect(matches).toEqual(expected);
        expect(matches.length).toBeLessThanOrEqual(1);
      }
    }
  });
  it("gates selected icons, exposes all alternative levels as dots by zoom 7, and keeps ETA labels on the selected route", () => {
    const icons = featureFilter(checkpointVisibility("B"), "checkpoint-markers.filter").filter;
    const dots = featureFilter(checkpointVisibility("B", true), "checkpoint-dots.filter").filter;
    expect(points.filter(p => icons({ zoom: 7 }, p))).toHaveLength(6);
    expect(points.filter(p => dots({ zoom: 7 }, p))).toHaveLength(12);
    expect(points.filter(p => dots({ zoom: 0 }, p)).every(p => p.properties.level === 4)).toBe(true);
    const labels = featureFilter(routeEtaFilter("B", 2), "checkpoint-eta.filter").filter;
    expect(points.filter(p => labels({ zoom: 7 }, p)).every(p => p.properties.route === "B" && p.properties.i !== 2)).toBe(true);
    const empty = featureFilter(routeEtaFilter(null, null), "checkpoint-eta.filter").filter;
    expect(points.filter(p => empty({ zoom: 7 }, p))).toEqual([]);
  });
});
