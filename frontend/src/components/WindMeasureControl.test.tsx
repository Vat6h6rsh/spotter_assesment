import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { WindMeasure } from "../api/types";
import { WindMeasureControl } from "./WindMeasureControl";

describe("wind segmented radio control", () => {
  it("uses one Tab stop, arrow selection with wraparound, and choice-specific helper text", () => {
    function Harness() {
      const [wind, setWind] = useState<WindMeasure>("gust");
      return <WindMeasureControl value={wind} onChange={setWind} prefix="test" />;
    }
    render(<Harness />);
    const group = screen.getByRole("radiogroup", { name: "Wind used for risk" });
    const gusts = screen.getByRole("radio", { name: "Gusts" });
    const sustained = screen.getByRole("radio", { name: "Sustained" });
    expect(gusts).toHaveAttribute("tabindex", "0");
    expect(sustained).toHaveAttribute("tabindex", "-1");
    expect(group).toHaveAccessibleDescription(/Rates the higher of gust or sustained speed \(mph\)\./);
    gusts.focus();
    for (const [key, target] of [["ArrowRight", sustained], ["ArrowDown", gusts], ["ArrowLeft", sustained], ["ArrowUp", gusts], ["End", sustained], ["Home", gusts]] as const) {
      fireEvent.keyDown(document.activeElement!, { key });
      expect(target).toHaveFocus();
      expect(target).toHaveAttribute("aria-checked", "true");
      expect(target).toHaveAttribute("tabindex", "0");
    }
    fireEvent.click(sustained);
    expect(gusts).toHaveAttribute("tabindex", "-1");
    expect(group).toHaveAccessibleDescription(/Rates the steady speed only \(mph\)\./);
  });
});
