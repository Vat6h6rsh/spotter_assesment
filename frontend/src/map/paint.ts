import type { ExpressionSpecification } from "maplibre-gl";
export type Colors = Record<string, string>;
export type TextureLevel = 0 | 1 | 2 | 3 | 4 | 255;
export function heatExpression(hour: number): ExpressionSpecification {
  return [
    "match",
    ["at", hour, ["get", "levels"]],
    0,
    "heat-0",
    1,
    "heat-1",
    2,
    "heat-2",
    3,
    "heat-3",
    4,
    "heat-4",
    "heat-unknown",
  ];
}
export const stateHeatExpression: ExpressionSpecification = [
  "match",
  ["feature-state", "lvl"],
  0,
  "heat-0",
  1,
  "heat-1",
  2,
  "heat-2",
  3,
  "heat-3",
  4,
  "heat-4",
  "heat-unknown",
];
/** Read only corridor tokens; status colours remain reserved for marks and text. */
export function heatTokens(read: (property: string) => string) {
  return {
    0: "transparent",
    1: read("--heat-1").trim(),
    2: read("--heat-2").trim(),
    3: read("--heat-3").trim(),
    4: read("--heat-4").trim(),
    255: read("--heat-unknown").trim(),
  };
}
export const heatOpacity = { 0: 0, 1: .38, 2: .48, 3: .58, 4: .66, 255: 0 };
export const heatHatch = { 0: null, 1: null, 2: null, 3: null, 4: 135, 255: 45 } as const;
/** Seamless bitmaps: solid ordinal fills, 135? No Travel and 45? Unknown hatches. */
export function severityTexture(hex: string, level: TextureLevel, multiplier = 1) {
  const width = 16, data = new Uint8Array(width * width * 4);
  const rgb = level === 0 ? [0, 0, 0] : [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
  for (let y = 0; y < width; y++)
    for (let x = 0; x < width; x++) {
      const index = (y * width + x) * 4;
      // CSS-angle convention: 135? slopes down-right; 45? slopes up-right.
      const marked = heatHatch[level] === 135 ? (x - y + 16) % 8 < 2
        : heatHatch[level] === 45 && (x + y) % 8 < 2;
      const alpha = heatOpacity[level] + (marked ? (level === 255 ? .18 : .16) : 0);
      data[index] = rgb[0];
      data[index + 1] = rgb[1];
      data[index + 2] = rgb[2];
      data[index + 3] = Math.round(Math.min(1, Math.max(0, alpha * multiplier)) * 255);
    }
  return { width, height: width, data };
}
export const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;
