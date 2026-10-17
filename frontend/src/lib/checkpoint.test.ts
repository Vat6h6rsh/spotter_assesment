import { describe, expect, it } from "vitest";
import type { Checkpoint } from "../api/types";
import { checkpointClearing } from "./checkpoint";

const cp = { level: 4, eta_utc: "2026-11-01T05:30:00Z", tz: "America/Chicago" } as Checkpoint;
describe("checkpoint clearing clock", () => {
  it("adds hours to the checkpoint ETA in UTC across DST when the absolute time is omitted", () => {
    expect(checkpointClearing({ ...cp, clears_in_h: 3 })).toMatch(/^Clear roads in about 3 h \(Sun,? 2:30 AM CST\)\.$/);
    expect(checkpointClearing({ ...cp, clears_in_h: 0, clears_at_utc: cp.eta_utc })).toMatch(/^Clear roads in about 0 h \(Sun,? 12:30 AM CDT\)\.$/);
  });
  it("uses the server clearing instant and retains fractional hours", () => {
    expect(checkpointClearing({ ...cp, clears_in_h: 1.5, clears_at_utc: "2026-11-01T08:00:00Z" })).toMatch(/^Clear roads in about 1.5 h \(Sun,? 2:00 AM CST\)\.$/);
  });
});
