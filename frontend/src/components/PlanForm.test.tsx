import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeMockPlan } from "../api/mock";
import type { PlanRequest } from "../api/types";

const network = vi.hoisted(() => ({
  createPlan: vi.fn(),
  getHeatmap: vi.fn(),
  geocode: vi.fn(),
}));
vi.mock("../api/client", () => ({
  ...network,
  forcedDemo: false,
  getWeatherHotspot: vi.fn().mockResolvedValue({ available: false, reason: "No notable weather" }),
  ApiError: class extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
}));

async function loadModules() {
  const [{ PlanForm }, { planner }, { serverWake }] = await Promise.all([
    import("./PlanForm"),
    import("../state/planner"),
    import("../state/serverWake"),
  ]);
  return { PlanForm, planner, serverWake };
}

describe("planning while the server wakes", () => {
  let modules: Awaited<ReturnType<typeof loadModules>>;
  let stopWake: () => void;
  let answerHealth: (response: Response) => void;
  let healthSignal: AbortSignal;

  beforeEach(async () => {
    vi.resetModules();
    vi.useFakeTimers();
    localStorage.clear();
    network.createPlan.mockReset();
    network.getHeatmap.mockReset();
    network.createPlan.mockImplementation(async (inputs: PlanRequest) => ({ data: makeMockPlan(inputs), demo: false }));
    // A corridor failure is independent of successful route planning.
    network.getHeatmap.mockRejectedValue(new Error("Corridor unavailable"));
    vi.stubGlobal("fetch", vi.fn((_url: string, options: RequestInit) => new Promise<Response>((resolve, reject) => {
      answerHealth = resolve;
      healthSignal = options.signal as AbortSignal;
      healthSignal.addEventListener("abort", () => reject(new DOMException("Cancelled", "AbortError")), { once: true });
    })));
    modules = await loadModules();
    act(() => { stopWake = modules.serverWake.start(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  });

  afterEach(async () => {
    cleanup();
    modules.planner.cancel();
    stopWake();
    await vi.advanceTimersByTimeAsync(0);
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("shows Waiting for the server and automatically submits once health responds", async () => {
    const { PlanForm, planner, serverWake } = modules;
    const complete = vi.fn();
    render(<PlanForm initial={null} onComplete={complete} onClose={vi.fn()} />);
    fireEvent.click(screen.getByText("More options"));
    expect(screen.getByRole("radio", { name: "Gusts" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "Sustained" })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("radiogroup", { name: "Wind used for risk" })).toHaveAccessibleDescription(/25 \/ 35 \/ 45 \/ 55 mph/);
    fireEvent.click(screen.getByRole("button", { name: "Plan routes" }));
    expect(screen.getByRole("button", { name: "Waiting for the server…" })).toBeDisabled();
    expect(network.createPlan).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(planner.get().phase).toBe("routes");
    expect(network.createPlan).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();

    await act(async () => {
      answerHealth({ ok: true } as Response);
      await serverWake.wait(new AbortController().signal);
      // The planner intentionally lets routes paint across two animation frames.
      await vi.advanceTimersByTimeAsync(64);
    });
    expect(network.createPlan).toHaveBeenCalledOnce();
    expect(network.createPlan).toHaveBeenCalledWith(expect.objectContaining({ cargo_lb: 42000 }), expect.any(AbortSignal));
    expect(complete).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: "Waiting for the server…" })).not.toBeInTheDocument();
    expect(planner.get().plan?.routes).toHaveLength(3);
  });

  it("cancels a queued plan while allowing background wake to finish", async () => {
    const { PlanForm, planner, serverWake } = modules;
    const complete = vi.fn();
    render(<PlanForm initial={null} onComplete={complete} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Plan routes" }));
    expect(screen.getByRole("button", { name: "Waiting for the server…" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel request" }));
    expect(screen.getByRole("button", { name: "Plan routes" })).toBeEnabled();
    expect(healthSignal.aborted).toBe(false);
    expect(planner.get().phase).toBe("idle");

    await act(async () => {
      answerHealth({ ok: true } as Response);
      await serverWake.wait(new AbortController().signal);
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(serverWake.get().status).toBe("ready");
    expect(network.createPlan).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
    expect(planner.get().plan).toBeNull();
    expect(planner.get().phase).toBe("idle");
  });
});
