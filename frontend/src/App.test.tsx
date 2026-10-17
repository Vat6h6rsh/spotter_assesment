import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { makeMockHeatmap, makeMockPlan } from "./api/mock";
import type { Heatmap, PlanRequest, Recommendation } from "./api/types";
const client = vi.hoisted(() => ({ createPlan: vi.fn(), getHeatmap: vi.fn() }));
vi.mock("./api/client", () => ({
  ...client,
  forcedDemo: true,
  geocode: vi.fn(),
  getWeatherHotspot: vi.fn().mockResolvedValue({ available: false, reason: "No showcase in this journey" }),
  ApiError: class extends Error {
    status = 500;
  },
}));
vi.mock("./map/MapView", () => ({
  default: () => <section aria-label="Weather corridor map" />,
}));
import App from "./App";
import { planner } from "./state/planner";
import { preferences } from "./state/preferences";
import { drive } from "./drive/state";
import { timeline } from "./state/timeline";

describe("Control Room interaction flow", () => {
  it("ends and releases a drive preview before opening Settings", async () => {
    const plan = makeMockPlan({ origin: { label: 'Joliet, IL, USA', lat: 41.525, lon: -88.081 }, destination: { label: 'Denver, CO, USA', lat: 39.739, lon: -104.99 }, departure_local: '2026-10-16T06:00', cargo_lb: 42000, spacing_mi: 25, wind_measure: 'gust', rest: { mode: 'auto' } });
    client.createPlan.mockResolvedValue({ data: plan, demo: true }); client.getHeatmap.mockResolvedValue(makeMockHeatmap(plan));
    await planner.submit(plan.inputs); render(<App />);
    act(() => drive.start(plan, plan.routes[1])); expect(drive.get().session).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(drive.get().session).toBeNull(); expect(timeline.isPlaying()).toBe(false);
    expect(screen.getByRole('heading', { name: 'Drive preview' })).toBeInTheDocument();
  });
  it.each([
    ["2026-10-16T23:30", 6, "2026-10-17T05:30"],
    ["2026-10-31T23:30", 6, "2026-11-01T04:30"],
  ])("plans departure advice in the origin zone across midnight and DST (%s)", async (departure, offset, expected) => {
    const request: PlanRequest = {
      origin: { label: "Joliet, IL, USA", lat: 41.525, lon: -88.081 },
      destination: { label: "Denver, CO, USA", lat: 39.739, lon: -104.99 },
      departure_local: departure, cargo_lb: 42000, spacing_mi: 10,
      wind_measure: "sustained", rest: { mode: "custom", drive_hours: 4, rest_hours: 1 },
    };
    const plan = makeMockPlan(request);
    plan.recommendation.departure_advice = { offset_h: offset, route_id: "B", summary: "Leave later on B: Severe miles 175 → 0" };
    client.createPlan.mockResolvedValue({ data: plan, demo: true });
    client.getHeatmap.mockResolvedValue(makeMockHeatmap(plan));
    await planner.submit(request);
    render(<App />);
    expect(screen.getByRole("img", { name: "Spotter AI" })).toHaveAttribute("src", "/spotter-ai-logo.webp");
    const pick = plan.routes.find((route) => route.id === plan.recommendation.route_id)!;
    expect(screen.getByRole("heading", { name: `Take ${pick.id} · ${pick.label}` })).toBeVisible();
    expect(screen.getByText(plan.recommendation.tradeoff)).toBeVisible();
    for (const reason of plan.recommendation.reasons) expect(screen.getByText(reason)).toBeVisible();
    expect(screen.getByText(plan.recommendation.departure_advice.summary).closest(".verdict")).not.toBeNull();
    client.createPlan.mockClear();
    fireEvent.click(screen.getByRole("button", { name: `Leave ${offset} h later` }));
    expect(client.createPlan).toHaveBeenCalledWith({ ...request, departure_local: expected }, expect.any(AbortSignal));
    await waitFor(() => expect(planner.get().phase).toBe("idle"));
  });
  it.each([
    [
      "none_eligible",
      "No route is clear at this departure",
      "No eligible route. Every option crosses No Travel conditions.",
    ],
    [
      "tentative",
      /^Leaning B ·/,
      "Tentative recommendation. Missing weather may change the safest route.",
    ],
    [
      "insufficient_data",
      "More data needed.",
      "Not enough weather data to recommend a route.",
    ],
  ])("makes the %s safety state explicit", async (status, heading, banner) => {
    const request: PlanRequest = {
      origin: { label: "Joliet, IL, USA", lat: 41.525, lon: -88.081 },
      destination: { label: "Denver, CO, USA", lat: 39.739, lon: -104.99 },
      departure_local: "2026-10-16T06:00",
      cargo_lb: 42000,
      spacing_mi: 25,
      wind_measure: "gust",
      rest: { mode: "auto" },
    };
    const plan = makeMockPlan(request);
    plan.plan_id = `status_${status}`;
    plan.recommendation.status = status as Recommendation["status"];
    if (status !== "tentative") plan.recommendation.route_id = null;
    client.createPlan.mockResolvedValue({ data: plan, demo: true });
    client.getHeatmap.mockResolvedValue(makeMockHeatmap(plan));
    await planner.submit(request);
    const { unmount } = render(<App />);
    expect(screen.getByRole("heading", { name: heading })).toBeVisible();
    if (status === "none_eligible") {
      expect(document.querySelector(".stop-banner")).toBeNull();
      expect(screen.getAllByRole("heading", { name: heading })).toHaveLength(1);
    } else expect(screen.getByText(new RegExp(banner))).toBeVisible();
    if (status === "tentative") expect(screen.getByText("Forecast incomplete; this may change.")).toBeVisible();
    if (status === "none_eligible") expect(screen.getByText(/^Least exposure:/)).toHaveTextContent(
      [...plan.routes].sort((a, b) => a.rank - b.rank).map((route) => `${route.id} · ${route.label}`).join("; "),
    );
    unmount();
  });
  it("renders routes before heatmap, opens details and compare, switches all themes, and exposes all three mobile snap points", async () => {
    client.createPlan.mockClear();
    client.getHeatmap.mockClear();
    let resolveHeatmap: (value: Heatmap) => void = () => {};
    client.createPlan.mockImplementation(async (request: PlanRequest) => ({
      data: makeMockPlan(request),
      demo: true,
    }));
    client.getHeatmap.mockImplementation(
      () =>
        new Promise<Heatmap>((resolve) => {
          resolveHeatmap = resolve;
        }),
    );
    const { unmount } = render(<App />);
    if (!screen.queryByRole("combobox", { name: "From" }))
      fireEvent.click(screen.getByRole("button", { name: "Edit trip" }));
    expect(screen.getByRole("combobox", { name: "From" })).toHaveValue(
      "Joliet, IL, USA",
    );
    fireEvent.click(screen.getByRole("button", { name: "Plan routes" }));
    await screen.findByRole("heading", { name: /^Take B ·/ });
    expect(screen.getByText("Demo data")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Compare routes" }),
    ).toBeVisible();
    expect(planner.get().heatmap).toBeNull();
    await waitFor(() => expect(client.getHeatmap).toHaveBeenCalled());
    await act(async () => resolveHeatmap(makeMockHeatmap(planner.get().plan!)));
    expect(planner.get().heatmap?.data.hours).toBe(49);
    fireEvent.click(screen.getByRole("button", { name: "Compare routes" }));
    const modal = screen.getByRole("dialog", { name: "Compare your routes" });
    expect(within(modal).getByText("Average risk (0–4)")).toBeVisible();
    expect(within(modal).getByText("No Travel miles")).toBeVisible();
    fireEvent.click(
      within(modal).getByRole("button", { name: "Close comparison" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Checkpoints" }));
    fireEvent.click(screen.getByRole("button", { name: /Checkpoint B-1, / }));
    const detail = screen.getByRole("complementary", {
      name: /Checkpoint B-1 detail/,
    });
    expect(within(detail).getByText("Wind")).toBeVisible();
    expect(within(detail).getByText("gust").parentElement).toHaveTextContent("mph");
    expect(within(detail).getByText("sustained").parentElement).toHaveTextContent("mph");
    fireEvent.click(
      within(detail).getByRole("button", { name: "Close checkpoint detail" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    for (const name of [
      "Brand daylight",
      "Glacier & ink",
      "Midnight teal",
      "Charcoal & coral",
      "Harbor contrast",
    ]) {
      const theme = screen.getByRole("button", { name: new RegExp(name) });
      fireEvent.click(theme);
      expect(theme).toHaveAttribute("aria-pressed", "true");
      expect(document.documentElement.dataset.theme).toBe(
        preferences.get().theme,
      );
    }
    expect(
      screen.getByRole("button", { name: "Launch app walkthrough" }),
    ).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "System theme" }));
    expect(preferences.get().theme).toBe("system");
    fireEvent.click(screen.getByRole("button", { name: /Back to your route/ }));
    unmount();
    // jsdom verifies responsive structure; pixel layout still needs a real browser.
    const previousMedia = window.matchMedia;
    window.matchMedia = (query) => ({
      ...previousMedia(query),
      matches: query === "(max-width: 1023px)",
    });
    render(<App />);
    const peek = screen.getByRole("button", { name: "peek panel" });
    const half = screen.getByRole("button", { name: "half panel" });
    const full = screen.getByRole("button", { name: "full panel" });
    fireEvent.click(peek);
    expect(peek.closest(".left-panel")).toHaveAttribute("data-snap", "peek");
    fireEvent.click(screen.getByRole("button", { name: "Risk strips" }));
    expect(peek.closest(".left-panel")).toHaveAttribute("data-snap", "half");
    fireEvent.click(full);
    expect(full.closest(".left-panel")).toHaveAttribute("data-snap", "full");
    fireEvent.click(half);
    expect(half.closest(".left-panel")).toHaveAttribute("data-snap", "half");
    window.matchMedia = previousMedia;
  }, 30000); // Full planning/drawer/theme/mobile journey; jsdom role queries are slow on Windows.
});
