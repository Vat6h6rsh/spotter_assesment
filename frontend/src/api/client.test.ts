import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlanRequest } from "./types";
import { demoPlaces, makeMockPlan } from "./mock";
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
  vi.useFakeTimers();
  vi.stubEnv("VITE_USE_MOCK", "0");
  vi.resetModules();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
describe("API resilience", () => {
  it("reports an invalid JSON response without replacing live data with a demo", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => {
        throw new SyntaxError("invalid JSON");
      },
    });
    vi.stubGlobal("fetch", fetchMock);
    const { createPlan } = await import("./client");
    await expect(
      createPlan(inputs, new AbortController().signal),
    ).rejects.toMatchObject({
      status: 502,
      message: "The service returned unreadable data. Please retry.",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("retries one network failure, with a fresh AbortController for each attempt", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("network"))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makeMockPlan(inputs),
      });
    vi.stubGlobal("fetch", fetchMock);
    const { createPlan } = await import("./client");
    const pending = createPlan(inputs, new AbortController().signal);
    await vi.advanceTimersByTimeAsync(1000);
    const result = await pending;
    expect(result.demo).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][1].signal).not.toBe(
      fetchMock.mock.calls[1][1].signal,
    );
    const body = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(Object.keys(body.origin).sort()).toEqual(["label", "lat", "lon"]);
    expect(Object.keys(body).sort()).toEqual([
      "cargo_lb",
      "departure_local",
      "destination",
      "origin",
      "rest",
      "spacing_mi",
      "wind_measure",
    ]);
  });
  it("uses labelled demo data only after both network attempts fail", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("unreachable"));
    vi.stubGlobal("fetch", fetchMock);
    const { createPlan } = await import("./client");
    const pending = createPlan(inputs, new AbortController().signal);
    await vi.advanceTimersByTimeAsync(2000);
    const result = await pending;
    expect(result.demo).toBe(true);
    expect(result.data.warnings.some((w) => w.code === "DEMO")).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("keeps validation errors visible instead of silently substituting a demo", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({
        error: {
          code: "INVALID",
          field: "cargo_lb",
          message: "Cargo is too heavy.",
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const { createPlan, ApiError } = await import("./client");
    await expect(
      createPlan(inputs, new AbortController().signal),
    ).rejects.toMatchObject({
      message: "Cargo is too heavy.",
      field: "cargo_lb",
      status: 400,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(ApiError).toBeDefined();
  });
  it("cancels a request during retry backoff without starting a demo", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("network"));
    vi.stubGlobal("fetch", fetchMock);
    const { createPlan } = await import("./client");
    const controller = new AbortController(),
      pending = createPlan(inputs, controller.signal);
    const assertion = expect(pending).rejects.toMatchObject({
      name: "AbortError",
    });
    await vi.advanceTimersByTimeAsync(50);
    controller.abort();
    await assertion;
    await vi.advanceTimersByTimeAsync(2000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("createPlan request body", () => {
  it("forwards the weather_slowdown choice (regression: the Settings toggle never reached the server)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);
    const { createPlan } = await import("./client");
    await createPlan({ ...inputs, weather_slowdown: false }, new AbortController().signal).catch(() => undefined);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.weather_slowdown).toBe(false);
  });
});
