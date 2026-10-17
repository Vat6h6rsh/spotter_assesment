import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeMockHotspot } from "../api/mock";

const mocks = vi.hoisted(() => ({
  hotspot: vi.fn(), submit: vi.fn(),
  wake: { status: "ready", slow: false },
}));
vi.mock("../api/client", () => ({ getWeatherHotspot: mocks.hotspot, geocode: vi.fn() }));
vi.mock("../state/serverWake", () => ({ useServerWake: () => mocks.wake }));
vi.mock("../state/planner", () => ({ usePlanner: () => ({ phase: "idle", demo: false }), planner: { submit: mocks.submit } }));
import { PlanForm } from "./PlanForm";
import { WeatherShowcase, SHOWCASE_DATE_KEY } from "./WeatherShowcase";

const title = "See today's toughest trucking weather";
function form() { return render(<PlanForm initial={null} onComplete={vi.fn()} onClose={vi.fn()} />); }
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-10-17T12:00:00Z"));
  localStorage.clear(); mocks.wake.status = "ready"; sessionStorage.clear();
  mocks.hotspot.mockReset().mockResolvedValue(makeMockHotspot()); mocks.submit.mockReset().mockResolvedValue(false);
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("daily weather showcase", () => {
  it("shows verified exposure for the selected trip and omits it for older responses", async () => {
    const data = makeMockHotspot();
    data.suggested_trip.verified = { max_level: 4, high_or_worse_mi: 123.4, route_label: "I-80" };
    const snow = data.more![0];
    mocks.hotspot.mockResolvedValue(data); form();
    const dialog = await screen.findByRole("dialog", { name: title });
    expect(dialog.querySelector(".showcase-trip")).toHaveTextContent("Expect 123 mi of High+ weather");
    fireEvent.click(within(dialog).getByRole("button", { name: /Heavy snow near the Colorado/ }));
    expect(dialog.querySelector(".showcase-trip")).not.toHaveTextContent("Expect");
    expect(dialog.querySelector(".showcase-trip")).toHaveTextContent(snow.suggested_trip.origin.label);
  });
  it("keeps distinct same-hazard trips supplied by the server and shows their verification", async () => {
    const data = makeMockHotspot();
    const trip = { ...data.suggested_trip, origin: { label: "Phoenix, AZ, USA", lat: 33.4484, lon: -112.074, tz: "America/Phoenix" }, destination: { label: "San Antonio, TX, USA", lat: 29.4241, lon: -98.4936, tz: "America/Chicago" }, corridor: "I-10", verified: { max_level: 4 as const, high_or_worse_mi: 250, route_label: "I-10" } };
    data.more = [{ hazard: "wind", headline: "High winds across Arizona", summary: "A separate wind trip", suggested_trip: trip }];
    mocks.hotspot.mockResolvedValue(data); form();
    const dialog = await screen.findByRole("dialog", { name: title });
    fireEvent.click(within(dialog).getByRole("button", { name: /High winds across Arizona/ }));
    expect(dialog.querySelector(".showcase-trip")).toHaveTextContent("Expect 250 mi of High+ weather");
    expect(dialog.querySelector(".showcase-trip")).toHaveTextContent(trip.origin.label);
    fireEvent.click(within(dialog).getByRole("button", { name: "Plan this route" }));
    expect(mocks.submit).toHaveBeenCalledWith(expect.objectContaining({ origin: trip.origin, destination: trip.destination }));
  });
  it("waits for health, shows only once per local day, and can be reopened from the form button", async () => {
    mocks.wake.status = "waking";
    const first = form(); expect(mocks.hotspot).not.toHaveBeenCalled();
    mocks.wake.status = "ready"; first.rerender(<PlanForm initial={null} onComplete={vi.fn()} onClose={vi.fn()} />);
    const dialog = await screen.findByRole("dialog", { name: title });
    expect(localStorage.getItem(SHOWCASE_DATE_KEY)).toBe("2026-10-17");
    expect(dialog).toHaveTextContent("43,000 lb"); expect(dialog).toHaveTextContent("CDT");
    fireEvent.click(within(dialog).getByRole("button", { name: "Close weather showcase" })); first.unmount();
    const second = form(); await screen.findByRole("button", { name: "Today's toughest weather" });
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Today's toughest weather" })); expect(screen.getByRole("dialog", { name: title })).toBeVisible();
    second.unmount(); vi.setSystemTime(new Date("2026-10-18T12:00:00Z"));
    form(); expect(await screen.findByRole("dialog", { name: title })).toBeVisible();
  });
  it("fills all four fields and submits the trip with existing planning defaults", async () => {
    const trip = makeMockHotspot().suggested_trip;
    trip.origin = { label: "Phoenix, AZ, USA", lat: 33.4484, lon: -112.074, tz: "America/Phoenix" };
    trip.destination = { label: "San Antonio, TX, USA", lat: 29.4241, lon: -98.4936, tz: "America/Chicago" };
    trip.departure_local = "2026-10-17T06:00";
    mocks.hotspot.mockResolvedValue({ ...makeMockHotspot(), suggested_trip: trip });
    form(); fireEvent.click(within(await screen.findByRole("dialog", { name: title })).getByRole("button", { name: "Plan this route" }));
    expect(screen.getByRole("combobox", { name: "From" })).toHaveValue(trip.origin.label);
    expect(screen.getByRole("combobox", { name: "To" })).toHaveValue(trip.destination.label);
    expect(screen.getByRole("spinbutton", { name: /Cargo weight/ })).toHaveValue(43000);
    expect(screen.getByLabelText(/Departure \(your origin/)).toHaveValue(trip.departure_local);
    expect(mocks.submit).toHaveBeenCalledOnce();
    expect(mocks.submit).toHaveBeenCalledWith(expect.objectContaining({ origin: trip.origin, destination: trip.destination, cargo_lb: trip.cargo_lb, departure_local: trip.departure_local, spacing_mi: 25, wind_measure: "gust", weather_slowdown: true }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("Plan my own trip closes, focuses the origin, and leaves the form available", async () => {
    form(); fireEvent.click(within(await screen.findByRole("dialog", { name: title })).getByRole("button", { name: "Plan my own trip" }));
    await waitFor(() => expect(screen.getByRole("combobox", { name: "From" })).toHaveFocus());
    expect(screen.queryByRole("dialog")).toBeNull(); expect(mocks.submit).not.toHaveBeenCalled();
  });
  it("hides unavailable weather without consuming the daily display", async () => {
    mocks.hotspot.mockResolvedValue({ available: false, reason: "Nothing notable today" });
    form(); await waitFor(() => expect(mocks.hotspot).toHaveBeenCalledOnce());
    expect(screen.queryByRole("dialog")).toBeNull(); expect(localStorage.getItem(SHOWCASE_DATE_KEY)).toBeNull();
  });
  it("swaps optional trips before planning, with a two-alternative limit", async () => {
    const data = makeMockHotspot(), snow = data.more![0];
    snow.suggested_trip = { ...snow.suggested_trip, cargo_lb: 38000, departure_local: "2026-10-17T09:00" };
    data.more = [snow, { ...snow, hazard: "rain", headline: "Rain in Texas" }, { ...snow, hazard: "mixed", headline: "Omitted third trip" }];
    mocks.hotspot.mockResolvedValue(data); form();
    const dialog = await screen.findByRole("dialog", { name: title });
    fireEvent.click(within(dialog).getByRole("button", { name: /Heavy snow near the Colorado/ }));
    expect(dialog).toHaveTextContent("38,000 lb"); expect(within(dialog).queryByText(/Omitted third/)).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "Plan this route" }));
    expect(mocks.submit).toHaveBeenCalledWith(expect.objectContaining({ cargo_lb: 38000, departure_local: "2026-10-17T09:00" }));
  });
  it.each(["cancel", "outside"])("dismisses using %s without submitting", async kind => {
    form(); const dialog = await screen.findByRole("dialog", { name: title });
    if (kind === "cancel") fireEvent(dialog, new Event("cancel", { cancelable: true, bubbles: true }));
    else fireEvent.click(dialog, { clientX: -1, clientY: -1 });
    expect(screen.queryByRole("dialog")).toBeNull(); expect(mocks.submit).not.toHaveBeenCalled();
  });
  it("cancels on unmount and never interrupts a submitted plan with a late result", async () => {
    let resolve!: (data: ReturnType<typeof makeMockHotspot>) => void;
    mocks.hotspot.mockImplementation(() => new Promise(answer => { resolve = answer; }));
    const props = { demo: false, busy: false, onPlan: vi.fn(), onOwn: vi.fn() };
    const view = render(<WeatherShowcase {...props} />);
    const signal = mocks.hotspot.mock.calls[0][0] as AbortSignal;
    view.rerender(<WeatherShowcase {...props} busy />);
    await act(async () => resolve(makeMockHotspot()));
    expect(screen.queryByRole("dialog")).toBeNull(); expect(localStorage.getItem(SHOWCASE_DATE_KEY)).toBeNull();
    view.unmount(); expect(signal.aborted).toBe(true);
  });
  it("glows the form button, shows a 1.5 s tooltip, then hides it once per session", async () => {
    localStorage.setItem(SHOWCASE_DATE_KEY, "2026-10-17");
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] }); vi.setSystemTime(new Date("2026-10-17T12:00:00Z"));
    const first = form(); await act(async () => {});
    const button = screen.getByRole("button", { name: "Today's toughest weather" });
    expect(screen.queryByRole("dialog")).toBeNull();
    act(() => vi.advanceTimersByTime(0)); expect(button).toHaveAttribute("data-hint", "glow");
    expect(screen.queryByRole("tooltip")).toBeNull();
    act(() => vi.advanceTimersByTime(600)); expect(screen.getByRole("tooltip")).toHaveTextContent("today's worst US weather");
    expect(button).toHaveAccessibleDescription(/today's worst US weather/);
    act(() => vi.advanceTimersByTime(1499)); expect(screen.getByRole("tooltip")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1)); expect(screen.queryByRole("tooltip")).toBeNull(); expect(button).not.toHaveAttribute("data-hint");
    first.unmount(); form(); await act(async () => {});
    act(() => vi.advanceTimersByTime(2100));
    expect(screen.getByRole("button", { name: "Today's toughest weather" })).not.toHaveAttribute("data-hint");
  });
  it("offers the button without auto-opening when editing a trip", async () => {
    render(<WeatherShowcase demo={false} busy={false} autoOpen={false} onPlan={vi.fn()} onOwn={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Today's toughest weather" }));
    expect(screen.getByRole("dialog", { name: title })).toBeVisible();
    expect(localStorage.getItem(SHOWCASE_DATE_KEY)).toBeNull();
  });
  it("keeps planning usable if the showcase request fails", async () => {
    mocks.hotspot.mockRejectedValue(new Error("Endpoint unavailable")); form();
    await waitFor(() => expect(mocks.hotspot).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: "Plan routes" })).toBeEnabled(); expect(screen.queryByRole("dialog")).toBeNull();
  });
});
