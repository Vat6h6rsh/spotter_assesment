import type { Level, MilesByLevel } from "../api/types";
export const severities = [
  { label: "Low", key: "low", token: "low" },
  { label: "Moderate", key: "moderate", token: "moderate" },
  { label: "High", key: "high", token: "high" },
  { label: "Severe", key: "severe", token: "severe" },
  { label: "No Travel", key: "no_travel", token: "stop" },
  { label: "Unknown", key: "unknown", token: "unknown" },
] as const;
export const severity = (level: Level) =>
  severities[level === null ? 5 : level];
export const riskDescription = (miles: MilesByLevel) =>
  severities
    .map((s) => `${s.label} ${Math.round(miles[s.key])} miles`)
    .join(", ");
