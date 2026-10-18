import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { demoPlaces, makeMockHeatmap, makeMockPlan } from "../api/mock";
import type { PlanRequest } from "../api/types";
const network = vi.hoisted(() => ({
  createPlan: vi.fn(),
  getHeatmap: vi.fn(),
  getTruckRouteStatus: vi.fn(),
}));
vi.mock("../api/client", () => ({
  ...network,
  forcedDemo: false,
  ApiError: class extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
}));
import { ApiError } from "../api/client";
import { planner } from "./planner";
const inputs: PlanRequest = {
  origin: demoPlaces[0],
  destination: demoPlaces[1],
  departure_local: "2026-10-16T06:00",
  cargo_lb: 42000,
  spacing_mi: 25,
  wind_measure: "gust",
  rest: { mode: "auto" },
};
beforeEach(() => {
  network.createPlan.mockReset();
  network.getHeatmap.mockReset();
  network.getHeatmap.mockImplementation(async (plan) => makeMockHeatmap(plan));
});
afterEach(() => planner.cancel());
describe("independent plan and heatmap lifecycle", () => {
  it("never polls demo plans, even if their pending flag is set", async () => {
    const plan = makeMockPlan(inputs);
    plan.providers.routing.truck_pending = true;
    network.createPlan.mockResolvedValue({ data: plan, demo: true });
    await planner.submit(inputs);
    expect(planner.get().truckUpgrade).toBe("idle");
    expect(network.getTruckRouteStatus).not.toHaveBeenCalled();
  });
  it("renews an expired plan once on a heatmap 404 and caches the renewed snapshot", async () => {
    const first = { ...makeMockPlan(inputs), plan_id: "expired" },
      second = { ...makeMockPlan(inputs), plan_id: "renewed" };
    network.createPlan
      .mockResolvedValueOnce({ data: first, demo: false })
      .mockResolvedValueOnce({ data: second, demo: false });
    network.getHeatmap.mockRejectedValueOnce(new ApiError("Expired", 404));
    expect(await planner.submit(inputs)).toBe(true);
    expect(network.createPlan).toHaveBeenCalledTimes(2);
    expect(network.getHeatmap).toHaveBeenCalledTimes(2);
    expect(planner.get().plan?.plan_id).toBe("renewed");
    expect(
      JSON.parse(localStorage.getItem("spotter.lastPlan.v05")!).plan.plan_id,
    ).toBe("renewed");
  });
  it("keeps routes visible when the heatmap fails independently", async () => {
    network.createPlan.mockResolvedValue({
      data: makeMockPlan(inputs),
      demo: false,
    });
    network.getHeatmap.mockRejectedValue(new Error("Corridor unavailable"));
    await planner.submit(inputs);
    expect(planner.get().plan?.routes).toHaveLength(3);
    expect(planner.get().heatmap).toBeNull();
    expect(planner.get().heatmapError).toBe("Corridor unavailable");
    expect(planner.get().error).toBeNull();
  });
  it("aborts an earlier plan and prevents its result from replacing the new one", async () => {
    let oldSignal: AbortSignal | null = null;
    network.createPlan
      .mockImplementationOnce((_inputs, signal: AbortSignal) => {
        oldSignal = signal;
        return new Promise((_, reject) =>
          signal.addEventListener(
            "abort",
            () => reject(new DOMException("cancelled", "AbortError")),
            { once: true },
          ),
        );
      })
      .mockResolvedValueOnce({
        data: { ...makeMockPlan(inputs), plan_id: "newest" },
        demo: false,
      });
    const pending = planner.submit(inputs);
    await planner.submit({ ...inputs, cargo_lb: 10000 });
    expect(await pending).toBe(false);
    expect((oldSignal as AbortSignal | null)?.aborted).toBe(true);
    expect(planner.get().plan?.plan_id).toBe("newest");
  });
});
