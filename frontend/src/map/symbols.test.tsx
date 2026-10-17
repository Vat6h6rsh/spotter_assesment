import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { CHECKPOINT_SYMBOLS, checkpointSymbol, symbolId, bakeSurfaceRing, mapSymbolImage, pillImageOptions } from "./symbols";
import { SeverityIcon } from "../lib/severityIcons";
function canvasSpy() {
  const paths: { d: string }[] = [];
  vi.stubGlobal("Path2D", class {
    d: string;
    constructor(d = "") { this.d = d; paths.push(this); }
    arc() {} ellipse() {} moveTo() {} lineTo() {} roundRect() {} closePath() {}
  });
  const context = {
    beginPath: vi.fn(), roundRect: vi.fn(), arc: vi.fn(), save: vi.fn(), restore: vi.fn(), translate: vi.fn(), scale: vi.fn(),
    fillStyle: "", strokeStyle: "", lineWidth: 0,
    fill: vi.fn(), stroke: vi.fn(),
    getImageData: (_x: number, _y: number, width: number, height: number) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) }),
  };
  const borders: string[] = [];
  context.stroke.mockImplementation((path?: unknown) => { if (!path) borders.push(context.strokeStyle); });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context as never);
  return { context, paths, borders };
}
describe("checkpoint severity symbol contract", () => {
  it("keeps both nine-slice bands outside Tabler status icons and preserves theme borders", () => {
    const { context, paths, borders } = canvasSpy();
    try {
      const palette = { surface: "#ffffff", border: "#999999", primary: "#123456", stop: "#ff0000", text: "#000000" };
      for (const id of ["route-pill-highlight-recommended", "route-pill-normal-blocked"]) expect(mapSymbolImage(id, palette)).toMatchObject({ width: 112, height: 64 });
      expect(borders).toEqual([palette.primary, palette.border]);
      expect(context.translate).toHaveBeenCalledWith(14, 18);
      expect(context.scale).toHaveBeenCalledWith(28 / 24, 28 / 24);
      expect(paths.some(path => path.d.length > 20)).toBe(true);
      expect(pillImageOptions.stretchX.every(([start, end]) => end <= 14 || start >= 42)).toBe(true);
      expect(pillImageOptions.stretchY.every(([start, end]) => end <= 18 || start >= 46)).toBe(true);
      expect(pillImageOptions.content).toEqual([52, 14, 96, 50]);
    } finally { vi.unstubAllGlobals(); vi.restoreAllMocks(); }
  });
  it("maps each severity to exact size, zoom gates and collision priority", () => {
    expect(CHECKPOINT_SYMBOLS.map(({ level, size, selectedZoom, alternativeZoom, priority }) => [level, size, selectedZoom, alternativeZoom, priority])).toEqual([
      [4, 20, 0, 0, 0], [3, 18, 0, 4, 1], [2, 16, 4, 6, 2], [1, 12, 6, 6, 3], [0, 8, 7, 7, 4], [255, 14, 6, 6, 5],
    ]);
    expect(checkpointSymbol(255).token).toBe("unknown");
    expect(symbolId(255)).toBe("severity-255");
    expect(new Set(CHECKPOINT_SYMBOLS.map((s) => symbolId(s.level))).size).toBe(6);
  });
  it("dilates the actual alpha silhouette by 4 device pixels (2 CSS pixels) and preserves the core", () => {
    const data = new Uint8ClampedArray(15 * 15 * 4), center = (7 * 15 + 7) * 4;
    data.set([240, 20, 30, 255], center);
    const image = bakeSurfaceRing({ width: 15, height: 15, data }, "#abcdef");
    const pixel = (x: number, y: number) => Array.from(image.data.slice((y * 15 + x) * 4, (y * 15 + x + 1) * 4));
    expect(pixel(7, 7)).toEqual([240, 20, 30, 255]);
    expect(pixel(11, 7)).toEqual([171, 205, 239, 255]);
    expect(pixel(12, 7)).toEqual([0, 0, 0, 0]);
    expect(pixel(10, 10)).toEqual([0, 0, 0, 0]);
    expect(pixel(9, 9)).toEqual([171, 205, 239, 255]);
  });
  it("rasterises exactly the UI Tabler paths synchronously at 2x density without fetching or decoding images", () => {
    const { context, paths } = canvasSpy(), image = vi.fn(), url = vi.spyOn(URL, "createObjectURL");
    vi.stubGlobal("Image", image);
    try {
      const result = mapSymbolImage("severity-4", { stop: "#123456", surface: "#ffffff" });
      expect(result).toMatchObject({ width: 48, height: 48 });
      const ui = render(<SeverityIcon level={4} size={20} />);
      expect(paths.map(path => path.d)).toEqual(Array.from(ui.container.querySelectorAll("path"), p => p.getAttribute("d")));
      expect(context.translate).toHaveBeenCalledWith(4, 4);
      expect(context.scale).toHaveBeenCalledWith(40 / 24, 40 / 24);
      expect(image).not.toHaveBeenCalled(); expect(url).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); vi.restoreAllMocks(); }
  });
});
