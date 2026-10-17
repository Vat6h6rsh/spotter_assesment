import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PanelErrorBoundary } from "./PanelErrorBoundary";

describe("panel error containment", () => {
  it("preserves the other panels and retries the failed panel", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    let broken = true;
    function Child() {
      if (broken) throw new Error("Map failed");
      return <p>Map recovered</p>;
    }
    render(<><aside>Route information stays usable</aside><PanelErrorBoundary label="Map"><Child /></PanelErrorBoundary></>);
    expect(screen.getByText("Route information stays usable")).toBeVisible();
    expect(screen.getByRole("alert", { name: "Map error" })).toHaveTextContent("This panel hit a problem ·");
    broken = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(screen.getByText("Map recovered")).toBeVisible();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
