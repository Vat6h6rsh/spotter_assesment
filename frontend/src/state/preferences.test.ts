import { describe, expect, it, vi } from "vitest";
import {
  defaultPreferences,
  PREFERENCES_KEY,
  readPreferences,
  resolveTheme,
  savePreferences,
  preferences,
  initializeTheme,
} from "./preferences";
describe("theme and defaults persistence", () => {
  it("notifies the app when System changes mode, so CSS and the basemap stay together", () => {
    const original = window.matchMedia;
    let change = () => {};
    const media = {
      ...original("(prefers-color-scheme: dark)"),
      matches: false,
      addEventListener: vi.fn((_event, listener) => {
        change = listener;
      }),
      removeEventListener: vi.fn(),
    };
    window.matchMedia = () => media;
    preferences.update({ theme: "system" });
    const stop = initializeTheme(),
      before = preferences.get();
    media.matches = true;
    change();
    expect(document.documentElement.dataset.theme).toBe("04");
    expect(preferences.get()).not.toBe(before);
    stop();
    window.matchMedia = original;
  });
  it("defaults to System and maps dark/light system preferences", () => {
    expect(readPreferences({ getItem: () => null }).theme).toBe("system");
    expect(resolveTheme("system", true)).toBe("04");
    expect(resolveTheme("system", false)).toBe("02");
    expect(resolveTheme("05", false)).toBe("05");
  });
  it("round-trips a chosen theme and planning defaults", () => {
    const memory = new Map<string, string>();
    const storage = {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => {
        memory.set(key, value);
      },
    };
    const value = {
      ...defaultPreferences,
      theme: "06" as const,
      spacing: 10 as const,
      wind: "sustained" as const,
    };
    expect(savePreferences(value, storage)).toBe(true);
    expect(memory.has(PREFERENCES_KEY)).toBe(true);
    expect(readPreferences(storage)).toEqual(value);
  });
  it("survives denied storage, malformed JSON and unsupported themes", () => {
    expect(
      readPreferences({
        getItem: () => {
          throw new Error("blocked");
        },
      }),
    ).toEqual(defaultPreferences);
    expect(
      savePreferences(defaultPreferences, {
        setItem: () => {
          throw new Error("quota");
        },
      }),
    ).toBe(false);
    expect(readPreferences({ getItem: () => "{" })).toEqual(defaultPreferences);
    expect(
      readPreferences({
        getItem: () =>
          JSON.stringify({ theme: "unapproved", spacing: 17, wind: "invalid" }),
      }),
    ).toEqual(defaultPreferences);
  });
});
