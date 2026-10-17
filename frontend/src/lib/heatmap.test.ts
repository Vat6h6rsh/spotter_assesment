import { describe, expect, it } from "vitest";
import { decodeLevels, prepareHeatmap } from "./heatmap";
import { latLngToCell } from "h3-js";
describe("hour-major levels decoder", () => {
  it("decodes all levels and preserves Unknown as 255", () => {
    const raw = [0, 1, 2, 3, 4, 255];
    expect(decodeLevels(btoa(String.fromCharCode(...raw)), 2, 3)).toEqual(
      Uint8Array.from(raw),
    );
    expect(
      decodeLevels(btoa(String.fromCharCode(...raw)), 2, 3)[1 * 3 + 2],
    ).toBe(255);
  });
  it("rejects truncated, invalid, or malformed payloads", () => {
    expect(() => decodeLevels(btoa("abc"), 49, 3)).toThrow("invalid length");
    expect(() => decodeLevels(btoa(String.fromCharCode(6)), 1, 1)).toThrow(
      "invalid risk",
    );
    expect(() => decodeLevels("!", 1, 1)).toThrow();
  });
  it("computes a closed real H3 ring once and keeps hourly arrays on its feature", () => {
    const id = latLngToCell(41.525, -88.081, 4);
    const prepared = prepareHeatmap({
      plan_id: "test",
      res: 4,
      base_utc: "2026-10-16T11:00:00Z",
      hours: 2,
      cells: [id],
      levels_b64: btoa(String.fromCharCode(0, 3)),
      fetched_at: "2026-10-15T10:00:00Z",
    });
    const feature = prepared.geojson.features[0];
    expect(feature.id).toBe(id);
    expect(feature.properties.levels).toEqual([0, 3]);
    expect(feature.geometry.coordinates[0][0]).toEqual(
      feature.geometry.coordinates[0].at(-1),
    );
    expect(feature.geometry.coordinates[0]).toHaveLength(7);
  });
});
