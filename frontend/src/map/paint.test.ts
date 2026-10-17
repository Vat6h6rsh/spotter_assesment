import { describe, expect, it } from "vitest";
import {
  createPropertyExpression,
  latest,
} from "@maplibre/maplibre-gl-style-spec";
import type { StylePropertySpecification } from "@maplibre/maplibre-gl-style-spec";
import { heatExpression, severityTexture, stateHeatExpression, heatHatch, heatOpacity } from "./paint";
import type { TextureLevel } from "./paint";
describe("MapLibre severity paints", () => {
  it("accepts both measured strategies as real MapLibre fill-pattern expressions", () => {
    for (const expression of [
      heatExpression(0),
      heatExpression(48),
      stateHeatExpression,
    ]) {
      expect(
        createPropertyExpression(
          expression,
          "fill-pattern",
          latest.paint_fill["fill-pattern"] as StylePropertySpecification,
        ).result,
      ).toBe("success");
    }
  });
  it("uses transparent Low, increasingly opaque severity fills, and hatched Unknown", () => {
    const patterns = ([0, 1, 2, 3, 4, 255] as TextureLevel[]).map((level) => severityTexture("#8DDBB3", level));
    const alphas = patterns.map((p) => Array.from(p.data).filter((_, i) => i % 4 === 3));
    expect(patterns.every((p) => p.width === 16 && p.height === 16)).toBe(true);
    expect(alphas[0].every((a) => a === 0)).toBe(true);
    const average = alphas.slice(0, 5).map((a) => a.reduce((sum, v) => sum + v, 0) / a.length);
    average.slice(1).forEach((value, i) => expect(value).toBeGreaterThan(average[i]));
    expect(average[1]).toBeGreaterThan(60);
    expect(average[4]).toBeGreaterThan(160);
    for (const a of alphas.slice(1, 4)) expect(new Set(a).size).toBe(1);
    for (const a of alphas.slice(4)) expect(new Set(a).size).toBe(2);
    expect(alphas[5][0]).toBeGreaterThan(alphas[5][4]);
    expect(heatHatch[4]).toBe(135);
    expect(heatHatch[255]).toBe(45);
    expect(heatOpacity).toMatchObject({ 1: .38, 2: .48, 3: .58, 4: .66 });
    const stop = patterns[4];
    expect(stop.data[3]).toBe(stop.data[(1 * 16 + 1) * 4 + 3]);
    expect(stop.data[3]).toBeGreaterThan(stop.data[(1 * 16 + 4) * 4 + 3]);
    expect(severityTexture("#AE1B2B", 3, .5).data[3]).toBe(Math.round(.58 * .5 * 255));
    expect(Array.from(severityTexture("#AE1B2B", 3, 0).data).filter((_, i) => i % 4 === 3).every(v => v === 0)).toBe(true);
  });
});
