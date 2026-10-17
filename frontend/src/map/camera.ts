import type { Map } from "maplibre-gl";
import type { Coordinate } from "../lib/geometry";

export interface Camera {
  center: Coordinate;
  zoom: number;
  bearing: number;
  pitch: number;
}

// Survives panel Retry and navigation/remounts. Never written into an API/cache payload.
export const planCameras = new globalThis.Map<string, Camera>();
export function rememberCamera(planId: string, map: Map) {
  const center = map.getCenter();
  planCameras.set(planId, { center: [center.lng, center.lat], zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch() });
}

type CameraReason = "new-plan" | "fit-trip" | "route-card" | "route-pill" | "checkpoint-list" | "checkpoint-offscreen" | "restore-camera" | "restore-theme" | "zoom-control" | "drive-intro" | "drive-chase" | "drive-outro" | "drive-restore";
export function programmaticCamera(reason: CameraReason, action: () => void) {
  if (import.meta.env.DEV) {
    try {
      if (localStorage.getItem("spotter.debug.camera") === "1") console.log(`[spotter.camera] ${reason}`);
    } catch { /* Debugging storage is optional in private mode. */ }
  }
  action();
}
