import { describe, expect, it } from "vitest";
import { duration, number, percent, unit } from "./fmt";
describe("US road and weather formatting", () => {
  it("groups distances and loads without discarding forecast precision", () => {
    expect(unit(1347, "mi")).toBe("1,347 mi");
    expect(unit(42000, "lb")).toBe("42,000 lb");
    expect(unit(38, "mph")).toBe("38 mph");
    expect(unit(.25, "in/hr", 2)).toBe("0.25 in/hr");
    expect(number(.31, 2)).toBe("0.31");
    expect(percent(.951)).toBe("95%");
  });
  it("rounds elapsed minutes across an hour boundary", () => {
    expect(duration(3599)).toBe("1h");
    expect(duration(28 * 3600 + 26 * 60)).toBe("28h 26m");
    expect(duration(3780)).toBe("1h 03m");
  });
});
