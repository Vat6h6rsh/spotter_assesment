import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { makeMockHeatmap, makeMockPlan, demoPlaces } from "../api/mock";
import type { Plan, PlanRequest } from "../api/types";
import { planner } from "./planner";
import { drive } from "../drive/state";
import { CarRoutingChip } from "../components/CarRoutingChip";

const inputs: PlanRequest = { origin: demoPlaces[0], destination: demoPlaces[1], departure_local: "2026-10-16T06:00", cargo_lb: 42000, spacing_mi: 25, wind_measure: "gust", rest: { mode: "auto" } };
let car: Plan, truck: Plan, fetchMock: ReturnType<typeof vi.fn<(url: string, init?: RequestInit) => Promise<unknown>>>;
let status: "pending" | "ready" | "failed" | "not_applicable", posts: number;
let sequence = 0;
const tick = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };
async function submit() {
  let pending: Promise<boolean>;
  act(() => { pending = planner.submit(inputs); });
  await tick(50);
  await act(async () => { await pending; });
}
beforeEach(() => {
  vi.useFakeTimers();
  car = makeMockPlan(inputs); car.plan_id = `car-${++sequence}`;
  car.providers.routing = { name: "osrm", truck_aware: false, truck_pending: true, fallback_reason: "pending" };
  truck = structuredClone(car); truck.plan_id = `truck-${sequence}`;
  truck.providers.routing = { name: "tomtom", truck_aware: true, truck_pending: false, fallback_reason: null };
  status = "pending"; posts = 0;
  const heatmap = makeMockHeatmap(car);
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => ({ ok: true, json: async () => {
    if (init?.method === "POST") return ++posts === 1 ? car : truck;
    if (url.endsWith("/truck-route")) return { status, retry_after_s: status === "pending" ? 3 : null };
    return heatmap;
  } }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  planner.cancel(); drive.end(); vi.useRealTimers(); vi.unstubAllGlobals();
});
it("polls, quietly re-POSTs the same inputs, swaps recommendation, closes checkpoint, saves and announces once", async () => {
  await submit(); render(<CarRoutingChip />);
  expect(screen.getByText(/finding truck route/)).toBeInTheDocument();
  planner.selectCheckpoint(car.routes[0].id, 1);
  const phases: string[] = [];
  const stop = planner.subscribe(() => phases.push(planner.get().phase));
  status = "ready"; await tick(3000); stop();
  expect(posts).toBe(2);
  const requests = fetchMock.mock.calls.filter(([, init]) => init?.method === "POST");
  expect(requests[1][1]!.body).toBe(requests[0][1]!.body);
  expect(new Set(phases)).toEqual(new Set(["idle"]));
  expect(planner.get()).toMatchObject({ truckUpgrade: "done", checkpoint: null, selectedRoute: truck.recommendation.route_id });
  expect(planner.get().heatmap).not.toBeNull();
  expect(JSON.parse(localStorage.getItem("spotter.lastPlan.v05")!).plan.plan_id).toBe(truck.plan_id);
  expect(screen.queryByText(/Car routing/)).not.toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("Truck route ready. Routes updated for your truck.");
  await tick(6000); expect(posts).toBe(2);
});
it.each(["drive", "edit"])("offers explicit swap when %s is active", async (mode) => {
  await submit(); render(<CarRoutingChip />);
  if (mode === "drive") act(() => drive.start(car, car.routes[0]));
  else planner.beginEdit();
  status = "ready"; await tick(3000);
  expect(planner.get().plan?.plan_id).toBe(car.plan_id);
  expect(planner.get().truckUpgrade).toBe("ready");
  fireEvent.click(screen.getByRole("button", { name: "Use truck route" }));
  await tick(1);
  expect(planner.get().plan?.plan_id).toBe(truck.plan_id);
  expect(drive.get().session).toBeNull();
});
it("shows each tooltip for 1.5 seconds once per plan, including failure", async () => {
  await submit(); const view = render(<CarRoutingChip />); await tick(0);
  expect(screen.getByRole("tooltip")).toHaveTextContent("Truck route is taking longer.");
  expect(document.querySelector(".car-chip")).toHaveAttribute("aria-describedby", screen.getByRole("tooltip").id);
  await tick(1499); expect(screen.getByRole("tooltip")).toBeInTheDocument();
  await tick(1); expect(screen.queryByRole("tooltip")).toBeNull();
  view.unmount(); render(<CarRoutingChip />); await tick(0);
  expect(screen.queryByRole("tooltip")).toBeNull();
  status = "failed"; await tick(1500); await tick(0);
  expect(screen.getByRole("tooltip")).toHaveTextContent("Truck route didn't load. These routes ignore truck limits.");
  expect(document.querySelector(".car-chip .spinner")).toBeNull();
  expect(screen.getByText("Car routing")).toBeInTheDocument();
  await tick(1500); expect(screen.queryByRole("tooltip")).toBeNull();
});
it("treats an expired status endpoint as failure", async () => {
  await submit(); fetchMock.mockResolvedValue({ ok: false, status: 404, json: async () => ({ error: { message: "Expired" } }) });
  await tick(3000); expect(planner.get().truckUpgrade).toBe("failed");
});
it("caps polling at 40 seconds", async () => {
  await submit();
  await tick(39000); expect(planner.get().truckUpgrade).toBe("pending");
  await tick(950); expect(planner.get().truckUpgrade).toBe("failed");
  const calls = fetchMock.mock.calls.length; await tick(60000); expect(fetchMock).toHaveBeenCalledTimes(calls);
});
it("aborts an in-flight status request at the deadline", async () => {
  await submit(); let signal: AbortSignal | null = null;
  fetchMock.mockImplementation((_url: string, init?: RequestInit) => {
    signal = init!.signal as AbortSignal;
    return new Promise((_resolve, reject) => signal!.addEventListener("abort", () => reject(new DOMException("Cancelled", "AbortError"))));
  });
  await tick(39950);
  expect(planner.get().truckUpgrade).toBe("failed");
  expect((signal as AbortSignal | null)?.aborted).toBe(true);
});
it("stops quietly for not_applicable", async () => {
  await submit(); status = "not_applicable"; await tick(3000);
  expect(planner.get().truckUpgrade).toBe("idle"); expect(posts).toBe(1);
});
it.each(["submit", "cancel", "retry"])("cancels old polling on %s", async (action) => {
  await submit();
  if (action === "cancel") planner.cancel();
  else { const pending = action === "retry" ? planner.retry() : planner.submit(inputs); await tick(50); await pending; }
  await tick(45000);
  expect(fetchMock.mock.calls.filter(([url]) => url.endsWith("/truck-route"))).toHaveLength(0);
});
it("renders old plans without new fields and never polls", async () => {
  car.providers.routing = { name: "osrm", truck_aware: false };
  await submit(); render(<CarRoutingChip />); await tick(45000);
  expect(screen.getByText("Car routing")).toBeInTheDocument();
  expect(planner.get().truckUpgrade).toBe("idle");
  expect(fetchMock.mock.calls.filter(([url]) => url.endsWith("/truck-route"))).toHaveLength(0);
});
it("honours the server's retry interval", async () => {
  await submit();
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ status: "pending", retry_after_s: 5 }) });
  await tick(3000); expect(fetchMock.mock.calls.filter(([url]) => url.endsWith("/truck-route"))).toHaveLength(1);
  await tick(4900); expect(fetchMock.mock.calls.filter(([url]) => url.endsWith("/truck-route"))).toHaveLength(1);
  await tick(100); expect(fetchMock.mock.calls.filter(([url]) => url.endsWith("/truck-route"))).toHaveLength(2);
});
it("ignores a late background re-plan after a new submission", async () => {
  await submit(); status = "ready";
  let resolve: (value: unknown) => void = () => {};
  fetchMock.mockImplementationOnce(async () => ({ ok: true, json: async () => ({ status: "ready", retry_after_s: null }) }))
    .mockImplementationOnce(() => new Promise(r => { resolve = r; }));
  await tick(3000);
  const pending = planner.submit(inputs); await tick(50); await pending;
  const latest = planner.get().plan;
  resolve({ ok: true, json: async () => ({ ...truck, plan_id: "stale" }) }); await tick(1);
  expect(planner.get().plan).toBe(latest);
});
it("replaces a still-loading car heatmap without leaving the heatmap phase stuck", async () => {
  const normalFetch = fetchMock.getMockImplementation()!;
  let heatRequests = 0;
  fetchMock.mockImplementation((url: string, init?: RequestInit) => {
    if (url.endsWith("/heatmap") && ++heatRequests === 1) {
      return new Promise((_resolve, reject) => init!.signal!.addEventListener("abort", () => reject(new DOMException("Cancelled", "AbortError"))));
    }
    return normalFetch(url, init);
  });
  const pending = planner.submit(inputs); await tick(50);
  expect(planner.get().phase).toBe("heatmap");
  status = "ready"; await tick(3000); await pending;
  expect(planner.get().plan?.plan_id).toBe(truck.plan_id);
  expect(planner.get().phase).toBe("idle");
  expect(planner.get().heatmap).not.toBeNull();
});
