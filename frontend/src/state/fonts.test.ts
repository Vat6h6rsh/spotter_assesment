import { beforeEach, describe, expect, it, vi } from "vitest";
import { FONTS, FONT_KEY, fonts, initializeFont, readFont, saveFont } from "./fonts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("typeface loading and persistence", () => {
  beforeEach(async () => {
    localStorage.clear();
    Object.defineProperty(document, "fonts", {
      configurable: true,
      value: { load: vi.fn().mockResolvedValue([]) },
    });
    await fonts.select("plex");
  });

  it("validates saved IDs and survives blocked storage", () => {
    expect(readFont({ getItem: () => "manrope" })).toBe("manrope");
    for (const value of [null, "inter", "constructor", "__proto__", "{"])
      expect(readFont({ getItem: () => value })).toBe("plex");
    expect(readFont({ getItem: () => { throw new Error("blocked"); } })).toBe("plex");
    expect(saveFont("plex", { setItem: () => { throw new Error("quota"); } })).toBe(false);
  });

  it("waits for glyphs before applying or persisting a selection", async () => {
    vi.spyOn(FONTS.atkinson, "load").mockResolvedValue({ default: "" });
    const glyphs = deferred<FontFace[]>();
    vi.mocked(document.fonts.load).mockReturnValue(glyphs.promise);
    const selected = fonts.select("atkinson");
    await Promise.resolve();
    expect(fonts.get().pending).toBe("atkinson");
    expect(document.documentElement.dataset.font).toBe("plex");
    expect(localStorage.getItem(FONT_KEY)).toBe("plex");
    glyphs.resolve([]);
    expect(await selected).toBe(true);
    expect(document.fonts.load).toHaveBeenCalledWith(expect.stringContaining('500 14px "Atkinson'), expect.any(String));
    expect(document.documentElement.dataset.font).toBe("atkinson");
    expect(localStorage.getItem(FONT_KEY)).toBe("atkinson");
  });

  it("keeps the latest selection when an earlier CSS import finishes last", async () => {
    const older = deferred<{ default: string }>();
    vi.spyOn(FONTS.atkinson, "load").mockReturnValue(older.promise);
    vi.spyOn(FONTS.manrope, "load").mockResolvedValue({ default: "" });
    const first = fonts.select("atkinson");
    const latest = fonts.select("manrope");
    expect(await latest).toBe(true);
    older.resolve({ default: "" });
    expect(await first).toBe(false);
    expect(fonts.get().id).toBe("manrope");
    expect(document.documentElement.dataset.font).toBe("manrope");
    expect(localStorage.getItem(FONT_KEY)).toBe("manrope");
  });

  it("restores a saved font and keeps the readable font when an offline import fails", async () => {
    vi.spyOn(FONTS.source, "load").mockResolvedValue({ default: "" });
    localStorage.setItem(FONT_KEY, "source");
    await initializeFont();
    expect(document.documentElement.dataset.font).toBe("source");
    vi.spyOn(FONTS.manrope, "load").mockRejectedValue(new Error("offline"));
    expect(await fonts.select("manrope")).toBe(false);
    expect(fonts.get()).toMatchObject({ id: "source", pending: null, error: expect.stringContaining("could not be loaded") });
    expect(localStorage.getItem(FONT_KEY)).toBe("source");
    expect(document.documentElement.dataset.font).toBe("source");
  });
});
