import { cellToBoundary } from "h3-js";
import type { Heatmap } from "../api/types";
export function decodeLevels(
  encoded: string,
  hours: number,
  cellCount: number,
): Uint8Array {
  const raw = atob(encoded);
  if (!Number.isInteger(hours) || hours < 1 || raw.length !== hours * cellCount)
    throw new Error("Corridor data has an invalid length.");
  const levels = Uint8Array.from(raw, (char) => char.charCodeAt(0));
  if (levels.some((level) => level > 4 && level !== 255))
    throw new Error("Corridor data contains an invalid risk level.");
  return levels;
}
export function prepareHeatmap(data: Heatmap) {
  const levels = decodeLevels(data.levels_b64, data.hours, data.cells.length);
  const features = data.cells.map((id, i) => {
    const ring = cellToBoundary(id, true);
    return {
      type: "Feature" as const,
      id,
      properties: {
        id,
        index: i,
        levels: Array.from(
          { length: data.hours },
          (_, h) => levels[h * data.cells.length + i],
        ),
      },
      geometry: { type: "Polygon" as const, coordinates: [ring] },
    };
  });
  return {
    data,
    levels,
    geojson: { type: "FeatureCollection" as const, features },
  };
}
export type PreparedHeatmap = ReturnType<typeof prepareHeatmap>;
