import polyline from "@mapbox/polyline";
import type { Route } from "../api/types";
export type Coordinate = [number, number]; // longitude, latitude
export function haversine(a: Coordinate, b: Coordinate) {
  const rad = Math.PI / 180;
  const h =
    Math.sin(((b[1] - a[1]) * rad) / 2) ** 2 +
    Math.cos(a[1] * rad) *
      Math.cos(b[1] * rad) *
      Math.sin(((b[0] - a[0]) * rad) / 2) ** 2;
  return 3958.7613 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}
export function prefixMiles(points: Coordinate[]) {
  const distances = [0];
  for (let i = 1; i < points.length; i++)
    distances.push(distances[i - 1] + haversine(points[i - 1], points[i]));
  return distances;
}
/** Upper bound. Handles duplicate knots and exact rest boundaries. */
export function upperBound(values: number[], target: number) {
  let low = 0,
    high = values.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (values[mid] <= target) low = mid + 1;
    else high = mid;
  }
  return low;
}
export function interpolateProgress(
  progress: [number, number][],
  elapsed: number,
): number {
  if (!progress.length) return 0;
  if (elapsed <= progress[0][0]) return progress[0][1];
  let lo = 0,
    hi = progress.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (progress[mid][0] <= elapsed) lo = mid + 1;
    else hi = mid;
  }
  if (lo >= progress.length) return progress.at(-1)![1];
  const [a, b] = [progress[lo - 1], progress[lo]];
  return a[1] + ((b[1] - a[1]) * (elapsed - a[0])) / (b[0] - a[0]);
}
export function pointAtDistance(
  points: Coordinate[],
  prefix: number[],
  miles: number,
): Coordinate {
  if (!points.length) return [0, 0];
  if (miles <= 0) return points[0];
  const i = upperBound(prefix, miles);
  if (i >= points.length) return points.at(-1)!;
  const span = prefix[i] - prefix[i - 1];
  const t = span ? (miles - prefix[i - 1]) / span : 0;
  return [
    points[i - 1][0] + t * (points[i][0] - points[i - 1][0]),
    points[i - 1][1] + t * (points[i][1] - points[i - 1][1]),
  ];
}
export function prepareGeometry(route: Route) {
  const points: Coordinate[] = polyline
    .decode(route.polyline, 5)
    .map(([lat, lon]) => [lon, lat]);
  const prefix = prefixMiles(points);
  return {
    points,
    prefix,
    distance: route.distance_mi,
    progress: route.progress,
  };
}
export function truckPosition(
  geometry: ReturnType<typeof prepareGeometry>,
  elapsed: number,
): Coordinate {
  const miles = interpolateProgress(geometry.progress, elapsed);
  return pointAtDistance(
    geometry.points,
    geometry.prefix,
    (miles / (geometry.distance || 1)) * geometry.prefix.at(-1)!,
  );
}
