import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Level } from "../api/types";
import { SeverityIcon } from "./severityIcons";
describe("one severity icon language", () => {
  it.each([
    [0, "circle-filled"], [1, "square-filled"], [2, "triangle-filled"],
    [3, "square-rotated-filled"], [4, "circle-x-filled"], [null, "help"],
  ] as [Level, string][])("level %s uses Tabler %s", (level, shape) => {
    const { container } = render(<SeverityIcon level={level} />);
    const icon = container.querySelector("svg");
    expect(icon).toHaveClass(`tabler-icon-${shape}`);
    expect(icon).toHaveAttribute("aria-hidden", "true");
    expect(icon).toHaveAttribute("width", "16");
  });
});
