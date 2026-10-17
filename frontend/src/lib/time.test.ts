import { describe, expect, it } from "vitest";
import {
  clampHour,
  elapsedAtHour,
  hourTimestamp,
  keyHour,
  zonedToUtc,
} from "./time";
describe("forecast slider time maths", () => {
  const base = "2026-10-16T11:00:00Z";
  it("anchors to base_utc, including a non-hour departure", () => {
    expect(hourTimestamp(base, 8).toISOString()).toBe(
      "2026-10-16T19:00:00.000Z",
    );
    expect(elapsedAtHour(base, "2026-10-16T11:30:00Z", 0)).toBe(-1800);
    expect(elapsedAtHour(base, "2026-10-16T11:30:00Z", 8)).toBe(27000);
  });
  it("implements arrows, six-hour paging and endpoint keys", () => {
    expect(keyHour("ArrowRight", 2)).toBe(3);
    expect(keyHour("ArrowLeft", 0)).toBe(0);
    expect(keyHour("ArrowDown", 4)).toBe(3);
    expect(keyHour("PageUp", 46)).toBe(48);
    expect(keyHour("PageDown", 4)).toBe(0);
    expect(keyHour("Home", 20)).toBe(0);
    expect(keyHour("End", 20)).toBe(48);
    expect(clampHour(NaN)).toBe(0);
  });
  it("keeps UTC elapsed time stable across the DST transition", () => {
    expect(hourTimestamp("2026-11-01T06:00:00Z", 2).toISOString()).toBe(
      "2026-11-01T08:00:00.000Z",
    );
    expect(zonedToUtc("2026-10-16T06:00", "America/Chicago")).toBe(
      "2026-10-16T11:00:00.000Z",
    );
    expect(zonedToUtc("2026-12-16T06:00", "America/Chicago")).toBe(
      "2026-12-16T12:00:00.000Z",
    );
  });
});
