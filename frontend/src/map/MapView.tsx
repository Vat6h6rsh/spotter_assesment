import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { Map, Marker, Popup, AttributionControl, setWorkerUrl } from "maplibre-gl";
import type { ExpressionSpecification } from "maplibre-gl";
import { IconTruckFilled, IconPlus, IconMinus, IconZoomScan, IconInfoCircle, IconStack2, IconCoffee, IconX } from "@tabler/icons-react";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Checkpoint, Plan, Route } from "../api/types";
import type { PreparedHeatmap } from "../lib/heatmap";
import { pointAtDistance, prepareGeometry, truckPosition } from "../lib/geometry";
import type { Coordinate } from "../lib/geometry";
import { elapsedAtHour, duration } from "../lib/time";
import { severities } from "../lib/risk";
import { HeatLegend } from "./HeatLegend";
import { timeline } from "../state/timeline";
import { planner } from "../state/planner";
import type { SelectionSource } from "../state/planner";
import { checkpointPlaceLabel } from "../lib/checkpointPlace";
import { planCameras, rememberCamera, programmaticCamera } from "./camera";
import type { Camera } from "./camera";
import { heatExpression, severityTexture, stateHeatExpression, heatTokens, easeOutCubic } from "./paint";
import type { Colors, TextureLevel } from "./paint";
import { checkpointSymbol, mapSymbolImage, symbolId, pillImageOptions, MAP_SYMBOL_IDS } from "./symbols";
import { checkpointVisibility, NO_CHECKPOINT, pickedCheckpointFilter, routeEtaFilter } from "./filters";
import { CheckpointPopup } from "./popup";
import { buildCheckpointPopup } from "./popupContent";
import { smoothTruck } from "./motion";
import type { TruckMotion } from "./motion";
import { DriveHud } from "../drive/DriveHud";
import { drive, useDrive } from "../drive/state";
import { createDriveController } from "../drive/controller";
import type { DriveController } from "../drive/controller";
import type { DriveSession } from "../drive/state";
import { tripBounds } from "../drive/math";
setWorkerUrl(workerUrl);

interface Props {
  plan: Plan | null; heatmap: PreparedHeatmap | null; selected: string | null;
  checkpoint: number | null; previewRoute?: string | null; layoutKey?: string; theme: string; phase: string; heatmapError: string | null;
  selectionSource?: SelectionSource | null;
}
const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const routeLayers = ["route-no-travel-overlay", "route-severe-overlay", "route-selected", "route-alt", "route-casing"];
const pointLayers = ["route-summaries", "checkpoint-label", "checkpoint-eta", "checkpoint-selected", "checkpoint-hit", "checkpoint-markers", "checkpoint-dots", "rest-labels", "rest-markers", "endpoints"];
function colors(): Colors {
  const style = getComputedStyle(document.documentElement);
  const result = Object.fromEntries(["map", "map-line", "map-text", "surface", "surface2", "border", "text", "muted", "primary", "route-alt", "map-casing", ...severities.map((s) => s.token)].map((key) => [key, style.getPropertyValue(`--${key}`).trim()]));
  result["map-casing"] ||= result.surface;
  result["route-alt"] ||= result.muted;
  return result;
}
function levelExpression(palette: Colors): ExpressionSpecification {
  return ["match", ["get", "level"], 0, palette.low, 1, palette.moderate, 2, palette.high, 3, palette.severe, 4, palette.stop, palette.unknown];
}
function routeFeatures(route: Route, geometry: ReturnType<typeof prepareGeometry>) {
  const scale = geometry.prefix.at(-1)! / route.distance_mi;
  return route.checkpoints.map((cp, index) => {
    const start = index ? (route.checkpoints[index - 1].mi + cp.mi) / 2 : 0;
    const end = index < route.checkpoints.length - 1 ? (cp.mi + route.checkpoints[index + 1].mi) / 2 : route.distance_mi;
    const coords = [pointAtDistance(geometry.points, geometry.prefix, start * scale)];
    for (let i = 0; i < geometry.points.length; i++) if (geometry.prefix[i] > start * scale && geometry.prefix[i] < end * scale) coords.push(geometry.points[i]);
    coords.push(pointAtDistance(geometry.points, geometry.prefix, end * scale));
    return { type: "Feature" as const, properties: { route: route.id, level: cp.level ?? 255 }, geometry: { type: "LineString" as const, coordinates: coords } };
  });
}
function prepareRoutes(plan: Plan) {
  const geometries = new globalThis.Map(plan.routes.map((route) => [route.id, prepareGeometry(route)]));
  const lines = { type: "FeatureCollection" as const, features: plan.routes.flatMap((route) => routeFeatures(route, geometries.get(route.id)!)) };
  const checkpoints = { type: "FeatureCollection" as const, features: plan.routes.flatMap((route) => route.checkpoints.map((cp) => ({
    type: "Feature" as const,
    properties: { route: route.id, i: cp.i, level: cp.level ?? 255, image: symbolId(cp.level ?? 255), priority: checkpointSymbol(cp.level ?? 255).priority, placeLabel: checkpointPlaceLabel(cp), label: new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: cp.tz }).format(new Date(cp.eta_utc)) },
    geometry: { type: "Point" as const, coordinates: [cp.lon, cp.lat] },
  }))) };
  const rests = { type: "FeatureCollection" as const, features: plan.routes.flatMap((route) => route.rests.map((rest) => ({
    type: "Feature" as const, properties: { route: route.id, label: duration(rest.duration_s), image: `rest-${rest.kind}` },
    geometry: { type: "Point" as const, coordinates: [rest.lon, rest.lat] },
  }))) };
  const endpoints = { type: "FeatureCollection" as const, features: (["origin", "destination"] as const).map((kind) => ({
    type: "Feature" as const, properties: { image: `endpoint-${kind}` },
    geometry: { type: "Point" as const, coordinates: [plan.inputs[kind].lon, plan.inputs[kind].lat] },
  })) };
  const summaries = { type: "FeatureCollection" as const, features: plan.routes.map((route) => {
    const geometry = geometries.get(route.id)!;
    return { type: "Feature" as const, properties: { route: route.id, status: !route.eligible ? "blocked" : plan.recommendation.route_id === route.id ? "recommended" : "plain", label: `${route.id} · ${duration(route.total_s)} · ${Math.round(route.risk.miles_by_level.severe)} Severe mi` },
      geometry: { type: "Point" as const, coordinates: pointAtDistance(geometry.points, geometry.prefix, geometry.prefix.at(-1)! / 2) } };
  }) };
  return { geometries, lines, checkpoints, rests, endpoints, summaries };
}

function MapView({ plan, heatmap, selected, checkpoint, selectionSource = "route-card", previewRoute = null, layoutKey = "", theme, phase, heatmapError }: Props) {
  const driving = Boolean(useDrive().session);
  const container = useRef<HTMLDivElement>(null), mapRef = useRef<Map | null>(null);
  const prepared = useMemo(() => plan ? prepareRoutes(plan) : null, [plan]);
  const latest = useRef({ plan, heatmap, selected, checkpoint, previewRoute, prepared });
  const trucks = useRef<{ marker: Marker; root: Root; motion: TruckMotion }[]>([]);
  const installedPlan = useRef<string | null>(null), installedHeatmap = useRef<PreparedHeatmap | null>(null);
  const lastHour = useRef(-1), palette = useRef<Colors>({}), benchmarked = useRef(false);
  const styleLoaded = useRef(false), styleTheme = useRef(theme);
  const cameraPlan = useRef(plan?.plan_id ?? "empty");
  const fittedPlan = useRef<string | null>(null), autoFramed = useRef(true);
  const savedCamera = useRef<Camera | null>(null);
  const lastSelected = useRef(selected), lastCheckpoint = useRef(checkpoint === null ? null : `${selected}:${checkpoint}`);
  const layoutObserver = useRef<ResizeObserver | null>(null);
  const legendButton = useRef<HTMLButtonElement>(null), legendPanel = useRef<HTMLDivElement>(null);
  const legendChip = useRef<HTMLButtonElement>(null), legendHour = useRef<HTMLSpanElement>(null);
  const popup = useRef<{ popup: Popup; root: Root; key: string; pinned: boolean } | null>(null);
  const pulse = useRef(0);
  const [ready, setReady] = useState(false), [mapError, setMapError] = useState(""), [legend, setLegend] = useState(false), [heatVisible, setHeatVisible] = useState(true);
  const heatVisibleRef = useRef(true), installRef = useRef<() => void>(() => {});
  const director = useRef<DriveController | null>(null), driveSession = useRef<DriveSession | null>(null);
  const driveAnnouncement = useRef<HTMLSpanElement>(null);
  const pendingFit = useRef(0), settledFit = useRef<string | null>(null);

  function syncDrive() {
    const state = drive.get(), map = mapRef.current;
    if (state.session === driveSession.current) return;
    const previous = director.current;
    director.current = null; driveSession.current = null;
    previous?.dispose(!state.summary);
    if (state.session && map && styleLoaded.current) {
      autoFramed.current = false; savedCamera.current = null; closePopup();
      driveSession.current = state.session;
      director.current = createDriveController(map, state.session, cameraPadding, text => { if (driveAnnouncement.current) driveAnnouncement.current.textContent = text; });
    }
    timeline.requestFrame();
  }

  function moveCamera(reason: Parameters<typeof programmaticCamera>[0], action: () => void) {
    // An explicit action during a style fetch takes precedence over its older snapshot.
    savedCamera.current = null;
    programmaticCamera(reason, action);
  }
  function clearTrucks() {
    trucks.current.forEach(({ marker, root }) => { marker.remove(); queueMicrotask(() => root.unmount()); });
    trucks.current = [];
  }
  function closePopup() {
    const current = popup.current;
    popup.current = null;
    if (current) { current.popup.remove(); queueMicrotask(() => current.root.unmount()); }
  }
  function showPopup(route: Route, cp: Checkpoint, pinned = false) {
    const map = mapRef.current, plan = latest.current.plan, key = `${route.id}:${cp.i}`;
    if (!map || !plan) return;
    if (popup.current?.key === key) { popup.current.pinned ||= pinned; return; }
    closePopup();
    const host = document.createElement("div"), root = createRoot(host);
    root.render(<CheckpointPopup content={buildCheckpointPopup(plan, route, cp)} />);
    const card = new Popup({ closeButton: false, closeOnClick: false, maxWidth: "260px", offset: 18, focusAfterOpen: false })
      .setLngLat([cp.lon, cp.lat]).setDOMContent(host).addTo(map);
    popup.current = { popup: card, root, key, pinned };
  }
  function checkpointAt(properties: Record<string, unknown> | undefined) {
    const route = latest.current.plan?.routes.find((r) => r.id === properties?.route);
    const cp = route?.checkpoints.find((c) => c.i === Number(properties?.i));
    return route && cp ? { route, cp } : null;
  }
  function paintSelection(map: Map) {
    if (!map.getLayer("route-selected")) return;
    const { selected, checkpoint, previewRoute } = latest.current;
    const isSelected: ExpressionSpecification = ["==", ["get", "route"], selected ?? ""];
    const isPreview: ExpressionSpecification = ["==", ["get", "route"], previewRoute ?? ""];
    const width = (selectedWidths: number[], alternativeWidths: number[], previewWidths: number[]): ExpressionSpecification => ["interpolate", ["linear"], ["zoom"], ...[4, 8, 12].flatMap((z, i) => [z, ["case", isSelected, selectedWidths[i], isPreview, previewWidths[i], alternativeWidths[i]]])] as ExpressionSpecification;
    map.setPaintProperty("route-casing", "line-width", width([8, 10, 12], [4.5, 5.5, 7], [6, 7.5, 9]));
    map.setPaintProperty("route-casing", "line-opacity", ["case", isSelected, .9, isPreview, .8, .6]);
    map.setLayoutProperty("route-casing", "line-sort-key", ["case", isSelected, 2, isPreview, 1, 0]);
    map.setFilter("route-selected", isSelected);
    map.setPaintProperty("route-selected", "line-width", width([4, 6, 8], [2.5, 3.5, 5], [3, 4.5, 6]));
    map.setFilter("route-alt", ["!=", ["get", "route"], selected ?? ""]);
    map.setPaintProperty("route-alt", "line-width", width([4, 6, 8], [2.5, 3.5, 5], [3, 4.5, 6]));
    map.setPaintProperty("route-alt", "line-color", ["case", isPreview, levelExpression(palette.current), palette.current["route-alt"]]);
    map.setPaintProperty("route-alt", "line-opacity", ["case", isPreview, .9, .85]);
    map.setLayoutProperty("route-alt", "line-sort-key", ["case", isPreview, 1, 0]);
    map.setFilter("route-severe-overlay", ["all", isSelected, ["==", ["get", "level"], 3]]);
    map.setFilter("route-no-travel-overlay", ["all", isSelected, ["==", ["get", "level"], 4]]);
    map.setFilter("checkpoint-markers", checkpointVisibility(selected));
    map.setFilter("checkpoint-dots", checkpointVisibility(selected, true));
    map.setFilter("checkpoint-hit", ["any", checkpointVisibility(selected), checkpointVisibility(selected, true)]);
    const picked = pickedCheckpointFilter(selected, checkpoint);
    map.setFilter("checkpoint-selected", picked); map.setFilter("checkpoint-label", picked);
    if (checkpoint === null || reducedMotion()) {
      pulse.current = 0;
      map.setPaintProperty("checkpoint-selected", "circle-radius", 16);
      map.setPaintProperty("checkpoint-selected", "circle-stroke-opacity", 1);
    }
    map.setFilter("checkpoint-eta", routeEtaFilter(selected, checkpoint));
    map.setLayoutProperty("route-summaries", "symbol-sort-key", ["case", isSelected, 0, isPreview, 1, 2]);
    map.setLayoutProperty("route-summaries", "icon-image", ["concat", "route-pill-", ["case", isSelected, "highlight-", "normal-"], ["get", "status"]]);
    map.setFilter("route-summaries", ["any", isSelected, [">=", ["zoom"], 4.5]]);
    map.setFilter("rest-labels", isSelected); map.setFilter("rest-markers", isSelected);
    for (const { marker } of trucks.current) marker.getElement().classList.toggle("truck-selected", marker.getElement().dataset.route === selected);
  }
  function cameraPadding() {
    const element = container.current;
    if (!element) return { top: 40, left: 32, right: 48, bottom: 24 };
    const rect = element.getBoundingClientRect();
    const workspace = element.closest(".workspace");
    const sheetElement = workspace?.querySelector(".left-panel");
    const sheet = sheetElement?.getBoundingClientRect();
    const overlap = sheet && getComputedStyle(sheetElement!).visibility !== "hidden" && sheet.left < rect.right && sheet.right > rect.left ? Math.max(0, rect.bottom - Math.max(rect.top, sheet.top)) : 0;
    const drawerElement = workspace?.querySelector(".checkpoint-panel");
    const drawer = drawerElement?.getBoundingClientRect();
    const rightOverlap = drawer && getComputedStyle(drawerElement!).visibility !== "hidden" && drawer.left > rect.left && drawer.left < rect.right && drawer.bottom > rect.top ? rect.right - drawer.left : 0;
    return { top: 40, left: 32, right: Math.max(48, rightOverlap + 24), bottom: Math.min(overlap + 24, Math.max(24, rect.height - 100)) };
  }
  function fitTrip(reason: "new-plan" | "fit-trip", duration = 500) {
    const map = mapRef.current, plan = latest.current.plan;
    if (!map || !container.current) return;
    const rect = container.current.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    // Cached plans can mount before the panel or canvas has its final dimensions.
    map.resize();
    if (reason === 'fit-trip' && drive.get().session) drive.follow(false);
    const bounds: [number, number, number, number] = plan ? tripBounds(plan) : [-124.8, 24.4, -66.9, 49.4];
    moveCamera(reason, () => map.fitBounds(bounds, { padding: cameraPadding(), duration: reducedMotion() ? 0 : duration, easing: easeOutCubic, maxZoom: 10, animate: !reducedMotion() }));
    fittedPlan.current = plan?.plan_id ?? "empty"; autoFramed.current = false;
  }
  function frameNewPlan() {
    const map = mapRef.current, key = latest.current.plan?.plan_id ?? "empty";
    if (!map || fittedPlan.current === key) return;
    const camera = planCameras.get(key);
    if (camera) {
      moveCamera("restore-camera", () => map.jumpTo(camera));
      fittedPlan.current = key; autoFramed.current = false;
    } else if (key === "empty" || !autoFramed.current) fittedPlan.current = key;
    else {
      const element = container.current, rect = element?.getBoundingClientRect();
      if (!element || !rect?.width || !rect.height) return;
      fitTrip("new-plan");
      const firstLayout = JSON.stringify([rect.width, rect.height, cameraPadding()]);
      // One final first-plan fit after React has committed the route panel and the
      // browser has its final map dimensions. Layout changes after this never refit.
      if (settledFit.current !== key && !pendingFit.current) pendingFit.current = requestAnimationFrame(() => {
        pendingFit.current = 0;
        if (cameraPlan.current !== key || settledFit.current === key || !autoFramed.current) return;
        const settled = element.getBoundingClientRect();
        if (firstLayout !== JSON.stringify([settled.width, settled.height, cameraPadding()])) fitTrip("new-plan");
        settledFit.current = key; autoFramed.current = false;
      });
      autoFramed.current = true;
    }
  }
  function fitsViewport(points: Coordinate[]) {
    const map = mapRef.current;
    if (!map || !container.current) return true;
    const rect = container.current.getBoundingClientRect(), padding = cameraPadding();
    return points.every((point) => { const p = map.project(point); return p.x >= padding.left && p.x <= rect.width - padding.right && p.y >= padding.top && p.y <= rect.height - padding.bottom; });
  }
  function updateFrame(hour: number, now: number) {
    const map = mapRef.current, { plan, heatmap, prepared } = latest.current;
    if (!map || !styleLoaded.current || !plan || !prepared) return false;
    const h = Math.max(0, Math.min((heatmap?.data.hours ?? 49) - 1, Math.floor(hour)));
    if (legendHour.current) legendHour.current.textContent = `+${h} h${hour >= h + 1 ? ' (last forecast)' : ''}`;
    if (h !== lastHour.current && map.getLayer("corridor-fill")) {
      map.setPaintProperty("corridor-fill", "fill-pattern", heatExpression(h));
      lastHour.current = h;
    }
    const base = heatmap?.data.base_utc ?? new Date(Math.floor(Date.parse(plan.inputs.departure_utc) / 3600000) * 3600000).toISOString();
    const elapsed = elapsedAtHour(base, plan.inputs.departure_utc, hour);
    let pending = false;
    if (pulse.current && map.getLayer("checkpoint-selected")) {
      const progress = reducedMotion() ? 1 : Math.max(0, Math.min(1, (now - pulse.current) / 600));
      map.setPaintProperty("checkpoint-selected", "circle-radius", 16 + 10 * Math.sin(progress * Math.PI));
      map.setPaintProperty("checkpoint-selected", "circle-stroke-opacity", 1 - .5 * Math.sin(progress * Math.PI));
      pending = progress < 1;
      if (!pending) pulse.current = 0;
    }
    trucks.current.forEach(({ marker, motion }, index) => {
      const route = plan.routes[index], target = truckPosition(prepared.geometries.get(route.id)!, elapsed);
      const state = drive.get(), active = state.session?.route.id === route.id;
      const result = smoothTruck(motion, target, hour, now, reducedMotion() || active);
      marker.setLngLat(result.position); pending ||= result.pending;
      marker.getElement().classList.toggle("drive-truck-hidden", Boolean(state.session && (!active || state.model)));
      marker.getElement().classList.toggle("drive-truck-fallback", Boolean(state.session && active && !state.model));
      marker.getElement().title = `Route ${route.id} · ${elapsed >= route.total_s ? "Arrived" : elapsed < 0 ? "Waiting for departure" : "Truck at selected time"}`;
    });
    pending = (director.current?.frame(hour, now) ?? false) || pending;
    return pending;
  }
  const install = () => {
    const map = mapRef.current, { plan, prepared, heatmap } = latest.current;
    if (!map || !styleLoaded.current) return;
    palette.current = colors();
    // Register all expression branches, including unselected pill variants, before any symbol layer.
    for (const id of MAP_SYMBOL_IDS) addSymbol(map, id);
    if (installedPlan.current !== (plan?.plan_id ?? null)) {
      for (const id of [...pointLayers, ...routeLayers]) if (map.getLayer(id)) map.removeLayer(id);
      for (const id of ["routes", "checkpoints", "rests", "endpoints", "summaries"]) if (map.getSource(id)) map.removeSource(id);
      clearTrucks(); closePopup();
    }
    if (plan && prepared && installedPlan.current !== plan.plan_id) {
      for (const [id, data] of [["routes", prepared.lines], ["checkpoints", prepared.checkpoints], ["rests", prepared.rests], ["endpoints", prepared.endpoints], ["summaries", prepared.summaries]] as const) map.addSource(id, { type: "geojson", data });
      map.addLayer({ id: "route-casing", type: "line", source: "routes", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": palette.current["map-casing"] } });
      map.addLayer({ id: "route-alt", type: "line", source: "routes", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": palette.current["route-alt"], "line-width": 3, "line-opacity": .85 } });
      map.addLayer({ id: "route-selected", type: "line", source: "routes", layout: { "line-cap": "butt", "line-join": "round", "line-sort-key": 2 }, paint: { "line-color": levelExpression(palette.current), "line-width": 6 } });
      for (const [id, width, dash] of [["route-severe-overlay", 2, [3, 2]], ["route-no-travel-overlay", 2.5, [1, 2]]] as const) map.addLayer({ id, type: "line", source: "routes", layout: { "line-cap": "butt", "line-join": "round" }, paint: { "line-color": palette.current["map-casing"], "line-width": width, "line-dasharray": [...dash] } });
      // MapLibre places symbol layers in reverse style order; checkpoints reserve space before rests.
      map.addLayer({ id: "rest-markers", type: "symbol", source: "rests", layout: { "icon-image": ["get", "image"], "icon-padding": 4, "icon-allow-overlap": false, "icon-ignore-placement": false, "symbol-sort-key": 6 } });
      map.addLayer({ id: "rest-labels", type: "symbol", source: "rests", minzoom: 6, layout: { "text-field": ["get", "label"], "text-font": ["Noto Sans Regular"], "text-size": 12, "text-offset": [0, 1.6], "symbol-sort-key": 6 }, paint: { "text-color": palette.current.text, "text-halo-color": palette.current.surface, "text-halo-width": 2 } });
      map.addLayer({ id: "checkpoint-dots", type: "circle", source: "checkpoints", filter: NO_CHECKPOINT, paint: { "circle-radius": ["match", ["get", "level"], 4, 3.5, 3, 3, 2, 2.5, 2], "circle-color": levelExpression(palette.current), "circle-opacity": .6, "circle-stroke-color": palette.current.surface, "circle-stroke-width": .75 } });
      map.addLayer({ id: "checkpoint-markers", type: "symbol", source: "checkpoints", filter: NO_CHECKPOINT, layout: { "icon-image": ["get", "image"], "icon-allow-overlap": false, "icon-ignore-placement": false, "icon-padding": 4, "symbol-sort-key": ["get", "priority"] } });
      map.addLayer({ id: "checkpoint-hit", type: "circle", source: "checkpoints", paint: { "circle-radius": 12, "circle-color": "#000000", "circle-opacity": 0 } });
      map.addLayer({ id: "checkpoint-selected", type: "circle", source: "checkpoints", filter: NO_CHECKPOINT, paint: { "circle-radius": 16, "circle-opacity": 0, "circle-stroke-color": palette.current.text, "circle-stroke-width": 2 } });
      for (const id of ["checkpoint-eta", "checkpoint-label"]) map.addLayer({ id, type: "symbol", source: "checkpoints", filter: NO_CHECKPOINT, minzoom: 7, layout: { "text-field": id === "checkpoint-eta" ? ["get", "label"] : ["concat", ["get", "placeLabel"], " · ", ["get", "label"]], "text-font": ["Noto Sans Regular"], "text-size": 12, "text-offset": [0, 2], "text-allow-overlap": false, "text-optional": true, "symbol-sort-key": ["get", "priority"], "text-padding": 8 }, paint: { "text-color": palette.current.text, "text-halo-color": palette.current.surface, "text-halo-width": 3 } });
      map.addLayer({ id: "route-summaries", type: "symbol", source: "summaries", layout: { "symbol-placement": "point", "text-field": ["get", "label"], "text-font": ["Noto Sans Regular"], "text-size": 12, "text-max-width": 40, "text-padding": 6, "text-allow-overlap": false, "text-ignore-placement": false, "icon-image": "route-pill-normal-plain", "icon-text-fit": "both", "icon-text-fit-padding": [4, 8, 4, 4], "icon-allow-overlap": false, "icon-ignore-placement": false, "icon-padding": 6, "symbol-sort-key": 2 }, paint: { "text-color": palette.current.text } });
      map.addLayer({ id: "endpoints", type: "symbol", source: "endpoints", layout: { "icon-image": ["get", "image"], "icon-allow-overlap": true, "icon-ignore-placement": true } });
      trucks.current = plan.routes.map((route) => {
        const element = document.createElement("button"); element.className = "truck-marker"; element.dataset.route = route.id;
        element.setAttribute("aria-label", `Select Route ${route.id} truck`);
        const root = createRoot(element);
        root.render(<><IconTruckFilled size={18} aria-hidden="true" /><span className="truck-route-badge">{route.id}</span></>);
        element.addEventListener("click", () => planner.selectRoute(route.id, "truck"));
        // A marker must have a position before addTo(), or MapLibre reads lngLat of undefined and the map crashes.
        const start = route.checkpoints[0];
        const marker = new Marker({ element }).setLngLat([start.lon, start.lat]).addTo(map);
        return { marker, root, motion: { pos: null, hour: timeline.get(), now: performance.now() } };
      });
      installedPlan.current = plan.plan_id;
    } else if (!plan) installedPlan.current = null;
    if (heatmap && installedHeatmap.current !== heatmap) {
      for (const id of ["corridor-fill"]) if (map.getLayer(id)) map.removeLayer(id);
      if (map.getSource("corridor")) map.removeSource("corridor");
      map.addSource("corridor", { type: "geojson", data: heatmap.geojson, promoteId: "id" });
      const style = getComputedStyle(document.documentElement);
      const heat = heatTokens((property) => style.getPropertyValue(property));
      const opacity = Number.parseFloat(style.getPropertyValue("--heat-opacity"));
      const multiplier = Number.isFinite(opacity) ? opacity : 1;
      ([0, 1, 2, 3, 4, 255] as TextureLevel[]).forEach((level) => {
        const id = level === 255 ? "heat-unknown" : `heat-${level}`;
        if (!map.hasImage(id)) map.addImage(id, severityTexture(heat[level], level, multiplier));
      });
      const before = map.getStyle().layers.find((layer) => layer.type === "symbol" || /road|highway|transportation|street|bridge|tunnel/i.test(`${layer.id} ${"source-layer" in layer ? layer["source-layer"] : ""}`))?.id ?? (map.getLayer("route-casing") ? "route-casing" : undefined);
      map.addLayer({ id: "corridor-fill", type: "fill", source: "corridor", layout: { visibility: heatVisibleRef.current ? "visible" : "none" }, paint: { "fill-antialias": false, "fill-pattern": heatExpression(Math.floor(timeline.get())), "fill-pattern-transition": { duration: reducedMotion() ? 0 : 150 } } }, before);
      installedHeatmap.current = heatmap; lastHour.current = -1;
      if (import.meta.env.DEV && !benchmarked.current) {
        const rounds = Math.min(8, heatmap.data.hours);
        map.setPaintProperty("corridor-fill", "fill-pattern", stateHeatExpression);
        const startState = performance.now();
        for (let h = 0; h < rounds; h++) heatmap.data.cells.forEach((cell, i) => map.setFeatureState({ source: "corridor", id: cell }, { lvl: heatmap.levels[h * heatmap.data.cells.length + i] }));
        const featureStateMs = (performance.now() - startState) / rounds, startPaint = performance.now();
        for (let h = 0; h < rounds; h++) map.setPaintProperty("corridor-fill", "fill-pattern", heatExpression(h));
        if (container.current) container.current.dataset.benchmark = JSON.stringify({ cells: heatmap.data.cells.length, featureStateMs, paintMs: (performance.now() - startPaint) / rounds, strategy: "single paint expression" });
        benchmarked.current = true;
      }
    } else if (!heatmap && installedHeatmap.current) {
      for (const id of ["corridor-fill"]) if (map.getLayer(id)) map.removeLayer(id);
      if (map.getSource("corridor")) map.removeSource("corridor"); installedHeatmap.current = null;
    }
    frameNewPlan();
    syncDrive(); director.current?.install();
    paintSelection(map);
    // The shared timeline performs the first write and any settling frames.
    timeline.requestFrame();
  };
  function addSymbol(map: Map, id: string) {
    if (map.hasImage(id)) return;
    if (/^heat-(?:[0-4]|unknown)$/.test(id)) {
      const level = (id === 'heat-unknown' ? 255 : Number(id.slice(5))) as TextureLevel;
      const style = getComputedStyle(document.documentElement), tokens = heatTokens(property => style.getPropertyValue(property));
      const opacity = Number.parseFloat(style.getPropertyValue('--heat-opacity'));
      map.addImage(id, severityTexture(tokens[level], level, Number.isFinite(opacity) ? opacity : 1));
      return;
    }
    const image = mapSymbolImage(id, palette.current);
    if (image) map.addImage(id, image, id.startsWith("route-pill-") ? pillImageOptions : { pixelRatio: 2 });
  }
  useLayoutEffect(() => {
    const key = plan?.plan_id ?? "empty";
    if (cameraPlan.current !== key) {
      if (drive.get().session) drive.end();
      if (pendingFit.current) { cancelAnimationFrame(pendingFit.current); pendingFit.current = 0; }
      if (mapRef.current) { mapRef.current.stop(); if (!autoFramed.current) rememberCamera(cameraPlan.current, mapRef.current); }
      cameraPlan.current = key; fittedPlan.current = null; autoFramed.current = true; savedCamera.current = null;
      lastSelected.current = selected;
      lastCheckpoint.current = checkpoint === null ? null : `${selected}:${checkpoint}`;
    }
    latest.current = { plan, heatmap, selected, checkpoint, previewRoute, prepared }; installRef.current = install;
    if (drive.get().session && drive.get().session?.route.id !== selected) drive.end();
  });

  useEffect(() => {
    if (!container.current) return;
    let map: Map;
    try { map = new Map({ container: container.current, style: `https://tiles.openfreemap.org/styles/${["04", "05"].includes(styleTheme.current) ? "dark" : "positron"}`, center: [-96.8, 39.9], zoom: 4.1, ...planCameras.get(cameraPlan.current), attributionControl: false, renderWorldCopies: false, maxZoom: 13, minZoom: 2, cooperativeGestures: false, scrollZoom: true }); }
    catch {
      // A failed WebGL constructor is an external-system error that must be visible.
      // eslint-disable-next-line react/set-state-in-effect
      setMapError("Map rendering is unavailable on this device. All route information is in the checkpoint list.");
      return;
    }
    mapRef.current = map;
    map.scrollZoom.enable();
    if (import.meta.env.DEV) (window as unknown as { __map?: unknown }).__map = map; // dev-only debugging handle
    map.addControl(new AttributionControl({ compact: true }), "bottom-left");
    map.on("styleimagemissing", (event) => {
      // MapLibre retries this request immediately when the handler returns.
      palette.current = colors();
      addSymbol(map, event.id);
    });
    map.on("style.load", () => {
      if (savedCamera.current) {
        const camera = savedCamera.current;
        moveCamera("restore-theme", () => map.jumpTo(camera));
      }
      styleLoaded.current = true; setMapError("");
      installedPlan.current = null; installedHeatmap.current = null; lastHour.current = -1;
      palette.current = colors();
      for (const layer of map.getStyle().layers) {
        if (layer.type === "background") map.setPaintProperty(layer.id, "background-color", palette.current.map);
        if (layer.type === "fill" && /water/i.test(layer.id)) map.setPaintProperty(layer.id, "fill-color", palette.current["map-line"]);
        if (layer.type === "symbol") {
          if (/poi|transit|housenumber|house.number|peak/i.test(layer.id)) map.setLayoutProperty(layer.id, "visibility", "none");
          else if (layer.layout?.["text-field"]) {
            map.setPaintProperty(layer.id, "text-color", palette.current["map-text"]);
            map.setPaintProperty(layer.id, "text-halo-color", palette.current.map);
            map.setPaintProperty(layer.id, "text-halo-width", 1.5);
          }
        }
      }
      installRef.current(); setReady(true);
    });
    map.on("error", (event) => { if (/fetch|network|load|AJAX/i.test(event.error?.message ?? "")) setMapError("Basemap connection interrupted. Routes and checkpoints remain available."); });
    map.on("moveend", () => {
      if (drive.get().session) return;
      // resize() can emit moveend before a zero-sized new plan gets its first fit.
      // That provisional view must not masquerade as a previously saved plan camera.
      if (!autoFramed.current) rememberCamera(cameraPlan.current, map);
    });
    for (const type of ["dragstart", "zoomstart", "rotatestart", "pitchstart"] as const) map.on(type, (event: { originalEvent?: Event }) => {
      if (event.originalEvent) { autoFramed.current = false; savedCamera.current = null; map.stop(); if (drive.get().session) drive.follow(false); }
    });
    map.on("click", (event) => {
      if (!map.getLayer("checkpoint-hit")) return;
      const pill = map.queryRenderedFeatures(event.point, { layers: ["route-summaries"] })[0];
      if (pill) { closePopup(); planner.selectRoute(String(pill.properties.route), "route-pill"); return; }
      const features = map.queryRenderedFeatures(event.point, { layers: ["checkpoint-hit"] });
      const cp = features.find((f) => f.properties?.route === latest.current.selected) ?? features[0];
      if (cp) {
        const point = checkpointAt(cp.properties);
        if (point) showPopup(point.route, point.cp, true);
        planner.selectCheckpoint(String(cp.properties.route), Number(cp.properties.i), "checkpoint-map");
      }
      else { closePopup(); const route = map.queryRenderedFeatures(event.point, { layers: ["route-selected", "route-alt"] })[0]; if (route) planner.selectRoute(String(route.properties.route), "map-line"); }
    });
    map.on("mousemove", (event) => {
      const layers = ["checkpoint-hit", "route-summaries", "route-selected", "route-alt"].filter((id) => !!map.getLayer(id));
      if (!layers.length) return;
      const features = map.queryRenderedFeatures(event.point, { layers });
      map.getCanvas().style.cursor = features.length ? "pointer" : "";
      const point = checkpointAt(features.find((f) => f.layer.id === "checkpoint-hit")?.properties);
      if (point) showPopup(point.route, point.cp);
      else if (popup.current && !popup.current.pinned) closePopup();
    });
    map.on("mouseout", () => { if (!popup.current?.pinned) closePopup(); });
    const observer = new ResizeObserver(() => {
      const rect = container.current?.getBoundingClientRect();
      if (!rect?.width || !rect.height) return;
      map.resize();
      if (!styleLoaded.current) return;
      // Only finish a new plan's deferred first fit, never refit because layout changed.
      frameNewPlan();
    });
    observer.observe(container.current);
    const workspace = container.current.closest(".workspace");
    if (workspace) observer.observe(workspace);
    for (const element of workspace?.querySelectorAll(".left-panel, .checkpoint-panel") ?? []) observer.observe(element);
    layoutObserver.current = observer;
    const unsubscribe = timeline.onFrame(updateFrame);
    const stopDrive = drive.subscribe(syncDrive);
    return () => { if (drive.get().session) drive.end(); director.current?.dispose(true); director.current = null; driveSession.current = null; stopDrive(); if (pendingFit.current) { cancelAnimationFrame(pendingFit.current); pendingFit.current = 0; } if (!autoFramed.current) rememberCamera(cameraPlan.current, map); unsubscribe(); observer.disconnect(); layoutObserver.current = null; closePopup(); clearTrucks(); map.remove(); mapRef.current = null; styleLoaded.current = false; fittedPlan.current = null; };
  }, []);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || styleTheme.current === theme) return;
    map.stop(); if (!drive.get().session && !autoFramed.current) rememberCamera(cameraPlan.current, map);
    savedCamera.current = planCameras.get(cameraPlan.current)!;
    if (drive.get().session) { const center = map.getCenter(); savedCamera.current = { center: [center.lng, center.lat], zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing() }; }
    styleLoaded.current = false; styleTheme.current = theme;
    map.setStyle(`https://tiles.openfreemap.org/styles/${["04", "05"].includes(theme) ? "dark" : "positron"}`, { diff: false });
  }, [theme]);
  useEffect(() => { if (ready) installRef.current(); }, [ready, prepared, heatmap]);
  useEffect(() => {
    if (!ready) return;
    const workspace = container.current?.closest(".workspace");
    for (const element of workspace?.querySelectorAll(".left-panel, .checkpoint-panel") ?? []) layoutObserver.current?.observe(element);
  }, [layoutKey, ready]);
  useEffect(() => { if (ready && mapRef.current) paintSelection(mapRef.current); }, [selected, checkpoint, previewRoute, ready]);
  useEffect(() => {
    if (!ready || !prepared || !plan || !mapRef.current) return;
    const map = mapRef.current, route = plan.routes.find((r) => r.id === selected);
    if (selected !== lastSelected.current && checkpoint === null && route && (selectionSource === "route-card" || selectionSource === "route-pill")) {
      const [west, south, east, north] = route.bbox;
      if (!fitsViewport([[west, south], [east, north]])) moveCamera(selectionSource, () => map.fitBounds(route.bbox, { padding: cameraPadding(), duration: reducedMotion() ? 0 : 400, easing: easeOutCubic, maxZoom: 10, animate: !reducedMotion() }));
    }
    lastSelected.current = selected;
    const cp = route?.checkpoints.find((cp) => cp.i === checkpoint), key = cp ? `${selected}:${cp.i}` : null;
    if (cp && key !== lastCheckpoint.current && route) {
      autoFramed.current = false;
      if (drive.get().session) drive.follow(false);
      const fromList = selectionSource === "checkpoint-list";
      if (fromList || !fitsViewport([[cp.lon, cp.lat]])) moveCamera(fromList ? "checkpoint-list" : "checkpoint-offscreen", () => map.flyTo({ center: [cp.lon, cp.lat], zoom: 8.5, padding: cameraPadding(), duration: reducedMotion() ? 0 : 800, easing: easeOutCubic, animate: !reducedMotion() }));
      pulse.current = reducedMotion() ? 0 : performance.now();
      timeline.requestFrame(); showPopup(route, cp, true);
    } else if (!cp) closePopup();
    lastCheckpoint.current = key;
  }, [checkpoint, selected, selectionSource, prepared, ready, plan]);
  useEffect(() => {
    if (!legend) return;
    const dismiss = (event: KeyboardEvent | PointerEvent) => {
      if (event.type === "keydown" && (event as KeyboardEvent).key !== "Escape") return;
      if (event.type === "pointerdown" && (legendPanel.current?.contains(event.target as Node) || legendButton.current?.contains(event.target as Node) || legendChip.current?.contains(event.target as Node))) return;
      setLegend(false); legendButton.current?.focus({ preventScroll: true });
    };
    document.addEventListener("keydown", dismiss); document.addEventListener("pointerdown", dismiss);
    return () => { document.removeEventListener("keydown", dismiss); document.removeEventListener("pointerdown", dismiss); };
  }, [legend]);
  function toggleHeat() {
    const visible = !heatVisibleRef.current; heatVisibleRef.current = visible; setHeatVisible(visible);
    for (const id of ["corridor-fill"]) if (mapRef.current?.getLayer(id)) mapRef.current.setLayoutProperty(id, "visibility", visible ? "visible" : "none");
  }
  function zoomBy(amount: number) { autoFramed.current = false; if (drive.get().session) drive.follow(false); const map = mapRef.current; if (map) moveCamera("zoom-control", () => map.easeTo({ zoom: map.getZoom() + amount, duration: reducedMotion() ? 0 : 200, easing: easeOutCubic, animate: !reducedMotion() })); }
  const corridorLegend = plan && <button ref={legendChip} type="button" className="corridor-legend-chip" aria-label="Corridor weather legend" aria-expanded={legend} aria-controls="map-legend" onClick={() => setLegend(!legend)}>
    <span>{driving ? "Legend ·" : `Corridor weather ${heatVisible ? "at" : "hidden ·"}`} <span className="num" ref={legendHour}>+{Math.floor(timeline.get())} h</span></span>
    {!driving && <HeatLegend className="corridor-legend-levels" />}
  </button>;
  return <section className="map-region" data-driving={driving} aria-label="Weather corridor map">
    <div className="map-canvas" ref={container} role="img" aria-label={plan ? "Routes, severity checkpoints, rests, corridor forecast and truck positions. The checkpoint list provides the same information as text." : "Map of the United States. Plan a trip to see routes and weather."} />
    <span className="sr-only" role="status" ref={driveAnnouncement} />
    {driving && <div className="map-preview-legend">{corridorLegend}</div>}
    <div className="map-bottom-dock">
    <DriveHud />
    {!driving && corridorLegend}
    </div>
    {plan && (phase === "heatmap" || heatmapError) && <div className="map-caption" role="status"><IconStack2 size={16} stroke={2} aria-hidden="true" /><span>{phase === "heatmap" ? "Building corridor heatmap…" : heatmap ? "Hourly corridor forecast" : "Corridor forecast unavailable"}</span>{phase === "heatmap" && <span className="spinner" />}</div>}
    {mapError && <div className="map-error" role="status">{mapError}</div>}
    <div className="map-tools" aria-label="Map controls">
      <div className="map-zoom-group"><button type="button" className="map-tool map-control" aria-label="Zoom in" title="Zoom in" onClick={() => zoomBy(1)}><IconPlus size={20} stroke={1.75} aria-hidden="true" /></button><button type="button" className="map-tool map-control" aria-label="Zoom out" title="Zoom out" onClick={() => zoomBy(-1)}><IconMinus size={20} stroke={1.75} aria-hidden="true" /></button></div>
      <button type="button" className="map-tool map-control fit-button" aria-label="Fit trip" title="Fit trip to view" onClick={() => fitTrip("fit-trip")}><IconZoomScan size={20} stroke={1.75} aria-hidden="true" /></button>
      <button type="button" ref={legendButton} className="map-tool map-control" aria-label="Legend" title="Weather risk legend" aria-expanded={legend} aria-controls="map-legend" onClick={() => setLegend(!legend)}><IconInfoCircle size={20} stroke={1.75} aria-hidden="true" /></button>
      {heatmap && <button type="button" className="map-tool map-control map-layer-toggle" aria-label="Weather corridor" title="Show weather corridor" aria-pressed={heatVisible} onClick={toggleHeat}><IconStack2 size={20} stroke={1.75} aria-hidden="true" /></button>}
    </div>
    {legend && <div id="map-legend" className="map-legend" ref={legendPanel} role="region" aria-label="Weather risk legend">
      <div className="map-legend-header"><h2>Weather risk</h2><button type="button" className="icon-button" aria-label="Close legend" title="Close legend" onClick={() => { setLegend(false); legendButton.current?.focus(); }}><IconX size={20} stroke={1.75} aria-hidden="true" /></button></div>
      <HeatLegend className="map-legend-grid" />
      <div className="map-legend-key"><span><i className="map-line-key selected" aria-hidden="true" />Selected route</span><span><i className="map-line-key alternative" aria-hidden="true" />Other routes</span><span><IconCoffee size={16} stroke={2} aria-hidden="true" />Rest</span><span><IconTruckFilled size={16} aria-hidden="true" />Truck</span></div>
      <p>Corridor: selected forecast hour. Routes and checkpoints: weather at arrival. Unknown data is never assumed Low.</p>
    </div>}
  </section>;
}
export default memo(MapView);
