import type { Plan, PlanRequest } from "../api/types";
export const clampHour = (hour: number, max = 48) =>
  Math.min(max, Math.max(0, Number.isFinite(hour) ? hour : 0));
export const hourTimestamp = (base: string, hour: number) =>
  new Date(Date.parse(base) + clampHour(hour, Infinity) * 3_600_000);
export const elapsedAtHour = (base: string, departure: string, hour: number) =>
  (hourTimestamp(base, hour).getTime() - Date.parse(departure)) / 1000;
export function keyHour(key: string, hour: number, max = 48) {
  const delta: Record<string, number> = {
    ArrowRight: 1,
    ArrowUp: 1,
    ArrowLeft: -1,
    ArrowDown: -1,
    PageUp: 6,
    PageDown: -6,
  };
  if (key === "Home") return 0;
  if (key === "End") return max;
  return clampHour(hour + (delta[key] ?? 0), max);
}
export { duration } from "./fmt";
export const localTime = (iso: string | Date, tz: string, day = true) =>
  new Intl.DateTimeFormat("en-US", {
    ...(day ? { weekday: "short" as const } : {}),
    hour: "numeric",
    minute: "2-digit",
    timeZone: tz,
    timeZoneName: "short",
  }).format(new Date(iso));
export function nextDeparture(tz = "America/Chicago") {
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(Date.now() + 3_600_000));
  return parts.replace(" ", "T").slice(0, 16);
}
/** Resolve a mock wall time in an IANA zone, including the daylight-saving offset. */
export function zonedToUtc(wall: string, tz: string) {
  const target = Date.parse(`${wall}:00Z`);
  let guess = target;
  for (let i = 0; i < 3; i++) {
    const local = new Intl.DateTimeFormat("sv-SE", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).format(guess);
    guess += target - Date.parse(local.replace(" ", "T") + "Z");
  }
  return new Date(guess).toISOString();
}

/** Shift elapsed time in UTC, then send origin wall time (independent of the device zone). */
export function shiftedDepartureRequest(plan: Plan, offsetHours: number): PlanRequest {
  const { origin, destination, cargo_lb, spacing_mi, wind_measure, rest, weather_slowdown } = plan.inputs;
  const departure = new Date(Date.parse(plan.inputs.departure_utc) + offsetHours * 3_600_000);
  const departure_local = new Intl.DateTimeFormat("sv-SE", {
    timeZone: plan.inputs.origin_tz,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(departure).replace(" ", "T");
  return { origin, destination, cargo_lb, spacing_mi, wind_measure, rest, departure_local,
    ...(weather_slowdown === undefined ? {} : { weather_slowdown }) };
}
