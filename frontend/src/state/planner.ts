import { useSyncExternalStore } from "react";
import type { Heatmap, Plan, PlanRequest } from "../api/types";
import { ApiError, createPlan, forcedDemo, getHeatmap } from "../api/client";
import { prepareHeatmap } from "../lib/heatmap";
import type { PreparedHeatmap } from "../lib/heatmap";
import { timeline } from "./timeline";
import { serverWake } from "./serverWake";
type Phase = "idle" | "routes" | "weather" | "heatmap";
export type SelectionSource = "route-card" | "route-pill" | "map-line" | "truck" | "checkpoint-list" | "checkpoint-map";
interface PlannerState {
  plan: Plan | null;
  heatmap: PreparedHeatmap | null;
  phase: Phase;
  submitted: PlanRequest | null;
  startedAt: number | null;
  selectedRoute: string | null;
  checkpoint: number | null;
  selectionSource: SelectionSource | null;
  demo: boolean;
  error: string | null;
  heatmapError: string | null;
  cached: boolean;
  offline: boolean;
}
const CACHE = "spotter.lastPlan.v05";
function cachedPlan(): { plan: Plan; demo: boolean; heatmap?: Heatmap } | null {
  try {
    const data = JSON.parse(localStorage.getItem(CACHE) || "null");
    return data?.plan?.routes?.length && data?.plan?.inputs?.departure_utc
      ? data
      : null;
  } catch {
    return null;
  }
}
const cached = cachedPlan();
let initialHeatmap: PreparedHeatmap | null = null;
try {
  if (cached?.heatmap) initialHeatmap = prepareHeatmap(cached.heatmap);
} catch {
  /* Keep routes if corridor cache is damaged. */
}
let state: PlannerState = {
  plan: cached?.plan ?? null,
  heatmap: initialHeatmap,
  phase: "idle",
  submitted: null,
  startedAt: null,
  selectedRoute:
    cached?.plan.recommendation.route_id ?? cached?.plan.routes[0].id ?? null,
  checkpoint: null,
  selectionSource: null,
  demo: cached?.demo ?? forcedDemo,
  error: null,
  heatmapError: null,
  cached: !!cached,
  offline: !navigator.onLine,
};
const listeners = new Set<() => void>();
let requestController: AbortController | null = null;
let lastInputs: PlanRequest | null = cached?.plan.inputs ?? null;
function update(patch: Partial<PlannerState>) {
  state = { ...state, ...patch };
  listeners.forEach((fn) => fn());
}
function save() {
  if (!state.plan) return;
  try {
    localStorage.setItem(
      CACHE,
      JSON.stringify({
        plan: state.plan,
        demo: state.demo,
        ...(state.heatmap ? { heatmap: state.heatmap.data } : {}),
      }),
    );
  } catch {
    /* Private mode and full storage must never prevent planning. */
  }
}
async function loadHeatmap(
  plan: Plan,
  demo: boolean,
  signal: AbortSignal,
  allowRenew: boolean,
) {
  update({ phase: "heatmap", heatmapError: null });
  try {
    const data = await getHeatmap(plan, demo, signal);
    signal.throwIfAborted();
    const heatmap = prepareHeatmap(data);
    update({ heatmap, phase: "idle" });
    save();
  } catch (error) {
    if (signal.aborted) return;
    let failure = error;
    if (allowRenew && error instanceof ApiError && error.status === 404) {
      try {
        const renewed = await createPlan(plan.inputs, signal);
        signal.throwIfAborted();
        update({
          plan: renewed.data,
          demo: renewed.demo,
          selectedRoute: renewed.data.routes.some(
            (r) => r.id === state.selectedRoute,
          )
            ? state.selectedRoute
            : (renewed.data.recommendation.route_id ??
              renewed.data.routes[0]?.id ??
              null),
        });
        save();
        await loadHeatmap(renewed.data, renewed.demo, signal, false);
        return;
      } catch (renewError) {
        if (signal.aborted) return;
        failure = renewError;
      }
    }
    update({
      phase: "idle",
      heatmapError:
        failure instanceof Error
          ? failure.message
          : "Corridor forecast is unavailable.",
    });
  }
}
export const planner = {
  get: () => state,
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
  selectRoute(id: string, source: SelectionSource = "route-card") {
    update({ selectedRoute: id, checkpoint: null, selectionSource: source });
  },
  selectCheckpoint(route: string, i: number | null, source: SelectionSource = "checkpoint-list") {
    update({ selectedRoute: route, checkpoint: i, selectionSource: source });
  },
  setOffline(offline: boolean) {
    update({ offline });
  },
  async submit(inputs: PlanRequest) {
    requestController?.abort();
    const controller = new AbortController();
    requestController = controller;
    lastInputs = inputs;
    timeline.play(false);
    update({ phase: "routes", error: null, heatmapError: null, submitted: inputs, startedAt: Date.now() });
    try {
      if (["waking", "unavailable"].includes(serverWake.get().status)) await serverWake.wait(controller.signal);
      controller.signal.throwIfAborted();
      const result = await createPlan(inputs, controller.signal);
      controller.signal.throwIfAborted();
      const plan = result.data;
      timeline.reset();
      update({
        plan,
        heatmap: null,
        selectedRoute:
          plan.recommendation.route_id ?? plan.routes[0]?.id ?? null,
        checkpoint: null,
        selectionSource: null,
        demo: result.demo,
        cached: false,
        phase: "heatmap",
      });
      save();
      // A paint boundary lets the verdict and routes appear before corridor computation.
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => {
          requestAnimationFrame(() => resolve());
        }),
      );
      if (!controller.signal.aborted)
        await loadHeatmap(plan, result.demo, controller.signal, true);
      return !controller.signal.aborted;
    } catch (error) {
      if (controller.signal.aborted) return false;
      update({
        phase: "idle",
        error:
          error instanceof Error ? error.message : "Unable to plan this trip.",
      });
      return false;
    }
  },
  retry() {
    if (lastInputs) return planner.submit(lastInputs);
  },
  retryHeatmap() {
    if (!state.plan) return;
    requestController?.abort();
    requestController = new AbortController();
    return loadHeatmap(state.plan, state.demo, requestController.signal, true);
  },
  cancel() {
    requestController?.abort();
    update({ phase: "idle" });
  },
};
export const usePlanner = () =>
  useSyncExternalStore(planner.subscribe, planner.get);
