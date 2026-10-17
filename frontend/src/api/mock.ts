import { gridDisk, latLngToCell, cellToLatLng } from "h3-js";
import polyline from "@mapbox/polyline";
import type {
  Checkpoint,
  GeocodeResult,
  Heatmap,
  Level,
  Plan,
  PlanRequest,
  Rest,
  Route,
  AvailableHotspot,
} from "./types";
import { haversine, pointAtDistance, prefixMiles } from "../lib/geometry";
import type { Coordinate } from "../lib/geometry";
import { zonedToUtc, duration, nextDeparture } from "../lib/time";

/** Illustrative weather along the same corridors as the route demo, never a live alert. */
export function makeMockHotspot(): AvailableHotspot {
  const departure_local = nextDeparture("America/Chicago").slice(0, 14) + "00";
  const suggested_trip = {
    origin: { label: "Joliet, IL, USA", lat: 41.525, lon: -88.081, tz: "America/Chicago" },
    destination: { label: "Denver, CO, USA", lat: 39.739, lon: -104.99, tz: "America/Denver" },
    cargo_lb: 43000, departure_local, corridor: "I-80",
    why: "I-80 crosses the exposed plains of Nebraska before reaching Colorado.",
  };
  return {
    available: true, generated_at: new Date().toISOString(), window_hours: 48,
    hazard: "wind", headline: "Strong crosswinds on I-80 across Nebraska",
    summary: "Gusts near 50 mph around North Platte can push loaded trucks into No Travel conditions. This demo forecast shows how a safer alternative compares.",
    peak: { place: "North Platte, NE", lat: 41.14, lon: -100.76, gust_mph: 50.3, wind_mph: 28.2, rain_in: 0, snow_in: 0, at_utc: zonedToUtc(departure_local, "America/Chicago"), level_for_cargo: 4, cargo_lb: 43000 },
    alerts: [{ event: "High Wind Warning", count: 3, states: ["NE", "CO"] }],
    suggested_trip, sources: { forecast: "Open-Meteo", alerts: "NWS api.weather.gov" },
    more: [{ hazard: "snow", headline: "Heavy snow near the Colorado Front Range", summary: "Snow near Denver adds weather delay and raises risk on the final stretch. These are illustrative demo conditions.", suggested_trip: { ...suggested_trip, corridor: "I-76", why: "I-76 approaches Denver through the snow zone." } }],
  };
}

export const demoPlaces: GeocodeResult[] = [
  {
    id: "joliet",
    label: "Joliet, IL, USA",
    lat: 41.525,
    lon: -88.081,
    tz: "America/Chicago",
  },
  {
    id: "denver",
    label: "Denver, CO, USA",
    lat: 39.739,
    lon: -104.99,
    tz: "America/Denver",
  },
  {
    id: "chicago",
    label: "Chicago, IL, USA",
    lat: 41.878,
    lon: -87.63,
    tz: "America/Chicago",
  },
  {
    id: "omaha",
    label: "Omaha, NE, USA",
    lat: 41.257,
    lon: -95.995,
    tz: "America/Chicago",
  },
  {
    id: "kansas",
    label: "Kansas City, MO, USA",
    lat: 39.1,
    lon: -94.579,
    tz: "America/Chicago",
  },
  {
    id: "toronto",
    label: "Toronto, ON, Canada",
    lat: 43.653,
    lon: -79.383,
    tz: "America/Toronto",
  },
];
// Road-following control points for the three illustrative interstate corridors.
const paths: Coordinate[][] = [
  [
    [-88.081, 41.525],
    [-89.1, 41.4],
    [-90.58, 41.6],
    [-91.66, 41.67],
    [-93.61, 41.6],
    [-95.86, 41.25],
    [-96.7, 41.15],
    [-98.38, 40.83],
    [-99.1, 40.71],
    [-100.77, 41.12],
    [-101.72, 41.1],
    [-102.2, 41.13],
    [-102.61, 40.83],
    [-103.21, 40.26],
    [-104.17, 40.17],
    [-104.99, 39.739],
  ],
  [
    [-88.081, 41.525],
    [-89.1, 41.4],
    [-90.58, 41.6],
    [-91.66, 41.67],
    [-93.61, 41.6],
    [-95.86, 41.25],
    [-96.68, 40.81],
    [-97.57, 40.82],
    [-98.38, 40.83],
    [-99.08, 40.7],
    [-100.16, 40.15],
    [-101.53, 40.14],
    [-102.27, 40.07],
    [-103.21, 40.26],
    [-104.17, 40.17],
    [-104.99, 39.739],
  ],
  [
    [-88.081, 41.525],
    [-88.84, 41.35],
    [-89.4, 40.69],
    [-90.01, 40.46],
    [-91.4, 40.17],
    [-92.58, 39.79],
    [-94.58, 39.1],
    [-95.68, 39.05],
    [-96.57, 39.13],
    [-97.61, 38.88],
    [-99.33, 38.88],
    [-100.86, 39.0],
    [-101.71, 39.35],
    [-102.79, 39.28],
    [-103.69, 39.28],
    [-104.27, 39.73],
    [-104.99, 39.739],
  ],
];
function densify(points: Coordinate[]) {
  const dense: Coordinate[] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const count = Math.ceil(haversine(points[i - 1], points[i]) / 5);
    for (let j = 1; j <= count; j++)
      dense.push([
        points[i - 1][0] + ((points[i][0] - points[i - 1][0]) * j) / count,
        points[i - 1][1] + ((points[i][1] - points[i - 1][1]) * j) / count,
      ]);
  }
  return dense;
}
const iso = (start: number, elapsed: number) =>
  new Date(start + elapsed * 1000).toISOString();

// Approximate town centres for the illustrative corridors, never a live geocode claim.
const corridorTowns: [string, string, number, number][] = [
  ["Joliet", "IL", -88.081, 41.525], ["Davenport", "IA", -90.58, 41.6],
  ["Iowa City", "IA", -91.53, 41.66], ["Des Moines", "IA", -93.61, 41.6],
  ["Omaha", "NE", -95.995, 41.257], ["Lincoln", "NE", -96.68, 40.81],
  ["Grand Island", "NE", -98.38, 40.93], ["Kearney", "NE", -99.08, 40.7],
  ["North Platte", "NE", -100.77, 41.12], ["Ogallala", "NE", -101.72, 41.13],
  ["McCook", "NE", -100.63, 40.2], ["Sterling", "CO", -103.21, 40.63],
  ["Kansas City", "MO", -94.58, 39.1], ["Topeka", "KS", -95.68, 39.05],
  ["Salina", "KS", -97.61, 38.84], ["Hays", "KS", -99.33, 38.88],
  ["Colby", "KS", -101.05, 39.4], ["Limon", "CO", -103.69, 39.26],
  ["Denver", "CO", -104.99, 39.739],
];
function mockPlace(point: Coordinate, route: number): Pick<Checkpoint, "place" | "place_label"> {
  const [town, state, lon, lat] = corridorTowns.reduce((nearest, candidate) =>
    haversine(point, [candidate[2], candidate[3]]) < haversine(point, [nearest[2], nearest[3]]) ? candidate : nearest);
  const distance_mi = Math.round(haversine([lon, lat], point));
  const direction = ["E", "NE", "N", "NW", "W", "SW", "S", "SE"][(Math.round(Math.atan2(point[1] - lat, (point[0] - lon) * Math.cos(lat * Math.PI / 180)) / (Math.PI / 4)) + 8) % 8];
  const road = point[0] < -102 ? route === 2 ? "I-70 W" : "I-76 W" : route === 2 ? point[0] < -94 ? "I-70 W" : "US-36 W" : route === 1 && point[0] < -99 ? "US-34 W" : "I-80 W";
  return {
    place: { road, town, state, distance_mi, direction },
    place_label: `${road} · ${distance_mi ? `${distance_mi} mi ${direction} of ` : ""}${town}, ${state}`,
  };
}

export function makeMockPlan(request: PlanRequest): Plan {
  const departure = zonedToUtc(request.departure_local, "America/Chicago");
  const start = Date.parse(departure);
  const routes = paths.map((path, routeIndex): Route => {
    const points = densify(path),
      prefix = prefixMiles(points);
    const distance = [1012.4, 1041.7, 1098.6][routeIndex];
    const drive = [54000, 56400, 59340][routeIndex];
    const position = (mi: number) =>
      pointAtDistance(points, prefix, (mi / distance) * prefix.at(-1)!);
    const progress: [number, number][] = [[0, 0]],
      rests: Rest[] = [];
    let driven = 0,
      elapsed = 0,
      continuous = 0,
      day = 0;
    while (driven < drive) {
      const interval =
        request.rest.mode === "none"
          ? drive
          : request.rest.mode === "custom"
            ? request.rest.drive_hours * 3600
            : Math.min(28800 - continuous, 39600 - day);
      const chunk = Math.min(interval, drive - driven);
      driven += chunk;
      elapsed += chunk;
      continuous += chunk;
      day += chunk;
      const mi = (distance * driven) / drive;
      progress.push([elapsed, mi]);
      if (driven >= drive) break;
      const kind =
        request.rest.mode === "custom"
          ? "custom"
          : day >= 39600
            ? "rest10h"
            : "break30";
      const duration =
        kind === "custom" && request.rest.mode === "custom"
          ? request.rest.rest_hours * 3600
          : kind === "rest10h"
            ? 36000
            : 1800;
      const [lon, lat] = position(mi);
      rests.push({
        at_mi: mi,
        start_utc: iso(start, elapsed),
        duration_s: duration,
        kind,
        lat,
        lon,
      });
      elapsed += duration;
      continuous = 0;
      if (kind === "rest10h" || kind === "custom") day = 0;
      progress.push([elapsed, mi]);
    }
    const elapsedAtMile = (mi: number) => {
      const driveS = (mi / distance) * drive;
      return (
        driveS +
        rests
          .filter((r) => r.at_mi < mi)
          .reduce((sum, r) => sum + r.duration_s, 0)
      );
    };
    const miles = Array.from(
      { length: Math.ceil(distance / request.spacing_mi) },
      (_, i) => i * request.spacing_mi,
    ).concat(distance);
    const checkpoints = miles.map((mi, i): Checkpoint => {
      const [lon, lat] = position(mi);
      const f = mi / distance;
      let level: Level = 0;
      if (f > 0.24 && f < 0.7) level = 1;
      if (routeIndex === 0 && f >= 0.55 && f <= 0.66) level = 2;
      if (routeIndex === 1 && f >= 0.59 && f < 0.62) level = 2;
      if (routeIndex === 2 && f >= 0.48 && f <= 0.55) level = 3;
      const wind = level === 3 ? 38 : level === 2 ? 22 : level === 1 ? 19 : 11;
      const gust =
        level === 3
          ? f <= 0.52
            ? 39
            : 46
          : level === 2
            ? 31
            : level === 1
              ? 28
              : 21;
      const measured =
        request.wind_measure === "gust" ? Math.max(wind, gust) : wind;
      const baseWind = (
        measured >= 55
          ? 4
          : measured >= 45
            ? 3
            : measured >= 35
              ? 2
              : measured >= 25
                ? 1
                : 0
      ) as Exclude<Level, null>;
      const adjusted: Level =
        measured >= 45 && request.cargo_lb > 30000
          ? 4
          : measured >= 35 && request.cargo_lb > 40000
            ? 3
            : baseWind;
      const rain =
        level === 2 ? 0.32 : level === 3 ? 0.58 : level === 1 ? 0.12 : 0;
      const rainLevel =
        rain >= 0.5 ? 3 : rain >= 0.25 ? 2 : rain >= 0.1 ? 1 : 0;
      level = Math.max(adjusted, rainLevel) as Exclude<Level, null>;
      const drivers: string[] = [];
      if (level >= 1 && adjusted === level) drivers.push("wind");
      if (level >= 1 && rainLevel === level) drivers.push("rain");
      const rule =
        adjusted > baseWind && adjusted === level
          ? `Wind ${measured} mph and cargo > ${adjusted === 4 ? "30,000" : "40,000"} lb → ${adjusted === 4 ? "No Travel" : "Severe"}`
          : level === 3
            ? "Rain 0.50–1.00 in/hr → Severe"
            : level === 2
              ? "Rain 0.25–0.49 in/hr → High"
              : level === 1
                ? "Wind 25–34 mph or rain 0.10–0.24 in/hr → Moderate"
                : "All conditions Low";
      const checkpointElapsed = elapsedAtMile(mi);
      // Illustrative hourly easing after arrival; the final blocked point has no clearing in the scan.
      const clearsIn = level >= 3 ? level === 4 && f > 0.54 ? null : level === 4 ? 8 : 4 : null;
      return {
        i,
        mi,
        lat,
        lon,
        elapsed_s: checkpointElapsed,
        ...mockPlace([lon, lat], routeIndex),
        eta_utc: iso(start, checkpointElapsed),
        clears_in_h: clearsIn,
        clears_at_utc: clearsIn === null ? null : iso(start, checkpointElapsed + clearsIn * 3600),
        tz: lon < -102 ? "America/Denver" : "America/Chicago",
        level,
        wind_mph: wind,
        gust_mph: gust,
        rain_in: rain,
        snow_in: 0,
        base_wind_level: baseWind,
        load_adjusted: adjusted > baseWind,
        drivers,
        rule,
        forecast_hour_utc: new Date(
          Math.round((start + checkpointElapsed * 1000) / 3600000) * 3600000,
        ).toISOString(),
        beyond_horizon: false,
      };
    });
    const counts = {
      low: 0,
      moderate: 0,
      high: 0,
      severe: 0,
      no_travel: 0,
      unknown: 0,
    };
    const keys = [
      "low",
      "moderate",
      "high",
      "severe",
      "no_travel",
      "unknown",
    ] as const;
    let weighted = 0;
    checkpoints.forEach((cp, i) => {
      const before = i === 0 ? 0 : (checkpoints[i - 1].mi + cp.mi) / 2;
      const after =
        i === checkpoints.length - 1
          ? distance
          : (cp.mi + checkpoints[i + 1].mi) / 2;
      counts[keys[cp.level ?? 5]] += after - before;
      weighted += (cp.level ?? 0) * (after - before);
    });
    return {
      id: ["A", "B", "C"][routeIndex],
      label: ["I-80 / I-76", "US-34 / I-76", "I-70 / US-36"][routeIndex],
      rank: [2, 1, 3][routeIndex],
      eligible: counts.no_travel === 0,
      is_fastest: routeIndex === 0,
      polyline: polyline.encode(points.map(([lon, lat]) => [lat, lon])),
      bbox: [
        Math.min(...points.map((p) => p[0])),
        Math.min(...points.map((p) => p[1])),
        Math.max(...points.map((p) => p[0])),
        Math.max(...points.map((p) => p[1])),
      ],
      distance_mi: distance,
      drive_s: drive,
      rest_s: elapsed - drive,
      total_s: elapsed,
      arrival_utc: iso(start, elapsed),
      arrival_tz: "America/Denver",
      risk: {
        miles_by_level: counts,
        avg_risk: weighted / distance,
        coverage: 1,
        max_level: Math.max(...checkpoints.map((cp) => cp.level ?? 0)) as Level,
      },
      progress,
      rests,
      checkpoints,
    };
  });
  const [a, b, c] = routes;
  return {
    plan_id: `demo_${Date.now()}`,
    created_at: new Date().toISOString(),
    inputs: {
      ...request,
      origin: {
        label: demoPlaces[0].label,
        lat: demoPlaces[0].lat,
        lon: demoPlaces[0].lon,
      },
      destination: {
        label: demoPlaces[1].label,
        lat: demoPlaces[1].lat,
        lon: demoPlaces[1].lon,
      },
      departure_utc: departure,
      origin_tz: "America/Chicago",
    },
    providers: {
      routing: { name: "osrm", truck_aware: false },
      weather: { name: "open-meteo", fetched_at: new Date().toISOString() },
    },
    warnings: [
      {
        code: "DEMO",
        message:
          "Illustrative Joliet–Denver corridor. Weather, routes and rest stops are simulated.",
      },
    ],
    recommendation: {
      status: "recommended",
      route_id: "B",
      reasons: [
        `${Math.round(b.risk.miles_by_level.high)} High mi vs ${Math.round(a.risk.miles_by_level.high)} on A`,
        `${Math.round(b.risk.miles_by_level.severe)} Severe mi vs ${Math.round(c.risk.miles_by_level.severe)} on C`,
      ],
      tradeoff: `${duration(b.total_s - a.total_s)} more than the fastest route, with less exposure to hazardous weather.`,
      departure_advice: {
        offset_h: 6,
        route_id: "A",
        summary:
          "In this simulation, leaving 6 h later reduces the High stretch on A.",
      },
    },
    routes,
  };
}

export function makeMockHeatmap(plan: Plan): Heatmap {
  const cells = new Set<string>();
  for (const route of plan.routes)
    for (const [lat, lon] of polyline.decode(route.polyline))
      for (const cell of gridDisk(latLngToCell(lat, lon, 4), 1))
        cells.add(cell);
  const ids = [...cells],
    levels = new Uint8Array(ids.length * 49);
  for (let hour = 0; hour < 49; hour++)
    ids.forEach((cell, i) => {
      const [lat, lon] = cellToLatLng(cell);
      const stormLon = -99.3 + Math.sin(hour / 12) * 2.8;
      const storm = Math.exp(
        -(
          (lon - stormLon) ** 2 / 2.8 +
          (lat - 39.15 - Math.sin(hour / 9) * 0.8) ** 2 / 1.2
        ),
      );
      const northBand = Math.exp(
        -((lon + 98 - hour / 30) ** 2 / 2.5 + (lat - 41.3) ** 2 / 0.5),
      );
      levels[hour * ids.length + i] =
        (i + hour * 7) % 137 === 0
          ? 255
          : Math.min(4, Math.floor(Math.max(storm * 4.2, northBand * 2.8)));
    });
  let binary = "";
  levels.forEach((level) => {
    binary += String.fromCharCode(level);
  });
  return {
    plan_id: plan.plan_id,
    res: 4,
    base_utc: new Date(
      Math.floor(Date.parse(plan.inputs.departure_utc) / 3600000) * 3600000,
    ).toISOString(),
    hours: 49,
    cells: ids,
    levels_b64: btoa(binary),
    fetched_at: new Date().toISOString(),
  };
}
