import type { ExpressionSpecification } from "maplibre-gl";
import { CHECKPOINT_SYMBOLS } from "./symbols";

// Never pass null/undefined to setFilter: those remove a filter and expose every point.
export const NO_CHECKPOINT: ExpressionSpecification = ["==", ["get", "i"], -1];
export function pickedCheckpointFilter(route: string | null, index: number | null): ExpressionSpecification {
  return route !== null && index !== null && Number.isInteger(index) && index >= 0
    ? ["all", ["==", ["get", "route"], route], ["==", ["get", "i"], index]]
    : NO_CHECKPOINT;
}
export function checkpointVisibility(route: string | null, alternative = false): ExpressionSpecification {
  return ["all", [alternative ? "!=" : "==", ["get", "route"], route ?? ""],
    ["any", ...CHECKPOINT_SYMBOLS.map((s): ExpressionSpecification => ["all", ["==", ["get", "level"], s.level],
      [">=", ["zoom"], alternative ? s.alternativeZoom : s.selectedZoom]])],
  ];
}
export function routeEtaFilter(route: string | null, index: number | null): ExpressionSpecification {
  return ["all", ["==", ["get", "route"], route ?? ""], ["!=", ["get", "i"], index ?? -1]];
}
