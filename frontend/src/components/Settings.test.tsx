import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Settings } from "./Settings";
import { FONTS, FONT_SAMPLE, fonts } from "../state/fonts";

describe("Settings typeface picker", () => {
  beforeEach(async () => {
    Object.defineProperty(document, "fonts", {
      configurable: true,
      value: { load: vi.fn().mockResolvedValue([]) },
    });
    await fonts.select("plex");
  });

  it("offers four native radio choices and a live tabular-number sample", async () => {
    vi.spyOn(FONTS.manrope, "load").mockResolvedValue({ default: "" });
    const back = vi.fn();
    render(<Settings onBack={back} />);
    const wind = screen.getByRole("radiogroup", { name: "Wind used for risk" });
    expect(within(wind).getByRole("radio", { name: "Gusts" })).toBeInTheDocument();
    const steady = within(wind).getByRole("radio", { name: "Sustained" });
    fireEvent.click(steady);
    expect(steady).toHaveAttribute("aria-checked", "true");
    expect(wind).toHaveAccessibleDescription("Gusts are short peaks; sustained is the average over about 10 minutes. Thresholds: 25 / 35 / 45 / 55 mph. Rates the steady speed only (mph).");
    expect(JSON.parse(localStorage.getItem("spotter.preferences.v05") || "null")).toMatchObject({ wind: "sustained" });
    const group = screen.getByRole("radiogroup", { name: "Typeface" });
    expect(within(group).getAllByRole("radio")).toHaveLength(4);
    expect(screen.getByRole("radio", { name: /IBM Plex Sans/ })).toBeChecked();
    expect(screen.getByLabelText("Typeface live sample")).toHaveTextContent(FONT_SAMPLE);
    expect(screen.getByLabelText("Typeface live sample")).toHaveClass("num");
    fireEvent.click(screen.getByRole("radio", { name: /Manrope/ }));
    await waitFor(() => expect(screen.getByRole("radio", { name: /Manrope/ })).toBeChecked());
    expect(document.documentElement.dataset.font).toBe("manrope");
    fireEvent.click(screen.getByRole("button", { name: "Back to your route" }));
    expect(back).toHaveBeenCalledOnce();
  });
});
