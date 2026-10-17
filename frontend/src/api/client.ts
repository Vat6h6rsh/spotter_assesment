import type {
  ApiErrorBody,
  GeocodeResponse,
  Heatmap,
  Plan,
  PlanRequest,
  WeatherHotspot,
} from "./types";
const API_BASE = (
  import.meta.env.VITE_API_BASE || "http://localhost:8000"
).replace(/\/$/, "");
export const forcedDemo = import.meta.env.VITE_USE_MOCK === "1";
export class ApiError extends Error {
  status: number;
  field?: string;
  constructor(message: string, status: number, field?: string) {
    super(message);
    this.status = status;
    this.field = field;
  }
}
export function delay(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    signal.throwIfAborted();
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("Request cancelled", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
/** Every attempt has a timeout; caller cancellation aborts retries and response parsing too. */
async function request<T>(
  path: string,
  signal: AbortSignal,
  body?: unknown,
): Promise<T> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal.throwIfAborted();
    signal.addEventListener("abort", abort, { once: true });
    const timeout = setTimeout(abort, body ? 18000 : 8000);
    try {
      const response = await fetch(`${API_BASE}/api/${path}`, {
        signal: controller.signal,
        ...(body
          ? {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            }
          : {}),
      });
      if (!response.ok) {
        const error: ApiErrorBody | null = await response
          .json()
          .catch(() => null);
        throw new ApiError(
          error?.error?.message ||
            `Request failed (${response.status}). Please try again.`,
          response.status,
          error?.error?.field,
        );
      }
      try {
        return (await response.json()) as T;
      } catch (error) {
        if (controller.signal.aborted) throw error;
        throw new ApiError(
          "The service returned unreadable data. Please retry.",
          502,
        );
      }
    } catch (error) {
      signal.throwIfAborted();
      if (error instanceof ApiError || attempt === 1) throw error;
    } finally {
      clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
    }
    await delay(450 + Math.random() * 150, signal);
  }
  throw new Error("Unable to reach the routing service.");
}
export async function geocode(query: string, signal: AbortSignal) {
  if (!forcedDemo) {
    try {
      return {
        data: await request<GeocodeResponse>(
          `geocode?q=${encodeURIComponent(query)}&limit=5`,
          signal,
        ),
        demo: false,
      };
    } catch (error) {
      signal.throwIfAborted();
      if (error instanceof ApiError) throw error;
    }
  }
  const { demoPlaces } = await import("./mock");
  signal.throwIfAborted();
  return {
    data: {
      results: demoPlaces
        .filter((place) =>
          place.label.toLowerCase().includes(query.toLowerCase()),
        )
        .slice(0, 5),
    },
    demo: true,
  };
}
export async function createPlan(inputs: PlanRequest, signal: AbortSignal) {
  // Geocode objects and normalized plan echoes carry extra fields. Send only §2 inputs.
  const requestBody: PlanRequest = {
    origin: {
      label: inputs.origin.label,
      lat: inputs.origin.lat,
      lon: inputs.origin.lon,
    },
    destination: {
      label: inputs.destination.label,
      lat: inputs.destination.lat,
      lon: inputs.destination.lon,
    },
    departure_local: inputs.departure_local,
    cargo_lb: inputs.cargo_lb,
    spacing_mi: inputs.spacing_mi,
    wind_measure: inputs.wind_measure,
    rest: inputs.rest,
    // Omitted only for old cached plans; the backend default is true.
    ...(inputs.weather_slowdown === undefined ? {} : { weather_slowdown: inputs.weather_slowdown }),
  };
  if (!forcedDemo) {
    try {
      return {
        data: await request<Plan>("plans", signal, requestBody),
        demo: false,
      };
    } catch (error) {
      signal.throwIfAborted();
      if (error instanceof ApiError) throw error;
    }
  }
  const { makeMockPlan } = await import("./mock");
  await delay(650, signal);
  return { data: makeMockPlan(requestBody), demo: true };
}
export async function getHeatmap(
  plan: Plan,
  demo: boolean,
  signal: AbortSignal,
) {
  if (demo) {
    const { makeMockHeatmap } = await import("./mock");
    await delay(350, signal);
    return makeMockHeatmap(plan);
  }
  return request<Heatmap>(
    `plans/${encodeURIComponent(plan.plan_id)}/heatmap`,
    signal,
  );
}

/** Showcase failures stay quiet; only explicit demo mode uses illustrative weather. */
export async function getWeatherHotspot(signal: AbortSignal, demo = forcedDemo): Promise<WeatherHotspot> {
  signal.throwIfAborted();
  if (demo || forcedDemo) {
    const { makeMockHotspot } = await import("./mock");
    signal.throwIfAborted();
    return makeMockHotspot();
  }
  return request<WeatherHotspot>("weather/hotspot", signal);
}
