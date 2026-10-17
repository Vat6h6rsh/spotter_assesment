import type { Checkpoint, Plan, Route } from "../api/types";
import { checkpointClearing, checkpointDriver } from "../lib/checkpoint";
import { number } from "../lib/fmt";
import { localTime } from "../lib/time";
import { severity } from "../lib/risk";
import { checkpointPlaceLabel } from "../lib/checkpointPlace";
import { weatherIconFor } from "../lib/weatherIcons";

export function buildCheckpointPopup(plan: Plan, route: Route, cp: Checkpoint) {
  const factor = cp.speed_factor ?? 1;
  return {
    title: checkpointPlaceLabel(cp),
    subtitle: `Route ${route.id} · Mile ${number(cp.mi)}`,
    eta: localTime(cp.eta_utc, cp.tz),
    level: cp.level,
    weatherIcon: weatherIconFor(cp),
    severity: severity(cp.level).label,
    token: severity(cp.level).token,
    driver: checkpointDriver(cp, plan.inputs),
    clearing: checkpointClearing(cp),
    slowdown: cp.slowdown ?? (factor < 1 ? `Speed reduced ${number((1 - factor) * 100)}%` : null),
  };
}
