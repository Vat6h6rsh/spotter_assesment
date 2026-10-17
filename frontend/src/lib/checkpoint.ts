import type { Checkpoint, Plan } from "../api/types";
import { number } from "./fmt";
import { localTime } from "./time";

/** Spot-specific forecast timing, never a departure delay or a whole-route guarantee. */
export function checkpointClearing(cp: Checkpoint) {
  if (cp.level !== 3 && cp.level !== 4) return null;
  if (cp.clears_in_h == null || !Number.isFinite(cp.clears_in_h) || cp.clears_in_h < 0)
    return "No clearing in the next 48 h.";
  const at = cp.clears_at_utc ?? new Date(Date.parse(cp.eta_utc) + cp.clears_in_h * 3_600_000).toISOString();
  const hours = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(cp.clears_in_h);
  return `Clear roads in about ${hours} h (${localTime(at, cp.tz)}).`;
}

/** The deciding driver, using the plan's actual wind measure and units. */
export function checkpointDriver(cp: Checkpoint, inputs: Plan["inputs"]) {
  if (cp.level === null) return cp.beyond_horizon ? "Beyond forecast horizon" : "Weather unavailable";
  const drivers = cp.drivers.map((driver) => {
    if (driver === "wind") {
      const gust = inputs.wind_measure === "gust" && cp.gust_mph !== null && (cp.wind_mph === null || cp.gust_mph >= cp.wind_mph);
      const value = gust ? cp.gust_mph : cp.wind_mph;
      return `${gust ? "Gust" : "Sustained wind"} ${value === null ? "unknown" : number(value)} mph`;
    }
    if (driver === "rain") return `Rain ${cp.rain_in === null ? "unknown" : number(cp.rain_in, 2)} in/hr`;
    if (driver === "snow") return `Snow ${cp.snow_in === null ? "unknown" : number(cp.snow_in, 2)} in/hr`;
    return driver;
  });
  return `${drivers.join(" · ") || "All conditions Low"}${cp.load_adjusted ? ` · ${number(inputs.cargo_lb)} lb rule` : ""}`;
}
