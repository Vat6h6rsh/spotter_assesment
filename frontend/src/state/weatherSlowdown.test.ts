import { describe, expect, it } from "vitest";
import { PREFERENCES_KEY, readPreferences } from "./preferences";

const storage = (value: unknown) => ({ getItem: (key: string) => (key === PREFERENCES_KEY ? JSON.stringify(value) : null) });

describe("weather slowdown preference", () => {
  it("defaults to on, including for preferences saved before the option existed", () => {
    expect(readPreferences(storage(null)).weatherSlowdown).toBe(true);
    expect(readPreferences(storage({ theme: "04", spacing: 25, wind: "gust" })).weatherSlowdown).toBe(true);
  });
  it("keeps an explicit opt-out", () => {
    expect(readPreferences(storage({ weatherSlowdown: false })).weatherSlowdown).toBe(false);
  });
});
