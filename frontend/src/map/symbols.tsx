import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { IconBed, IconClockPause, IconCoffee, IconCircleDot, IconMapPinFilled, IconCircleCheckFilled, IconBan } from "@tabler/icons-react";
import { SeverityIcon } from "../lib/severityIcons";
import type { Level } from "../api/types";
import type { Colors } from "./paint";

export const CHECKPOINT_SYMBOLS = [
  { level: 4, size: 20, selectedZoom: 0, alternativeZoom: 0, priority: 0, token: "stop" },
  { level: 3, size: 18, selectedZoom: 0, alternativeZoom: 4, priority: 1, token: "severe" },
  { level: 2, size: 16, selectedZoom: 4, alternativeZoom: 6, priority: 2, token: "high" },
  { level: 1, size: 12, selectedZoom: 6, alternativeZoom: 6, priority: 3, token: "moderate" },
  { level: 0, size: 8, selectedZoom: 7, alternativeZoom: 7, priority: 4, token: "low" },
  { level: 255, size: 14, selectedZoom: 6, alternativeZoom: 6, priority: 5, token: "unknown" },
] as const;
export const checkpointSymbol = (level: number) => CHECKPOINT_SYMBOLS.find((s) => s.level === level) ?? CHECKPOINT_SYMBOLS[5];
export const symbolId = (level: number) => `severity-${level}`;

/** Dilate the rendered alpha mask by 2 CSS px, then composite the surface ring below it. */
export function bakeSurfaceRing<T extends { width: number; height: number; data: Uint8ClampedArray }>(image: T, surface: string, radius = 4): T {
  const original = image.data.slice();
  const rgb = [parseInt(surface.slice(1, 3), 16), parseInt(surface.slice(3, 5), 16), parseInt(surface.slice(5, 7), 16)];
  const offsets: [number, number][] = [];
  for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) if (dx * dx + dy * dy <= radius * radius) offsets.push([dx, dy]);
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
    const index = (y * image.width + x) * 4;
    let dilatedAlpha = 0;
    for (const [dx, dy] of offsets) {
      const sx = x + dx, sy = y + dy;
      if (sx >= 0 && sx < image.width && sy >= 0 && sy < image.height) dilatedAlpha = Math.max(dilatedAlpha, original[(sy * image.width + sx) * 4 + 3]);
    }
    const alpha = original[index + 3] / 255, ringAlpha = dilatedAlpha / 255;
    const combinedAlpha = alpha + ringAlpha * (1 - alpha);
    if (!combinedAlpha) continue;
    for (let channel = 0; channel < 3; channel++) image.data[index + channel] = Math.round((original[index + channel] * alpha + rgb[channel] * ringAlpha * (1 - alpha)) / combinedAlpha);
    image.data[index + 3] = Math.round(combinedAlpha * 255);
  }
  return image;
}

/** Rasterise trusted Tabler geometry synchronously: no image decode, URLs or React commit. */
export function drawTabler(context: CanvasRenderingContext2D, icon: ReactElement, color: string, x: number, y: number, size: number) {
  const svg = new DOMParser().parseFromString(renderToStaticMarkup(icon), "image/svg+xml").documentElement;
  const attribute = (element: Element, name: string): string | null => element.getAttribute(name) ?? (element.parentElement ? attribute(element.parentElement, name) : null);
  context.save(); context.translate(x, y); context.scale(size / 24, size / 24);
  context.lineCap = "round"; context.lineJoin = "round";
  for (const element of svg.querySelectorAll("path,circle,ellipse,line,polyline,polygon,rect")) {
    const path = new Path2D(element.getAttribute("d") ?? "");
    const n = (key: string) => Number(element.getAttribute(key) ?? 0);
    switch (element.localName) {
      case "circle": path.arc(n("cx"), n("cy"), n("r"), 0, Math.PI * 2); break;
      case "ellipse": path.ellipse(n("cx"), n("cy"), n("rx"), n("ry"), 0, 0, Math.PI * 2); break;
      case "line": path.moveTo(n("x1"), n("y1")); path.lineTo(n("x2"), n("y2")); break;
      case "rect": path.roundRect(n("x"), n("y"), n("width"), n("height"), n("rx")); break;
      case "polyline": case "polygon": {
        const points = (element.getAttribute("points") ?? "").trim().split(/[\s,]+/).map(Number);
        for (let i = 0; i < points.length; i += 2) { if (i) path.lineTo(points[i], points[i + 1]); else path.moveTo(points[i], points[i + 1]); }
        if (element.localName === "polygon") path.closePath();
      }
    }
    const fill = attribute(element, "fill") ?? "black", stroke = attribute(element, "stroke") ?? "none";
    if (fill !== "none") { context.fillStyle = fill === "currentColor" ? color : fill; context.fill(path); }
    if (stroke !== "none") { context.strokeStyle = stroke === "currentColor" ? color : stroke; context.lineWidth = Number(attribute(element, "stroke-width") ?? 2); context.stroke(path); }
  }
  context.restore();
}

/** Every app sprite is installed before layers and can be rebuilt inside styleimagemissing. */
export const MAP_SYMBOL_IDS = [
  ...CHECKPOINT_SYMBOLS.map(spec => symbolId(spec.level)),
  "rest-break30", "rest-rest10h", "rest-custom", "endpoint-origin", "endpoint-destination",
  ...["normal", "highlight"].flatMap(kind => ["plain", "recommended", "blocked"].map(status => `route-pill-${kind}-${status}`)),
];
export function mapSymbolImage(id: string, palette: Colors): ImageData | null {
  if (id.startsWith("route-pill-")) return routePillImage(id, palette);
  const spec = id.startsWith("severity-") ? checkpointSymbol(Number(id.slice(9))) : null;
  const rest = id.startsWith("rest-");
  const origin = id === "endpoint-origin", destination = id === "endpoint-destination";
  if (!spec && !rest && !origin && !destination) return null;
  const size = spec?.size ?? (rest ? 24 : origin ? 14 : 28), total = size + 4;
  const canvas = document.createElement("canvas"); canvas.width = canvas.height = total * 2;
  const context = canvas.getContext("2d");
  if (!context) return null;
  if (rest) {
    context.beginPath(); context.arc(total, total, size - 1.5, 0, Math.PI * 2);
    context.fillStyle = palette.surface2; context.fill(); context.strokeStyle = palette.muted; context.lineWidth = 3; context.stroke();
  }
  const RestIcon = id === "rest-break30" ? IconCoffee : id === "rest-rest10h" ? IconBed : IconClockPause;
  const icon = spec ? <SeverityIcon level={(spec.level === 255 ? null : spec.level) as Level} size={size} />
    : rest ? <RestIcon size={14} stroke={1.75} /> : origin ? <IconCircleDot size={14} stroke={2} /> : <IconMapPinFilled size={28} />;
  const iconSize = rest ? 14 : size, offset = total - iconSize;
  drawTabler(context, icon, spec ? palette[spec.token] : palette.text, offset, offset, iconSize * 2);
  return bakeSurfaceRing(context.getImageData(0, 0, canvas.width, canvas.height), palette.surface);
}

// Stretch only the empty centre; keep the theme border, rounded ends and Tabler status icon crisp.
// The icon occupies x=14..42, y=18..46. Neither stretch band may cross it.
export const pillImageOptions = { pixelRatio: 2, stretchX: [[56, 72] as [number, number]], stretchY: [[48, 50] as [number, number]], content: [52, 14, 96, 50] as [number, number, number, number] };
function routePillImage(id: string, palette: Colors): ImageData | null {
  const canvas = document.createElement("canvas"); canvas.width = 112; canvas.height = 64;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.beginPath(); context.roundRect(2, 2, 108, 60, 24);
  context.fillStyle = palette.surface; context.fill();
  context.lineWidth = id.includes("highlight") ? 4 : 2;
  context.strokeStyle = id.includes("highlight") ? palette.primary : palette.border;
  context.stroke();
  if (!id.endsWith("plain")) {
    const Status = id.endsWith("blocked") ? IconBan : IconCircleCheckFilled;
    drawTabler(context, <Status size={28} />, id.endsWith("blocked") ? palette.stop : palette.text, 14, 18, 28);
  }
  return context.getImageData(0, 0, canvas.width, canvas.height);
}
