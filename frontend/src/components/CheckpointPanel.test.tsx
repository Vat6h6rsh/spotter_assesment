import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { CheckpointPanel } from "./CheckpointPanel";
import { makeMockPlan, demoPlaces } from "../api/mock";
import { planner } from "../state/planner";

const createPlan = () => makeMockPlan({
  origin: demoPlaces[0],
  destination: demoPlaces[1],
  departure_local: "2026-10-16T06:00",
  cargo_lb: 42000,
  spacing_mi: 25,
  wind_measure: "gust",
  rest: { mode: "auto" },
});

afterEach(() => vi.restoreAllMocks());

describe("checkpoint master detail", () => {
  it.each([3, 4] as const)("shows checkpoint-local clearing for level %s, including the next day", level => {
    const plan = createPlan(), route = plan.routes[2], cp = route.checkpoints[0];
    Object.assign(cp, { level, clears_in_h: 6, clears_at_utc: "2026-10-17T08:00:00Z", tz: "America/Denver" });
    const { rerender } = render(<CheckpointPanel plan={plan} route={route} index={cp.i} onClose={vi.fn()} onList={vi.fn()} />);
    expect(screen.getByText(/Clear roads in about 6 h \(Sat,? 2:00 AM MDT\)\./)).toBeInTheDocument();
    cp.clears_in_h = null; cp.clears_at_utc = null;
    rerender(<CheckpointPanel plan={plan} route={route} index={cp.i} onClose={vi.fn()} onList={vi.fn()} />);
    expect(screen.getByText("No clearing in the next 48 h.")).toBeInTheDocument();
  });
  it("omits clearing for lower or unknown severity and accepts older saved checkpoints", () => {
    const plan = createPlan(), route = plan.routes[0], cp = route.checkpoints[0];
    const view = () => <CheckpointPanel plan={plan} route={route} index={cp.i} onClose={vi.fn()} onList={vi.fn()} />;
    const { rerender } = render(view());
    for (const level of [0, 1, 2, null] as const) {
      Object.assign(cp, { level, clears_in_h: 6, clears_at_utc: "2026-10-17T08:00:00Z" }); rerender(view());
      expect(screen.queryByText(/Clear roads|No clearing/)).toBeNull();
    }
    cp.level = 4; delete cp.clears_in_h; delete cp.clears_at_utc; rerender(view());
    expect(screen.getByText("No clearing in the next 48 h.")).toBeInTheDocument();
  });
  it("names places in rows, drawer headings and navigation, with miles and zoned elapsed ETA below", () => {
    const plan = createPlan(), route = plan.routes[0], cp = route.checkpoints[1];
    cp.place_label = "I-80 W · 18 mi W of Kearney, NE";
    const { rerender } = render(<CheckpointPanel plan={plan} route={route} index={null} onClose={vi.fn()} onList={vi.fn()} />);
    const row = screen.getAllByRole("button", { name: /^Checkpoint / })[1];
    expect(row.querySelector("strong")).toHaveTextContent(cp.place_label);
    expect(row.querySelector(".checkpoint-list-meta")).toHaveTextContent(/Mile 25 · .*CDT · \+22 m/);
    expect(within(row).getByText("Low")).toBeInTheDocument();
    rerender(<CheckpointPanel plan={plan} route={route} index={cp.i} onClose={vi.fn()} onList={vi.fn()} />);
    expect(screen.getByRole("heading", { name: cp.place_label })).toBeInTheDocument();
    expect(screen.getByText("Mile 25 · Route A")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Next checkpoint/ })).toHaveTextContent(route.checkpoints[2].place_label!);
    delete cp.place_label; delete cp.place;
    rerender(<CheckpointPanel plan={plan} route={route} index={cp.i} onClose={vi.fn()} onList={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "Mile 25" })).toBeInTheDocument();
  });
  it("consolidates wind, marks each deciding driver and preserves rating evidence", () => {
    const plan = createPlan();
    const route = plan.routes[0];
    const cp = route.checkpoints[1];
    Object.assign(cp, {
      wind_mph: 24,
      gust_mph: 38,
      rain_in: 0.5,
      snow_in: 0,
      base_wind_level: 2,
      load_adjusted: true,
      level: 3,
      drivers: ["wind", "rain"],
      rule: "Wind and rain determine this rating.",
    });
    render(<CheckpointPanel plan={plan} route={route} index={cp.i} onClose={vi.fn()} onList={vi.fn()} />);
    const wind = screen.getByText("Wind", { exact: true }).closest(".weather-row");
    expect(wind).not.toBeNull();
    expect(within(wind as HTMLElement).getByText("38 mph")).toBeInTheDocument();
    expect(within(wind as HTMLElement).getByText("24 mph")).toBeInTheDocument();
    expect(within(wind as HTMLElement).getByText("Driver")).toBeInTheDocument();
    expect(screen.getAllByText("Driver")).toHaveLength(2);
    expect(screen.getByText("0.50 in/hr")).toBeInTheDocument();
    expect(screen.getByText("0.00 in/hr")).toBeInTheDocument();
    expect(screen.getByText("Wind and rain determine this rating.")).toBeInTheDocument();
    expect(screen.getByText(/Load-adjusted · 42,000 lb/)).toBeInTheDocument();
    expect(screen.getByText("Base wind").nextElementSibling).toHaveTextContent("High");
    expect(screen.getByText("Load adjustment").nextElementSibling).toHaveTextContent("Applied to wind");
    expect(screen.getByText("Route weather coverage").nextElementSibling).toHaveTextContent("100%");
    expect(screen.getByText(/Forecast hour/)).toHaveTextContent(/fetched/);
    expect(screen.getByText(/Forecast hour/).querySelectorAll("time")).toHaveLength(2);
  });

  it("offers back and close actions and navigates to neighboring checkpoint miles", () => {
    const plan = createPlan();
    const route = plan.routes[0];
    const cp = route.checkpoints[1];
    const onClose = vi.fn(), onList = vi.fn();
    const select = vi.spyOn(planner, "selectCheckpoint").mockImplementation(() => {});
    const { rerender } = render(<CheckpointPanel plan={plan} route={route} index={cp.i} onClose={onClose} onList={onList} />);
    fireEvent.click(screen.getByRole("button", { name: "All checkpoints" }));
    expect(onList).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Close checkpoint detail" }));
    expect(onClose).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: /Previous checkpoint, mile/ }));
    expect(select).toHaveBeenLastCalledWith(route.id, route.checkpoints[0].i);
    fireEvent.click(screen.getByRole("button", { name: /Next checkpoint, mile/ }));
    expect(select).toHaveBeenLastCalledWith(route.id, route.checkpoints[2].i);
    rerender(<CheckpointPanel plan={plan} route={route} index={route.checkpoints[0].i} onClose={onClose} onList={onList} />);
    expect(screen.getByRole("button", { name: "Previous checkpoint" })).toBeDisabled();
    rerender(<CheckpointPanel plan={plan} route={route} index={null} onClose={onClose} onList={onList} />);
    fireEvent.click(screen.getAllByRole("button", { name: /^Checkpoint / })[1]);
    expect(select).toHaveBeenLastCalledWith(route.id, cp.i);
  });

  it("keeps unknown weather and the fetched timestamp visible beyond the horizon", () => {
    const plan = createPlan();
    const route = plan.routes[0];
    const cp = route.checkpoints[0];
    Object.assign(cp, {
      level: null,
      wind_mph: null,
      gust_mph: null,
      rain_in: null,
      snow_in: null,
      base_wind_level: null,
      load_adjusted: false,
      drivers: [],
      forecast_hour_utc: null,
      beyond_horizon: true,
    });
    render(<CheckpointPanel plan={plan} route={route} index={cp.i} onClose={vi.fn()} onList={vi.fn()} />);
    expect(screen.getAllByText("Unknown mph")).toHaveLength(2);
    expect(screen.getAllByText("Unknown in/hr")).toHaveLength(2);
    expect(screen.getByText(/Beyond the available forecast/)).toBeInTheDocument();
    expect(screen.getByText(/Forecast hour unavailable/)).toHaveTextContent(/fetched/);
    expect(screen.queryByText("Driver", { exact: true })).not.toBeInTheDocument();
  });
});
