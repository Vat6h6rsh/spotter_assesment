import type { Plan, Route, Checkpoint } from '../api/types';
import { interpolateProgress, pointAtDistance, prepareGeometry, truckPosition } from '../lib/geometry';
import type { Coordinate } from '../lib/geometry';

export const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
export const previewPacing = (seconds: number) => clamp(40000 / Math.max(1, Math.ceil(seconds / 3600)), 1000, 3000);
export function forecastBase(plan: Plan, base?: string) {
  return base ?? new Date(Math.floor(Date.parse(plan.inputs.departure_utc) / 3600000) * 3600000).toISOString();
}
export const departureHour = (plan: Plan, base: string) => (Date.parse(plan.inputs.departure_utc) - Date.parse(base)) / 3600000;
export function bearing(a: Coordinate, b: Coordinate) {
  const r = Math.PI / 180, d = (b[0] - a[0]) * r;
  return Math.atan2(Math.sin(d) * Math.cos(b[1] * r), Math.cos(a[1] * r) * Math.sin(b[1] * r) - Math.sin(a[1] * r) * Math.cos(b[1] * r) * Math.cos(d)) / r;
}
export function routePose(geometry: ReturnType<typeof prepareGeometry>, elapsed: number) {
  const mi = interpolateProgress(geometry.progress, elapsed), end = geometry.prefix.at(-1) ?? 0;
  const distance = mi / (geometry.distance || 1) * end;
  const a = pointAtDistance(geometry.points, geometry.prefix, Math.max(0, distance - .15));
  const b = pointAtDistance(geometry.points, geometry.prefix, Math.min(end, distance + .15));
  let lo = 0, hi = geometry.progress.length;
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (geometry.progress[mid][0] <= elapsed) lo = mid + 1; else hi = mid; }
  const i = clamp(lo, 1, geometry.progress.length - 1);
  const before = geometry.progress[i - 1], after = geometry.progress[i];
  const mph = before && after ? (after[1] - before[1]) / Math.max(1, after[0] - before[0]) * 3600 : 0;
  return { position: truckPosition(geometry, elapsed), heading: bearing(a, b), mi, mph };
}
export function speedToZoom(lat: number, mph: number, speed: number, msPerHour: number) {
  const metresPerSecond = Math.max(1, mph) * 1609.344 / (msPerHour / 1000) * speed;
  return clamp(Math.log2(78271.517 * Math.cos(lat * Math.PI / 180) * 250 / metresPerSecond), 5.5, 9.5);
}
export function smoothBearing(current: number, target: number, dt: number, speed: number) {
  const delta = ((target - current + 540) % 360 + 360) % 360 - 180;
  if (Math.abs(delta) < 1.5) return current;
  return current + clamp(delta * (1 - Math.exp(-dt / (.9 + (speed - 1) / 6))), -25 * dt, 25 * dt);
}
export function motionPolicy(reduced: boolean) {
  return { three: !reduced, follow: !reduced, introMs: reduced ? 0 : 2000, outroMs: reduced ? 0 : 1400, pitch: reduced ? 0 : 56 };
}
export interface CardTrigger { id: string; elapsed: number; position: Coordinate; checkpoint?: Checkpoint; restIndex?: number }
export function selectCardTriggers(plan: Plan, route: Route): CardTrigger[] {
  return [
    ...route.checkpoints.filter(cp => (cp.level ?? 0) >= 1 || Boolean(cp.slowdown) || (cp.speed_factor ?? 1) < 1)
      .map(cp => ({ id: `cp-${cp.i}`, elapsed: cp.elapsed_s, position: [cp.lon, cp.lat] as Coordinate, checkpoint: cp })),
    ...route.rests.map((rest, i) => ({ id: `rest-${i}`, elapsed: (Date.parse(rest.start_utc) - Date.parse(plan.inputs.departure_utc)) / 1000, position: [rest.lon, rest.lat] as Coordinate, restIndex: i })),
  ].sort((a, b) => a.elapsed - b.elapsed);
}
export function tripBounds(plan: Plan): [number, number, number, number] {
  const boxes = plan.routes.map(r => r.bbox), ends = [plan.inputs.origin, plan.inputs.destination];
  return [Math.min(...boxes.map(b => b[0]), ...ends.map(p => p.lon)), Math.min(...boxes.map(b => b[1]), ...ends.map(p => p.lat)), Math.max(...boxes.map(b => b[2]), ...ends.map(p => p.lon)), Math.max(...boxes.map(b => b[3]), ...ends.map(p => p.lat))];
}
