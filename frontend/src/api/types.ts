/** v0.5 §2 wire contract. Units: mi, s, lb, mph, in/hr; timestamps: UTC ISO-8601. */
export type Level = 0 | 1 | 2 | 3 | 4 | null;
export type WindMeasure = "gust" | "sustained";
export type Spacing = 10 | 25 | 50;
export type RestPlan =
  | { mode: "auto" }
  | { mode: "none" }
  | { mode: "custom"; drive_hours: number; rest_hours: number };
export interface Place {
  label: string;
  lat: number;
  lon: number;
}
export interface GeocodeResult extends Place {
  id: string;
  tz: string;
}
export interface GeocodeResponse {
  results: GeocodeResult[];
}
export type HotspotHazard = "wind" | "rain" | "snow" | "mixed";
export interface HotspotTrip {
  origin: Place & { tz: string };
  destination: Place & { tz: string };
  cargo_lb: number;
  departure_local: string;
  corridor: string;
  why: string;
  /** Actual exposure from a checked route; older servers omit this. */
  verified?: { max_level: Level; high_or_worse_mi: number; route_label: string };
}
export interface HotspotExample {
  hazard: HotspotHazard;
  headline: string;
  summary: string;
  suggested_trip: HotspotTrip;
}
export interface AvailableHotspot extends HotspotExample {
  available: true;
  generated_at: string;
  window_hours: number;
  peak: {
    place: string; lat: number; lon: number;
    gust_mph: number | null; wind_mph: number | null;
    rain_in: number | null; snow_in: number | null;
    at_utc: string; level_for_cargo: Level; cargo_lb: number;
  };
  alerts: Array<{ event: string; count: number; states: string[] }>;
  sources: { forecast: string; alerts: string };
  /** At most two different-hazard alternatives; older servers omit this. */
  more?: HotspotExample[];
}
export type WeatherHotspot = AvailableHotspot | { available: false; reason: string };
export interface PlanRequest {
  origin: Place;
  destination: Place;
  departure_local: string;
  cargo_lb: number;
  spacing_mi: Spacing;
  wind_measure: WindMeasure;
  rest: RestPlan;
  /** Default true: slow ETAs for forecast rain/snow (FHWA estimates). */
  weather_slowdown?: boolean;
}
export interface HealthResponse {
  status: "ok";
  version: string;
  routing: "tomtom" | "osrm";
  weather: "open-meteo";
  weather_budget: { used_today: number; limit: number };
}
export interface ApiErrorBody {
  error: { code: string; message: string; field?: string };
}
export interface Checkpoint {
  i: number;
  mi: number;
  lat: number;
  lon: number;
  /** Optional for plans saved before checkpoint place enrichment. */
  place?: {
    road: string | null;
    town: string | null;
    state: string | null;
    distance_mi: number | null;
    direction: string | null;
  } | null;
  place_label?: string;
  eta_utc: string;
  tz: string;
  elapsed_s: number;
  level: Level;
  wind_mph: number | null;
  gust_mph: number | null;
  rain_in: number | null;
  snow_in: number | null;
  base_wind_level: Level;
  load_adjusted: boolean;
  drivers: string[];
  rule: string;
  forecast_hour_utc: string | null;
  beyond_horizon: boolean;
  /** Fraction of normal speed on this checkpoint's stretch (1 = none). */
  speed_factor?: number;
  /** e.g. "Heavy snow −22%"; null when no slowdown. */
  slowdown?: string | null;
  /** Hours after this checkpoint's ETA until weather eases to High or below. */
  clears_in_h?: number | null;
  /** Clearing instant in UTC; optional for older cached plans. */
  clears_at_utc?: string | null;
}
export interface Rest {
  at_mi: number;
  start_utc: string;
  duration_s: number;
  kind: "break30" | "rest10h" | "custom";
  lat: number;
  lon: number;
}
export interface MilesByLevel {
  low: number;
  moderate: number;
  high: number;
  severe: number;
  no_travel: number;
  unknown: number;
}
export interface Route {
  id: string;
  label: string;
  rank: number;
  eligible: boolean;
  is_fastest: boolean;
  polyline: string;
  bbox: [number, number, number, number];
  distance_mi: number;
  drive_s: number;
  /** Extra driving seconds from weather slowdowns (included in drive_s and total_s). */
  weather_delay_s?: number;
  rest_s: number;
  total_s: number;
  arrival_utc: string;
  arrival_tz: string;
  risk: {
    miles_by_level: MilesByLevel;
    avg_risk: number | null;
    coverage: number;
    max_level: Level;
  };
  rests: Rest[];
  progress: [number, number][];
  checkpoints: Checkpoint[];
}
export interface Recommendation {
  status: "recommended" | "tentative" | "none_eligible" | "insufficient_data";
  route_id: string | null;
  reasons: string[];
  tradeoff: string;
  departure_advice: {
    offset_h: number;
    route_id: string;
    summary: string;
  } | null;
}
export interface Plan {
  plan_id: string;
  created_at: string;
  inputs: PlanRequest & { departure_utc: string; origin_tz: string };
  providers: {
    routing: { name: "tomtom" | "osrm"; truck_aware: boolean; truck_pending?: boolean; fallback_reason?: null | "no_key" | "pending" | "timeout" | "error" };
    weather: { name: "open-meteo"; fetched_at: string };
  };
  warnings: { code: string; message: string }[];
  recommendation: Recommendation;
  routes: Route[];
}
export interface TruckRouteStatus {
  status: "pending" | "ready" | "failed" | "not_applicable";
  retry_after_s: number | null;
}
export interface Heatmap {
  plan_id: string;
  res: 3 | 4;
  base_utc: string;
  hours: number;
  cells: string[];
  /** hour-major: [hour * cells.length + cell]; 255 = Unknown */
  levels_b64: string;
  fetched_at: string;
}
