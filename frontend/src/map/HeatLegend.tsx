import type { CSSProperties } from "react";
import { heatHatch, heatOpacity } from "./paint";
import type { TextureLevel } from "./paint";

const entries: [TextureLevel, string][] = [[1, "Moderate"], [2, "High"], [3, "Severe"], [4, "No Travel"], [0, "No tint = Low"], [255, "Unknown"]];

export function HeatLegend({ className }: { className: string }) {
  return <span className={className}>{entries.map(([level, label]) => {
    const color = level === 0 ? "transparent" : `var(--heat-${level === 255 ? "unknown" : level})`;
    const style = {
      "--swatch-color": color,
      "--swatch-alpha": `${Math.round(heatOpacity[level] * 100)}%`,
      "--swatch-hatch-alpha": `${Math.round((heatOpacity[level] + (level === 255 ? .18 : .16)) * 100)}%`,
      "--swatch-angle": `${heatHatch[level] ?? 0}deg`,
    } as CSSProperties;
    return <span key={level}><i className={`heat-swatch${heatHatch[level] ? " heat-swatch-hatch" : ""}`} style={style} aria-hidden="true" />{label}</span>;
  })}</span>;
}
