import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, act } from "@testing-library/react";
import { ForecastClock } from "./ForecastClock";
import { makeMockPlan, demoPlaces } from "../api/mock";
import { timeline } from "../state/timeline";
describe("accessible forecast control", () => {
  it("supports keyboard paging and play / pause without putting slider position in React", async () => {
    timeline.reset();
    const plan = makeMockPlan({
      origin: demoPlaces[0],
      destination: demoPlaces[1],
      departure_local: "2026-10-16T06:00",
      cargo_lb: 42000,
      spacing_mi: 25,
      wind_measure: "gust",
      rest: { mode: "auto" },
    });
    render(<ForecastClock plan={plan} heatmap={null} />);
    const slider = screen.getByRole("slider", {
      name: "Corridor forecast time",
    });
    fireEvent.keyDown(slider, { key: "PageUp" });
    expect(timeline.get()).toBe(6);
    await act(() => new Promise((resolve) => requestAnimationFrame(resolve)));
    expect(slider.getAttribute("aria-valuetext")).toContain("6 hours after departure");
    fireEvent.click(screen.getByRole("button", { name: "Play forecast" }));
    expect(
      screen.getByRole("button", { name: "Pause forecast" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(slider).toHaveAttribute('step', 'any');
    timeline.set(1.5);
    await act(() => new Promise(resolve => requestAnimationFrame(resolve)));
    expect(slider).toHaveValue('1.5');
    fireEvent.click(screen.getByRole("button", { name: "Pause forecast" }));
    expect(timeline.isPlaying()).toBe(false);
  });

  it("implements every APG slider key and clamps at the forecast horizon", async () => {
    timeline.reset();
    const plan = makeMockPlan({
      origin: demoPlaces[0],
      destination: demoPlaces[1],
      departure_local: "2026-10-16T06:00",
      cargo_lb: 42000,
      spacing_mi: 25,
      wind_measure: "gust",
      rest: { mode: "auto" },
    });
    render(<ForecastClock plan={plan} heatmap={null} />);
    const slider = screen.getByRole("slider", { name: "Corridor forecast time" });
    expect(slider).toHaveAttribute("aria-valuetext", "Fri 6:00 AM, 0 hours after departure");
    for (const [key, expected] of [
      ["ArrowLeft", 0], ["ArrowRight", 1], ["ArrowUp", 2], ["ArrowDown", 1],
      ["PageUp", 7], ["PageDown", 1], ["End", 48], ["ArrowUp", 48], ["Home", 0],
    ] as const) {
      fireEvent.keyDown(slider, { key });
      expect(timeline.get()).toBe(expected);
    }
    await act(() => new Promise((resolve) => requestAnimationFrame(resolve)));
    expect(slider).toHaveValue("0");
    expect(screen.getByRole("button", { name: "About forecast time" })).toHaveAccessibleDescription(
      "Heat and trucks follow this time. Route risk is rated at each checkpoint's ETA.",
    );
  });

  it("scrubs without rerendering its owner or fetching, and describes the rounded forecast base accurately", async () => {
    timeline.reset();
    const plan = makeMockPlan({
      origin: demoPlaces[0],
      destination: demoPlaces[1],
      departure_local: "2026-10-16T06:30",
      cargo_lb: 42000,
      spacing_mi: 25,
      wind_measure: "gust",
      rest: { mode: "auto" },
    });
    let renders = 0;
    function Owner() {
      renders++;
      return <ForecastClock plan={plan} heatmap={null} />;
    }
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    try {
      render(<Owner />);
      const slider = screen.getByRole("slider", { name: "Corridor forecast time" });
      expect(slider).toHaveAttribute("aria-valuetext", "Fri 6:00 AM, 0.5 hours before departure");
      fireEvent.input(slider, { target: { value: "12" } });
      await act(() => new Promise((resolve) => requestAnimationFrame(resolve)));
      expect(timeline.get()).toBe(12);
      expect(slider).toHaveAttribute("aria-valuetext", "Fri 6:00 PM, 11.5 hours after departure");
      expect(renders).toBe(1);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("opens risk strips without crashing and labels each truck's position", async () => {
    // Regression: JourneyPositions read an unattached ref (null.querySelectorAll) when strips opened.
    timeline.reset();
    const plan = makeMockPlan({
      origin: demoPlaces[0],
      destination: demoPlaces[1],
      departure_local: "2026-10-16T06:00",
      cargo_lb: 42000,
      spacing_mi: 25,
      wind_measure: "gust",
      rest: { mode: "auto" },
    });
    render(<ForecastClock plan={plan} heatmap={null} />);
    fireEvent.click(screen.getByRole("button", { name: /risk strips/i }));
    expect(screen.getByRole("list", { name: "Truck positions at selected time" })).toBeInTheDocument();
    expect(document.querySelector(".risk-strip i")?.getAttribute("title")).toContain(plan.routes[0].checkpoints[0].place_label);
    timeline.set(6);
    await act(() => new Promise((resolve) => requestAnimationFrame(resolve)));
    const positions = screen.getAllByText(/Driving|Resting|Arrived|Waiting/);
    expect(positions.length).toBe(plan.routes.length);
    const heads = document.querySelectorAll<HTMLElement>(".risk-playhead");
    expect(heads).toHaveLength(plan.routes.length);
    heads.forEach(head => expect(head.style.getPropertyValue("--playhead")).toBe("12.5%"));
    timeline.set(12.5);
    await act(() => new Promise((resolve) => requestAnimationFrame(resolve)));
    heads.forEach(head => expect(parseFloat(head.style.getPropertyValue("--playhead"))).toBeCloseTo(12.5 / 48 * 100));
    fireEvent.click(screen.getByRole("button", { name: /risk strips/i }));
    expect(screen.queryByRole("list", { name: "Truck positions at selected time" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /risk strips/i })).toHaveAttribute("aria-expanded", "false");
  });
});
