/// <reference types="node" />
import { readFileSync } from "node:fs";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ServerWakeState } from "../state/serverWake";
import type { PlanRequest } from "../api/types";
const mocks = vi.hoisted(() => ({ wake: {} as ServerWakeState, state: {} as { phase: string; submitted: PlanRequest | null; startedAt: number | null; plan: null }, retry: vi.fn(), cancel: vi.fn() }));
vi.mock("../state/serverWake", () => ({ useServerWake: () => mocks.wake, serverWake: { retry: mocks.retry } }));
vi.mock("../state/planner", () => ({ usePlanner: () => mocks.state, planner: { cancel: mocks.cancel } }));
import { ServerWakeCard, ServerWakeChip } from "./ServerWakeChip";
import { PlanningWait } from "./PlanningWait";
import { WaitingRoad } from "./WaitingRoad";
import { weatherIconUrl } from "../lib/weatherIconAssets";
const inputs: PlanRequest = { origin: { label: "Joliet, IL, USA", lat: 41, lon: -88 }, destination: { label: "Denver, CO, USA", lat: 39, lon: -104 }, departure_local: "2026-10-17T06:00", spacing_mi: 50, cargo_lb: 42000, rest: { mode: "auto" }, wind_measure: "gust" };
const advance = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(0); vi.clearAllMocks();
  mocks.wake = { status: "waking", slow: false, startedAt: 0 };
  mocks.state = { phase: "idle", submitted: null, startedAt: null, plan: null };
});
afterEach(() => { vi.useRealTimers(); document.querySelector(".map-region")?.remove(); });
function plan() {
  mocks.wake = { status: "ready", slow: false, startedAt: null };
  mocks.state = { phase: "routes", submitted: inputs, startedAt: 0, plan: null };
  const map = document.createElement("div"); map.className = "map-region"; document.body.append(map);
  return render(<PlanningWait />);
}
describe("server wake waiting UI", () => {
  it("keeps the chip delayed, shows the card at 8 s, changes copy at 45 s, and announces stages only", async () => {
    const view = render(<><ServerWakeChip /><ServerWakeCard /></>);
    expect(screen.queryByText("Waking up the server…")).not.toBeInTheDocument();
    await advance(1500); mocks.wake = { ...mocks.wake, slow: true }; view.rerender(<><ServerWakeChip /><ServerWakeCard /></>);
    expect(screen.getByText("Waking up the server…")).toBeInTheDocument();
    await advance(6499); expect(screen.queryByRole("region", { name: "Server startup" })).not.toBeInTheDocument();
    await advance(1); expect(screen.getByRole("region", { name: "Server startup" })).toBeInTheDocument();
    expect(screen.getByText("8 s")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByRole("progressbar")).not.toHaveAttribute("aria-valuenow");
    const live = screen.getByRole("status");
    const changes = vi.fn(); const observer = new MutationObserver(changes); observer.observe(live, { childList: true, characterData: true, subtree: true });
    await advance(5000); expect(changes).not.toHaveBeenCalled();
    await advance(32000); expect(live).toHaveTextContent("Taking a little longer than usual");
    expect(changes).toHaveBeenCalledTimes(1); observer.disconnect();
    expect(screen.getByText("45 s")).toBeInTheDocument();
    await advance(5000); expect(screen.getByRole("progressbar")).toHaveClass("is-indeterminate");
  });
  it("mentions a queued trip, pauses tips and road, retries, then fades the ready card", async () => {
    mocks.state.phase = "routes";
    const view = render(<ServerWakeCard />); await advance(8000);
    expect(screen.getByText(/it will run the moment/)).toBeInTheDocument();
    const firstTip = screen.getByText(/We check the forecast/);
    fireEvent.click(screen.getByRole("button", { name: "Pause animation" }));
    expect(document.querySelector(".waiting-road")).toHaveClass("is-paused");
    await advance(16000); expect(firstTip).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Play animation" }));
    await advance(8000); expect(screen.getByText(/Wind is rated/)).toBeInTheDocument();
    mocks.wake = { ...mocks.wake, status: "unavailable" }; view.rerender(<ServerWakeCard />);
    fireEvent.click(screen.getByRole("button", { name: "Try again" })); expect(mocks.retry).toHaveBeenCalledOnce();
    mocks.wake = { ...mocks.wake, status: "ready" }; view.rerender(<ServerWakeCard />);
    expect(screen.getByRole("progressbar").firstChild).toHaveStyle({ width: "100%" });
    expect(screen.getByRole("status")).toHaveTextContent("The server is ready");
    await advance(400); expect(screen.queryByRole("region")).not.toBeInTheDocument();
  });
});
describe("planning narration", () => {
  it("never flashes a fast plan and keeps its live region mounted", async () => {
    const view = plan(); const live = screen.getByRole("status");
    expect(live).toHaveTextContent("Planning your trip");
    await advance(400); expect(screen.queryByRole("region")).not.toBeInTheDocument();
    mocks.state.phase = "idle"; view.rerender(<PlanningWait />); await advance(1000);
    expect(screen.queryByRole("region")).not.toBeInTheDocument(); expect(screen.getByRole("status")).toBe(live);
  });
  it("uses submitted cities, spacing and cargo, advances every 1.2 s and holds on forecasts", async () => {
    const view = plan(); await advance(500);
    expect(screen.getByText("Planning Joliet → Denver")).toBeInTheDocument();
    expect(screen.getByText("Placing weather checkpoints every 50 mi")).toBeInTheDocument();
    expect(screen.getByText("Rating wind, rain and snow for your 42,000 lb load")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Finding your start");
    await advance(700); expect(screen.getByRole("status")).toHaveTextContent("Getting truck routes");
    await advance(1200); expect(screen.getByRole("status")).toHaveTextContent("Placing weather checkpoints");
    await advance(1200); expect(screen.getByRole("status")).toHaveTextContent("Fetching hourly forecasts");
    const changes = vi.fn(); const observer = new MutationObserver(changes); observer.observe(screen.getByRole("status"), { subtree: true, characterData: true, childList: true });
    await advance(6400); expect(changes).not.toHaveBeenCalled(); observer.disconnect();
    expect(screen.getByText("10 s")).toHaveAttribute("aria-hidden", "true");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" })); expect(mocks.cancel).toHaveBeenCalledOnce();
    await advance(15000); expect(screen.getByText(/Long routes have more/)).toBeInTheDocument();
    mocks.state.phase = "heatmap"; view.rerender(<PlanningWait />); expect(screen.queryByRole("region")).not.toBeInTheDocument();
  });
  it("waits for readiness before starting the estimated steps", async () => {
    const view = plan(); mocks.wake.status = "waking"; view.rerender(<PlanningWait />);
    await advance(9000); expect(screen.getByRole("status")).toHaveTextContent("Waiting for the server to wake up");
    expect(screen.queryByText("Getting truck routes from TomTom")).not.toBeInTheDocument();
    mocks.wake.status = "ready"; view.rerender(<PlanningWait />);
    expect(screen.getByRole("status")).toHaveTextContent("Finding your start");
    await advance(1200); expect(screen.getByRole("status")).toHaveTextContent("Getting truck routes");
  });
});
it("keeps decorative weather static and disables all waiting motion under reduced motion", async () => {
  const view = render(<WaitingRoad paused />);
  expect(view.container.firstChild).toHaveAttribute("aria-hidden", "true");
  expect(view.container.querySelector("img")?.getAttribute("src")).toBe(weatherIconUrl("clear-day", true));
  const sky = view.container.querySelector(".waiting-sky:not(.sky-out) picture")?.getAttribute("data-weather");
  await advance(16000); expect(view.container.querySelector(".waiting-sky:not(.sky-out) picture")).toHaveAttribute("data-weather", sky);
  view.rerender(<WaitingRoad />); await advance(8000);
  expect(view.container.querySelector(".waiting-sky:not(.sky-out) picture")).toHaveAttribute("data-weather", "wind");
  const css = readFileSync("src/App.css", "utf8");
  expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.waiting-road \*/);
  expect(css).toContain(".planning-steps .spinner { animation: none; transition: none; }");
});
