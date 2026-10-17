import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { makeMockPlan, demoPlaces } from "../api/mock";
import { CheckpointPopup } from "./popup";
import { buildCheckpointPopup } from "./popupContent";

const plan = makeMockPlan({ origin: demoPlaces[0], destination: demoPlaces[1], departure_local: "2026-10-16T06:00", cargo_lb: 43000, spacing_mi: 25, wind_measure: "gust", rest: { mode: "auto" } });
describe("checkpoint popup content", () => {
  it.each([3, 4] as const)("shows the same local clearing line for level %s", level => {
    const route = plan.routes[0], cp = { ...route.checkpoints[0], level, clears_in_h: 6, clears_at_utc: "2026-10-17T08:00:00Z", tz: "America/Denver" };
    const { rerender } = render(<CheckpointPopup content={buildCheckpointPopup(plan, route, cp)} />);
    expect(screen.getByText(/Clear roads in about 6 h \(Sat,? 2:00 AM MDT\)\./)).toBeInTheDocument();
    rerender(<CheckpointPopup content={buildCheckpointPopup(plan, route, { ...cp, clears_in_h: null, clears_at_utc: null })} />);
    expect(screen.getByText("No clearing in the next 48 h.")).toBeInTheDocument();
    rerender(<CheckpointPopup content={buildCheckpointPopup(plan, route, { ...cp, level: 2 })} />);
    expect(screen.queryByText(/Clear roads|No clearing/)).toBeNull();
  });
  it("includes route, mile, local ETA with zone, Tabler severity, deciding weather, cargo rule and slowdown", () => {
    const route = plan.routes[1], cp = { ...route.checkpoints[1], level: 3 as const, drivers: ["wind"], gust_mph: 47, wind_mph: 24, load_adjusted: true, slowdown: "Heavy snow −22%" };
    const content = buildCheckpointPopup(plan, route, cp);
    expect(content).toMatchObject({ title: cp.place_label, subtitle: `Route B · Mile ${Math.round(cp.mi)}`, driver: "Gust 47 mph · 43,000 lb rule", severity: "Severe", slowdown: "Heavy snow −22%" });
    expect(content.eta).toMatch(/AM|PM/); expect(content.eta).toMatch(/CDT|MDT/);
    render(<CheckpointPopup content={content} />);
    expect(screen.getByText("Severe").querySelector("svg")).toHaveClass("tabler-icon-square-rotated-filled");
    expect(screen.getByText(/Heavy snow/)).toBeInTheDocument();
    expect(screen.getByText(cp.place_label!)).toBeInTheDocument();
  });
  it("uses sustained-only correctly, retains Unknown, and handles missing slowdown text", () => {
    const route = plan.routes[0], cp = { ...route.checkpoints[0], drivers: ["wind"], gust_mph: 47, wind_mph: 24, load_adjusted: false, slowdown: null, speed_factor: .9 };
    expect(buildCheckpointPopup({ ...plan, inputs: { ...plan.inputs, wind_measure: "sustained" } }, route, cp).driver).toBe("Sustained wind 24 mph");
    expect(buildCheckpointPopup(plan, route, cp).slowdown).toBe("Speed reduced 10%");
    expect(buildCheckpointPopup(plan, route, { ...cp, level: null, beyond_horizon: true, speed_factor: 1 })).toMatchObject({ severity: "Unknown", driver: "Beyond forecast horizon", slowdown: null });
    expect(buildCheckpointPopup(plan, route, { ...cp, place: undefined, place_label: undefined }).title).toBe(`Mile ${Math.round(cp.mi)}`);
  });
});
