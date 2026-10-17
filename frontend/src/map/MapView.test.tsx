import { Profiler, StrictMode } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeMockPlan, makeMockHeatmap, demoPlaces } from "../api/mock";
import { prepareHeatmap } from "../lib/heatmap";
import { timeline } from "../state/timeline";
import { drive } from "../drive/state";
import * as truckLoader from "../drive/loadTruck";
import { featureFilter, createPropertyExpression, latest, validateStyleMin } from "@maplibre/maplibre-gl-style-spec";
import type { StylePropertySpecification, StyleSpecification } from "@maplibre/maplibre-gl-style-spec";
import { mapSymbolImage, pillImageOptions, MAP_SYMBOL_IDS } from "./symbols";
import { planCameras } from "./camera";
import { planner } from "../state/planner";
import { usePlanner } from "../state/planner";
import { CheckpointPanel } from "../components/CheckpointPanel";
const fake = vi.hoisted(() => ({ maps: [] as any[], markers: [] as any[], popups: [] as any[], resizes: [] as (() => void)[] }));
vi.mock("./symbols", async (original) => ({ ...await original<typeof import("./symbols")>(), mapSymbolImage: vi.fn(() => ({ width: 2, height: 2, data: new Uint8Array(16) })) }));
vi.mock("maplibre-gl", () => ({
  setWorkerUrl: vi.fn(),
  NavigationControl: class {},
  AttributionControl: class {},
  Popup: class {
    host: HTMLElement | null = null;
    constructor() { fake.popups.push(this); }
    setLngLat = vi.fn(() => this);
    setDOMContent(host: HTMLElement) { this.host = host; return this; }
    addTo() { if (this.host) document.body.append(this.host); return this; }
    remove() { this.host?.remove(); }
  },
  Map: class {
    layers = new globalThis.Map();
    sources = new globalThis.Map();
    images = new Set();
    handlers = new globalThis.Map();
    scrollZoom = { enable: vi.fn(), isEnabled: () => true };
    options: unknown;
    constructor(options: unknown) {
      this.options = options;
      fake.maps.push(this);
    }
    on(event: string, callback: (event?: unknown) => void) {
      this.handlers.set(event, callback);
    }
    getStyle() {
      return { layers: [{ id: "road-primary", type: "line", "source-layer": "transportation" }, { id: "poi", type: "symbol", layout: { "text-field": "POI" } }, { id: "state-label", type: "symbol", layout: { "text-field": "State" } }] };
    }
    getLayer(id: string) {
      return this.layers.get(id);
    }
    getSource(id: string) {
      return this.sources.get(id);
    }
    addSource = vi.fn((id, data) => {
      this.sources.set(id, data);
    });
    addLayer = vi.fn((layer) => {
      this.layers.set(layer.id, layer);
    });
    removeSource = vi.fn((id) => {
      this.sources.delete(id);
    });
    removeLayer = vi.fn((id) => {
      this.layers.delete(id);
    });
    hasImage(id: string) {
      return this.images.has(id);
    }
    addImage = vi.fn((id: string, _image: unknown, _options: unknown) => {
      this.images.add(id);
    });
    setPaintProperty = vi.fn((id, key, value) => { const layer = this.layers.get(id); if (layer) (layer.paint ??= {})[key] = value; });
    setFeatureState = vi.fn();
    setLayoutProperty = vi.fn((id, key, value) => { const layer = this.layers.get(id); if (layer) (layer.layout ??= {})[key] = value; });
    setFilter = vi.fn((id, filter) => { const layer = this.layers.get(id); if (layer) layer.filter = filter; });
    fitBounds = vi.fn();
    stop = vi.fn();
    getCenter = () => ({ lng: -98, lat: 37 });
    getZoom = () => 6;
    getBearing = () => 12;
    getPitch = () => 20;
    jumpTo = vi.fn();
    setStyle = vi.fn(() => { this.layers.clear(); this.sources.clear(); this.images.clear(); });
    easeTo = vi.fn();
    flyTo = vi.fn();
    project = () => ({ x: 450, y: 300 });
    getCanvas = () => ({ style: { cursor: "" } });
    getContainer = () => ({ clientHeight: 600, dataset: {} });
    isStyleLoaded = () => true;
    triggerRepaint = vi.fn();
    queryRenderedFeatures = vi.fn(() => []);
    addControl() {}
    resize = vi.fn();
    remove = vi.fn();
  },
  Marker: class {
    element: HTMLElement;
    position: unknown;
    constructor(options: { element: HTMLElement }) {
      this.element = options.element;
      fake.markers.push(this);
    }
    getElement() {
      return this.element;
    }
    setLngLat = vi.fn((position: unknown) => {
      this.position = position;
      return this;
    });
    addTo() {
      return this;
    }
    remove = vi.fn();
  },
}));
import MapView from "./MapView";
beforeEach(() => {
  planCameras.clear();
  localStorage.removeItem("spotter.debug.camera");
  fake.maps.length = 0;
  fake.markers.length = 0;
  fake.popups.length = 0;
  fake.resizes.length = 0;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) { fake.resizes.push(callback); }
      observe() {}
      disconnect() {}
    },
  );
  for (const [key, value] of Object.entries({
    low: "#8DDBB3",
    moderate: "#ECD083",
    high: "#FFB788",
    severe: "#FFA6B4",
    stop: "#D1B6FF", border: "#688387",
    unknown: "#A6BDC1",
    map: "#142F32", "map-line": "#243F42", "map-text": "#A6BDC1", surface: "#183A3D", surface2: "#204246", text: "#DDEEEE", muted: "#A6BDC1", "route-alt": "#63797f", "map-casing": "#102729",
  }))
    document.documentElement.style.setProperty(`--${key}`, value);
});
describe("map timeline lifecycle", () => {
  it("recreates the truck layer through Play, Escape, a different route and Play, including a busy style and theme swap", async () => {
    const renderers = [0, 1].map(() => ({ layer: { id: 'drive-truck', type: 'custom' as const, render: vi.fn() }, set: vi.fn(), dispose: vi.fn() }));
    const load = vi.spyOn(truckLoader, 'loadTruck').mockResolvedValueOnce(renderers[0]).mockResolvedValueOnce(renderers[1]);
    const plan = makeMockPlan({ origin: demoPlaces[0], destination: demoPlaces[1], departure_local: '2026-10-16T06:00', cargo_lb: 42000, spacing_mi: 25, wind_measure: 'gust', rest: { mode: 'auto' } });
    const props = { plan, heatmap: null, selected: 'B', checkpoint: null, theme: '04', phase: 'idle', heatmapError: null };
    const { rerender } = render(<MapView {...props} />), map = fake.maps[0];
    map.isStyleLoaded = () => false;
    await act(() => map.handlers.get('style.load')());
    await act(async () => drive.start(plan, plan.routes[1]));
    expect(map.getLayer('drive-truck')).toBe(renderers[0].layer);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(map.getLayer('drive-truck')).toBeUndefined(); expect(renderers[0].dispose).toHaveBeenCalledOnce();
    rerender(<MapView {...props} selected="A" />);
    await act(async () => drive.start(plan, plan.routes[0]));
    expect(map.getLayer('drive-truck')).toBe(renderers[1].layer); expect(drive.get().model).toBe(true);
    rerender(<MapView {...props} selected="A" theme="02" />);
    await act(() => map.handlers.get('style.load')());
    expect(map.getLayer('drive-truck')).toBe(renderers[1].layer); expect(load).toHaveBeenCalledTimes(2);
    act(() => drive.end()); expect(renderers[1].dispose).toHaveBeenCalledOnce();
  });
  it("detaches drive following so checkpoint navigation can keep its requested camera", async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 404 }));
    const plan = makeMockPlan({ origin: demoPlaces[0], destination: demoPlaces[1], departure_local: '2026-10-16T06:00', cargo_lb: 42000, spacing_mi: 25, wind_measure: 'gust', rest: { mode: 'auto' } });
    const props = { plan, heatmap: null, selected: 'B', checkpoint: null, theme: '04', phase: 'idle', heatmapError: null };
    const { rerender } = render(<MapView {...props} />), map = fake.maps[0];
    await act(() => map.handlers.get('style.load')()); act(() => drive.start(plan, plan.routes[1]));
    rerender(<MapView {...props} checkpoint={2} selectionSource="checkpoint-list" />);
    const cp = plan.routes[1].checkpoints[2];
    expect(drive.get().follow).toBe(false);
    expect(map.flyTo).toHaveBeenLastCalledWith(expect.objectContaining({ center: [cp.lon, cp.lat], zoom: 8.5 }));
    act(() => drive.end());
  });

  it("holds the intro at the origin and uses the truck badge when both model paths are missing", async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 404 }));
    const plan = makeMockPlan({ origin: demoPlaces[0], destination: demoPlaces[1], departure_local: '2026-10-16T06:00', cargo_lb: 42000, spacing_mi: 25, wind_measure: 'gust', rest: { mode: 'auto' } });
    render(<MapView plan={plan} heatmap={null} selected="B" checkpoint={null} theme="04" phase="idle" heatmapError={null} />);
    const map = fake.maps[0]; await act(() => map.handlers.get('style.load')());
    act(() => drive.start(plan, plan.routes[1]));
    await act(() => new Promise(resolve => requestAnimationFrame(resolve)));
    expect(drive.get().phase).toBe('intro'); expect(timeline.get()).toBe(0);
    expect(fake.markers.find(marker => marker.element.dataset.route === 'B').element).toHaveClass('drive-truck-fallback');
    expect(map.getLayer('drive-truck')).toBeUndefined();
    fireEvent.click(screen.getByRole('button', { name: 'Close drive preview' }));
    expect(drive.get().session).toBeNull(); expect(map.jumpTo).toHaveBeenLastCalledWith({ center: [-98, 37], zoom: 6, bearing: 12, pitch: 20 });
  });

  it("finishes the first fit after panel layout changes and includes endpoints outside route bboxes", async () => {
    const box = (width: number) => ({ x: 0, y: 0, left: 0, top: 0, right: width, bottom: 600, width, height: 600, toJSON() {} });
    const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(box(900));
    const plan = makeMockPlan({ origin: demoPlaces[0], destination: demoPlaces[1], departure_local: '2026-10-16T06:00', cargo_lb: 42000, spacing_mi: 25, wind_measure: 'gust', rest: { mode: 'auto' } });
    plan.inputs.destination = { label: 'Outside the provider bbox', lon: -120, lat: 48 };
    render(<MapView plan={plan} heatmap={null} selected="B" checkpoint={null} theme="04" phase="idle" heatmapError={null} />);
    const map = fake.maps[0];
    await act(async () => { map.handlers.get('style.load')(); rect.mockReturnValue(box(700)); await new Promise(resolve => requestAnimationFrame(resolve)); });
    expect(map.fitBounds).toHaveBeenCalledTimes(2);
    expect(map.fitBounds.mock.lastCall[0][0]).toBe(-120); expect(map.fitBounds.mock.lastCall[0][3]).toBe(48);
    act(() => fake.resizes[0]()); expect(map.fitBounds).toHaveBeenCalledTimes(2);
  });

  it("restores a remembered camera on remount with a selected checkpoint and never fits it", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 900, bottom: 600, width: 900, height: 600, toJSON() {} });
    const plan = makeMockPlan({ origin: demoPlaces[0], destination: demoPlaces[1], departure_local: "2026-10-16T06:00", cargo_lb: 42000, spacing_mi: 25, wind_measure: "gust", rest: { mode: "auto" } });
    const props = { plan, heatmap: null, selected: "B", checkpoint: 2, selectionSource: "checkpoint-list" as const, theme: "04", phase: "idle", heatmapError: null };
    const first = render(<MapView {...props} />), map = fake.maps[0];
    await act(() => map.handlers.get("style.load")());
    map.getCenter = () => ({ lng: -101.2, lat: 40.4 });
    map.getZoom = () => 8.25; map.getBearing = () => 42; map.getPitch = () => 35;
    act(() => map.handlers.get("moveend")());
    first.unmount();
    render(<MapView {...props} theme="02" />);
    const remounted = fake.maps[1];
    await act(() => remounted.handlers.get("style.load")());
    expect(remounted.jumpTo).toHaveBeenCalledExactlyOnceWith({ center: [-101.2, 40.4], zoom: 8.25, bearing: 42, pitch: 35 });
    act(() => fake.resizes[1]());
    expect(remounted.fitBounds).not.toHaveBeenCalled();
    expect(remounted.flyTo).not.toHaveBeenCalled();
    expect(remounted.easeTo).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it("cancels deferred new-plan framing on a user gesture, then allows an explicit Fit trip and a new plan", async () => {
    const rect = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON() {} });
    const plan = makeMockPlan({ origin: demoPlaces[0], destination: demoPlaces[1], departure_local: "2026-10-16T06:00", cargo_lb: 42000, spacing_mi: 25, wind_measure: "gust", rest: { mode: "auto" } });
    const props = { plan, heatmap: null, selected: "B", checkpoint: null, theme: "04", phase: "idle", heatmapError: null };
    const { rerender } = render(<MapView {...props} />), map = fake.maps[0];
    await act(() => map.handlers.get("style.load")());
    expect(map.fitBounds).not.toHaveBeenCalled();
    act(() => map.handlers.get("dragstart")({ originalEvent: new Event("mousedown") }));
    rect.mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 900, bottom: 600, width: 900, height: 600, toJSON() {} });
    act(() => fake.resizes[0]());
    rerender(<MapView {...props} layoutKey="full:true" />);
    expect(map.fitBounds).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Fit trip" }));
    expect(map.fitBounds).toHaveBeenCalledOnce();
    rerender(<MapView {...props} plan={{ ...plan, plan_id: "after-user-gesture" }} />);
    expect(map.fitBounds).toHaveBeenCalledTimes(2);
    vi.restoreAllMocks();
  });

  it("finishes a deferred first fit once when resize emits moveend before the plan is framed", async () => {
    const rect = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON() {} });
    const plan = makeMockPlan({ origin: demoPlaces[0], destination: demoPlaces[1], departure_local: "2026-10-16T06:00", cargo_lb: 42000, spacing_mi: 25, wind_measure: "gust", rest: { mode: "auto" } });
    render(<MapView plan={plan} heatmap={null} selected="B" checkpoint={null} theme="04" phase="idle" heatmapError={null} />);
    const map = fake.maps[0];
    await act(() => map.handlers.get("style.load")());
    map.resize.mockImplementation(() => map.handlers.get("moveend")());
    rect.mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 900, bottom: 600, width: 900, height: 600, toJSON() {} });
    act(() => fake.resizes[0]());
    expect(map.fitBounds).toHaveBeenCalledOnce();
    expect(map.jumpTo).not.toHaveBeenCalled();
    act(() => fake.resizes[0]());
    expect(map.fitBounds).toHaveBeenCalledOnce();
    vi.restoreAllMocks();
  });

  it("fits different routes only from cards or pills; map lines, trucks and visible checkpoint taps preserve the view", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 900, bottom: 600, width: 900, height: 600, toJSON() {} });
    const plan = makeMockPlan({ origin: demoPlaces[0], destination: demoPlaces[1], departure_local: "2026-10-16T06:00", cargo_lb: 42000, spacing_mi: 25, wind_measure: "gust", rest: { mode: "auto" } });
    act(() => planner.selectRoute("B"));
    function Harness() {
      const state = usePlanner();
      return <MapView plan={plan} heatmap={null} selected={state.selectedRoute} checkpoint={state.checkpoint} selectionSource={state.selectionSource} theme="04" phase="idle" heatmapError={null} />;
    }
    render(<Harness />);
    const map = fake.maps[0];
    map.project = () => ({ x: -100, y: -100 });
    await act(() => map.handlers.get("style.load")());
    map.fitBounds.mockClear(); map.flyTo.mockClear();
    map.queryRenderedFeatures.mockImplementation((_: unknown, options: { layers: string[] }) => options.layers.includes("route-alt") ? [{ properties: { route: "A" } }] : []);
    act(() => map.handlers.get("click")({ point: { x: 0, y: 0 } }));
    expect(planner.get()).toMatchObject({ selectedRoute: "A", selectionSource: "map-line" });
    expect(map.fitBounds).not.toHaveBeenCalled();
    expect(map.flyTo).not.toHaveBeenCalled();
    expect(map.easeTo).not.toHaveBeenCalled();
    map.queryRenderedFeatures.mockReturnValue([{ properties: { route: "C" } }]);
    act(() => map.handlers.get("click")({ point: { x: 0, y: 0 } }));
    expect(map.fitBounds).toHaveBeenLastCalledWith(plan.routes[2].bbox, expect.anything());
    act(() => planner.selectRoute("A"));
    expect(map.fitBounds).toHaveBeenCalledTimes(2);
    fireEvent.click(fake.markers.find(marker => marker.element.dataset.route === "B").element);
    expect(map.fitBounds).toHaveBeenCalledTimes(2);
    map.project = () => ({ x: 450, y: 300 });
    map.queryRenderedFeatures.mockImplementation((_: unknown, options: { layers: string[] }) => options.layers[0] === "checkpoint-hit" ? [{ properties: { route: "B", i: 1 } }] : []);
    await act(() => map.handlers.get("click")({ point: { x: 0, y: 0 } }));
    expect(map.flyTo).not.toHaveBeenCalled();
    map.project = () => ({ x: -100, y: -100 });
    act(() => planner.selectCheckpoint("B", 2, "checkpoint-map"));
    expect(map.flyTo).toHaveBeenCalledOnce();
    expect(map.fitBounds).toHaveBeenCalledTimes(2);
    vi.restoreAllMocks();
  });

  it("logs programmatic camera reasons only when the development switch is enabled", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 900, bottom: 600, width: 900, height: 600, toJSON() {} });
    render(<MapView plan={null} heatmap={null} selected={null} checkpoint={null} theme="04" phase="idle" heatmapError={null} />);
    await act(() => fake.maps[0].handlers.get("style.load")());
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(log).not.toHaveBeenCalled();
    localStorage.setItem("spotter.debug.camera", "1");
    fireEvent.click(screen.getByRole("button", { name: "Fit trip" }));
    fireEvent.click(screen.getByRole("button", { name: "Zoom out" }));
    expect(log.mock.calls).toEqual([["[spotter.camera] fit-trip"], ["[spotter.camera] zoom-control"]]);
    vi.restoreAllMocks();
  });

  it("never restores a stale theme camera over a newer zoom action or user gesture", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 900, bottom: 600, width: 900, height: 600, toJSON() {} });
    const plan = makeMockPlan({ origin: demoPlaces[0], destination: demoPlaces[1], departure_local: "2026-10-16T06:00", cargo_lb: 42000, spacing_mi: 25, wind_measure: "gust", rest: { mode: "auto" } });
    const props = { plan, heatmap: null, selected: "B", checkpoint: null, theme: "04", phase: "idle", heatmapError: null };
    const { rerender } = render(<MapView {...props} />), map = fake.maps[0];
    await act(() => map.handlers.get("style.load")());
    rerender(<MapView {...props} theme="02" />);
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    await act(() => map.handlers.get("style.load")());
    expect(map.easeTo).toHaveBeenCalledOnce();
    expect(map.jumpTo).not.toHaveBeenCalled();
    rerender(<MapView {...props} theme="04" />);
    act(() => map.handlers.get("dragstart")({ originalEvent: new Event("mousedown") }));
    await act(() => map.handlers.get("style.load")());
    expect(map.jumpTo).not.toHaveBeenCalled();
    expect(map.fitBounds).toHaveBeenCalledOnce();
    vi.restoreAllMocks();
  });

  it("validates the complete overlay style and keeps selected-only filters after preview, clear and theme reload", async () => {
    const plan = makeMockPlan({ origin: demoPlaces[0], destination: demoPlaces[1], departure_local: "2026-10-16T06:00", cargo_lb: 42000, spacing_mi: 25, wind_measure: "gust", rest: { mode: "auto" } });
    const props = { plan, heatmap: prepareHeatmap(makeMockHeatmap(plan)), selected: "B", checkpoint: null as number | null, theme: "04", phase: "idle", heatmapError: null };
    const { rerender } = render(<MapView {...props} />), map = fake.maps[0];
    await act(() => map.handlers.get("style.load")());
    for (const [selected, checkpoint, previewRoute, theme] of [["B", null, null, "04"], ["A", 0, "C", "04"], [null, null, null, "04"], ["B", 2, null, "02"], ["C", null, "A", "02"]] as const) {
      rerender(<MapView {...props} selected={selected} checkpoint={checkpoint} previewRoute={previewRoute} theme={theme} />);
      if (!map.getLayer("route-selected")) await act(() => map.handlers.get("style.load")());
      const style: StyleSpecification = { version: 8, sources: Object.fromEntries(map.sources), glyphs: "https://example.com/{fontstack}/{range}.pbf", layers: Array.from(map.layers.values()) as StyleSpecification["layers"] };
      expect(validateStyleMin(style).map(e => e.message)).toEqual([]);
      for (const id of ["checkpoint-selected", "checkpoint-label"]) {
        const filter = featureFilter(map.getLayer(id).filter, `${id}.filter`).filter;
        const matches = map.getSource("checkpoints").data.features.filter((cp: any) => filter({ zoom: 8 }, { type: "Point", properties: cp.properties }));
        expect(matches).toHaveLength(checkpoint === null ? 0 : 1);
      }
      expect(map.getLayer("checkpoint-eta")).toMatchObject({ minzoom: 7, layout: { "text-allow-overlap": false, "text-optional": true } });
    }
  });
  it("flies from a checkpoint list click or Enter and drawer navigation, pulses one marker, and keeps wheel defaults enabled", async () => {
    const plan = makeMockPlan({ origin: demoPlaces[0], destination: demoPlaces[1], departure_local: "2026-10-16T06:00", cargo_lb: 42000, spacing_mi: 25, wind_measure: "gust", rest: { mode: "auto" } });
    act(() => planner.selectCheckpoint("B", null));
    function Harness() {
      const state = usePlanner();
      const route = plan.routes.find(r => r.id === state.selectedRoute) ?? plan.routes[1];
      return <><MapView plan={plan} heatmap={null} selected={route.id} checkpoint={state.checkpoint} selectionSource={state.selectionSource} theme="04" phase="idle" heatmapError={null} /><CheckpointPanel plan={plan} route={route} index={state.checkpoint} onClose={() => planner.selectCheckpoint(route.id, null)} onList={() => planner.selectCheckpoint(route.id, null)} /></>;
    }
    render(<Harness />);
    const map = fake.maps[0], cp = plan.routes[1].checkpoints[1];
    await act(() => map.handlers.get("style.load")());
    expect(map.options).toMatchObject({ cooperativeGestures: false, scrollZoom: true });
    expect(map.scrollZoom.enable).toHaveBeenCalledOnce();
    fireEvent.click(screen.getAllByRole("button", { name: /^Checkpoint B-/ })[1]);
    expect(map.flyTo).toHaveBeenLastCalledWith(expect.objectContaining({ center: [cp.lon, cp.lat], zoom: 8.5, duration: 800, animate: true }));
    expect(screen.getByRole("complementary", { name: `Checkpoint B-${cp.i} detail` })).toBeInTheDocument();
    expect(fake.popups.at(-1).host).toHaveTextContent("Route B");
    await act(() => new Promise(requestAnimationFrame));
    expect(map.setPaintProperty).toHaveBeenCalledWith("checkpoint-selected", "circle-radius", expect.any(Number));
    fireEvent.click(screen.getByRole("button", { name: /Next checkpoint, mile/ }));
    expect(map.flyTo).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole("button", { name: /Previous checkpoint, mile/ }));
    expect(map.flyTo).toHaveBeenCalledTimes(3);
    fireEvent.click(screen.getByRole("button", { name: "All checkpoints" }));
    const previousMedia = window.matchMedia;
    window.matchMedia = query => ({ ...previousMedia(query), matches: query === "(prefers-reduced-motion: reduce)" });
    try {
      fireEvent.keyDown(screen.getAllByRole("button", { name: /^Checkpoint B-/ })[1], { key: "Enter" });
      expect(map.flyTo).toHaveBeenLastCalledWith(expect.objectContaining({ center: [cp.lon, cp.lat], duration: 0, animate: false }));
    } finally { window.matchMedia = previousMedia; }
  });
  it("opens alternative checkpoint popups on hover/tap and selects clickable summary pills", async () => {
    const plan = makeMockPlan({ origin: demoPlaces[0], destination: demoPlaces[1], departure_local: "2026-10-16T06:00", cargo_lb: 42000, spacing_mi: 25, wind_measure: "gust", rest: { mode: "auto" } });
    render(<MapView plan={plan} heatmap={null} selected="B" checkpoint={null} theme="04" phase="idle" heatmapError={null} />);
    const map = fake.maps[0], cp = plan.routes[0].checkpoints[1];
    await act(() => map.handlers.get("style.load")());
    expect(map.getSource("summaries").data.features).toHaveLength(3);
    expect(map.getLayer("route-summaries").layout).toMatchObject({ "text-allow-overlap": false, "icon-allow-overlap": false, "icon-text-fit": "both" });
    expect(map.getLayer("route-summaries").layout).toMatchObject({ "symbol-placement": "point", "text-max-width": 40, "icon-ignore-placement": false, "text-ignore-placement": false });
    expect(map.getSource("summaries").data.features[1].properties.label).toMatch(/^B · \d+h \d+m · \d+ Severe mi$/);
    expect(map.getSource("summaries").data.features.map((f: any) => f.properties.status)).toEqual(["plain", "recommended", "blocked"]);
    const pillGate = featureFilter(map.getLayer("route-summaries").filter, "route-summaries.filter").filter;
    expect(pillGate({ zoom: 4 }, { type: "Point", properties: { route: "B" } })).toBe(true);
    expect(pillGate({ zoom: 4 }, { type: "Point", properties: { route: "A" } })).toBe(false);
    expect(pillGate({ zoom: 4.5 }, { type: "Point", properties: { route: "A" } })).toBe(true);
    await act(() => map.handlers.get("styleimagemissing")({ id: "route-pill-highlight-recommended" }));
    expect(map.addImage).toHaveBeenCalledWith("route-pill-highlight-recommended", expect.anything(), pillImageOptions);
    expect(map.getLayer("checkpoint-eta").layout["text-field"]).toEqual(["get", "label"]);
    map.queryRenderedFeatures.mockReturnValue([{ layer: { id: "checkpoint-hit" }, properties: { route: "A", i: cp.i } }]);
    await act(() => map.handlers.get("mousemove")({ point: { x: 0, y: 0 } }));
    expect(fake.popups.at(-1).host).toHaveTextContent(`Route A · Mile ${Math.round(cp.mi)}`);
    expect(fake.popups.at(-1).host).toHaveTextContent(cp.place_label!);
    const select = vi.spyOn(planner, "selectRoute");
    map.queryRenderedFeatures.mockReturnValue([{ layer: { id: "route-summaries" }, properties: { route: "C" } }]);
    act(() => map.handlers.get("click")({ point: { x: 0, y: 0 } }));
    expect(select).toHaveBeenCalledWith("C", "route-pill"); select.mockRestore();
    map.queryRenderedFeatures.mockImplementation((_: unknown, options: { layers: string[] }) => options.layers[0] === "checkpoint-hit" ? [{ layer: { id: "checkpoint-hit" }, properties: { route: "A", i: cp.i } }] : []);
    const selectCp = vi.spyOn(planner, "selectCheckpoint");
    await act(() => map.handlers.get("click")({ point: { x: 0, y: 0 } }));
    expect(selectCp).toHaveBeenCalledWith("A", cp.i, "checkpoint-map"); selectCp.mockRestore();
    expect(fake.popups.at(-1).host).toHaveTextContent(cp.place_label!);
  });
  it("keeps the empty map camera until Fit trip, using sheet padding and reduced motion", async () => {
    const previousMedia = window.matchMedia;
    window.matchMedia = (query) => ({ ...previousMedia(query), matches: true });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      const top = this.classList.contains("left-panel") ? 280 : 0;
      return { x: 0, y: top, left: 0, top, right: 900, bottom: 600, width: 900, height: 600 - top, toJSON() {} };
    });
    try {
      render(<div className="workspace">
        <MapView plan={null} heatmap={null} selected={null} checkpoint={null} theme="02" phase="idle" heatmapError={null} />
        <aside className="left-panel"><div className="forecast-clock" /></aside>
      </div>);
      const map = fake.maps[0];
      await act(() => map.handlers.get("style.load")());
      expect(map.fitBounds).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole("button", { name: "Fit trip" }));
      expect(map.fitBounds).toHaveBeenCalledWith([-124.8, 24.4, -66.9, 49.4], expect.objectContaining({
        padding: { top: 40, left: 32, right: 48, bottom: 344 }, duration: 0,
        animate: false,
      }));
      expect(document.querySelector(".map-welcome")).toBeNull();
      expect(document.querySelector(".map-caption")).toBeNull();
    } finally {
      window.matchMedia = previousMedia;
      vi.restoreAllMocks();
    }
  });
  it("fits the union once per plan, preserves camera on style reload and page visibility, and fits on demand", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 900, bottom: 600, width: 900, height: 600, toJSON() {} });
    const plan = makeMockPlan({ origin: demoPlaces[0], destination: demoPlaces[1], departure_local: "2026-10-16T06:00", cargo_lb: 42000, spacing_mi: 25, wind_measure: "gust", rest: { mode: "auto" } });
    const props = { plan, heatmap: null, selected: "B", checkpoint: null, theme: "04", phase: "idle", heatmapError: null };
    const { rerender } = render(<div hidden={false}><MapView {...props} /></div>);
    const map = fake.maps[0];
    await act(() => map.handlers.get("style.load")());
    const boxes = plan.routes.map((route) => route.bbox);
    expect(map.fitBounds).toHaveBeenCalledExactlyOnceWith([
      Math.min(...boxes.map((b) => b[0])), Math.min(...boxes.map((b) => b[1])),
      Math.max(...boxes.map((b) => b[2])), Math.max(...boxes.map((b) => b[3])),
    ], expect.objectContaining({ padding: { top: 40, bottom: 24, left: 32, right: 48 }, duration: 500, maxZoom: 10, animate: true }));
    rerender(<div hidden><MapView {...props} theme="02" /></div>);
    await act(() => map.handlers.get("style.load")());
    expect(map.jumpTo).toHaveBeenCalledWith({ center: [-98, 37], zoom: 6, bearing: 12, pitch: 20 });
    rerender(<div hidden={false}><MapView {...props} theme="02" /></div>);
    expect(map.fitBounds).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Fit trip" }));
    expect(map.fitBounds).toHaveBeenCalledTimes(2);
    const next = { ...plan, plan_id: "new-trip" };
    rerender(<div><MapView {...props} theme="02" plan={next} /></div>);
    expect(map.fitBounds).toHaveBeenCalledTimes(3);
    vi.restoreAllMocks();
  });

  it("coalesces scrub writes, holds trucks at rest, and never replaces sources or renders React while scrubbing", async () => {
    const plan = makeMockPlan({
      origin: demoPlaces[0],
      destination: demoPlaces[1],
      departure_local: "2026-10-16T06:00",
      cargo_lb: 42000,
      spacing_mi: 25,
      wind_measure: "gust",
      rest: { mode: "auto" },
    });
    const heatmap = prepareHeatmap(makeMockHeatmap(plan)),
      commit = vi.fn();
    timeline.reset();
    render(
      <Profiler id="map" onRender={commit}>
        <MapView
          plan={plan}
          heatmap={heatmap}
          selected="B"
          checkpoint={null}
          theme="04"
          phase="idle"
          heatmapError={null}
        />
      </Profiler>,
    );
    const map = fake.maps[0];
    await act(async () => {
      map.handlers.get("style.load")();
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
    expect(map.getSource("corridor").promoteId).toBe("id");
    expect(map.getSource("corridor").data.features).toHaveLength(
      heatmap.data.cells.length,
    );
    map.setPaintProperty.mockClear();
    map.addSource.mockClear();
    map.removeSource.mockClear();
    map.addLayer.mockClear();
    map.removeLayer.mockClear();
    fake.markers.forEach((marker) => marker.setLngLat.mockClear());
    commit.mockClear();
    timeline.set(6);
    timeline.set(7);
    timeline.set(8);
    await act(() => new Promise((resolve) => requestAnimationFrame(resolve)));
    expect(fake.markers.every((marker) => marker.setLngLat.mock.calls.length === 1)).toBe(true);
    expect(
      map.setPaintProperty.mock.calls.filter(
        (args: unknown[]) => args[0] === "corridor-fill",
      ),
    ).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Corridor weather legend" })).toHaveTextContent("Corridor weather at +8 h");
    expect(map.getLayer("corridor-fill").paint["fill-antialias"]).toBe(false);
    expect(map.getLayer("corridor-edge")).toBeUndefined();
    const atRest = fake.markers[0].position;
    timeline.set(8.25);
    await act(() => new Promise((resolve) => requestAnimationFrame(resolve)));
    expect(fake.markers[0].position).toEqual(atRest);
    expect(map.addSource).not.toHaveBeenCalled();
    expect(map.removeSource).not.toHaveBeenCalled();
    expect(map.addLayer).not.toHaveBeenCalled();
    expect(map.removeLayer).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
    const labels = ["Moderate", "High", "Severe", "No Travel", "No tint = Low", "Unknown"];
    const chip = screen.getByRole("button", { name: "Corridor weather legend" });
    expect(Array.from(chip.querySelectorAll(".corridor-legend-levels > span"), node => node.textContent)).toEqual(labels);
    fireEvent.click(chip);
    expect(Array.from(screen.getByRole("region", { name: "Weather risk legend" }).querySelectorAll(".map-legend-grid > span"), node => node.textContent)).toEqual(labels);
  });

  it("keeps alternatives neutral, previews only the focused card, and compiles all zoom widths and checkpoint gates", async () => {
    const plan = makeMockPlan({ origin: demoPlaces[0], destination: demoPlaces[1], departure_local: "2026-10-16T06:00", cargo_lb: 42000, spacing_mi: 25, wind_measure: "gust", rest: { mode: "auto" } });
    const props = { plan, heatmap: prepareHeatmap(makeMockHeatmap(plan)), selected: "B", checkpoint: null, theme: "04", phase: "idle", heatmapError: null };
    const { rerender } = render(<MapView {...props} />);
    const map = fake.maps[0];
    await act(() => map.handlers.get("style.load")());
    expect(map.addLayer.mock.calls.find(([layer]: any[]) => layer.id === "corridor-fill")?.[1]).toBe("road-primary");
    expect(map.setLayoutProperty).toHaveBeenCalledWith("poi", "visibility", "none");
    expect(map.setPaintProperty).toHaveBeenCalledWith("state-label", "text-halo-width", 1.5);
    expect(map.getLayer("checkpoint-markers").layout).toMatchObject({ "icon-padding": 4, "icon-allow-overlap": false, "icon-ignore-placement": false });
    expect(map.getLayer("checkpoint-hit").paint["circle-radius"]).toBe(12);
    const layerOrder = map.addLayer.mock.calls.map(([layer]: any[]) => layer.id);
    expect(layerOrder.indexOf("rest-markers")).toBeLessThan(layerOrder.indexOf("checkpoint-markers"));
    const filter = map.setFilter.mock.calls.findLast(([id]: any[]) => id === "checkpoint-hit")[1];
    const gate = featureFilter(filter, "checkpoint-markers.filter").filter;
    const visible = (level: number, route: string, zoom: number) => gate({ zoom }, { type: "Point", properties: { level, route } });
    expect(visible(4, "A", 0)).toBe(true);
    expect(visible(3, "A", 3)).toBe(false);
    expect(visible(3, "A", 4)).toBe(true);
    expect(visible(2, "B", 4)).toBe(true);
    expect(visible(2, "A", 5)).toBe(false);
    expect(visible(0, "B", 6)).toBe(false);
    expect(visible(0, "B", 7)).toBe(true);
    expect(visible(1, "A", 12)).toBe(true);
    expect(visible(255, "B", 6)).toBe(true);
    map.addSource.mockClear(); map.fitBounds.mockClear();
    rerender(<MapView {...props} previewRoute="A" />);
    const color = map.setPaintProperty.mock.calls.findLast(([id, name]: any[]) => id === "route-alt" && name === "line-color")[2];
    const expression = createPropertyExpression(color, "line-color", latest.paint_line["line-color"] as StylePropertySpecification);
    expect(expression.result).toBe("success");
    if (expression.result === "success") {
      expect(expression.value.evaluate({ zoom: 4 }, { type: "LineString", properties: { route: "A", level: 3 } }).toString()).toBe("rgba(255,166,180,1)");
      expect(expression.value.evaluate({ zoom: 4 }, { type: "LineString", properties: { route: "C", level: 3 } }).toString()).toBe("rgba(99,121,127,1)");
    }
    for (const [id, name, value] of map.setPaintProperty.mock.calls) if (name === "line-width" && ["route-casing", "route-alt", "route-selected"].includes(id)) expect(createPropertyExpression(value, "line-width", latest.paint_line["line-width"] as StylePropertySpecification).result).toBe("success");
    expect(map.addSource).not.toHaveBeenCalled(); expect(map.fitBounds).not.toHaveBeenCalled();
  });

  it("resizes without refitting, lazily restores theme images, and dismisses the legend accessibly", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 900, bottom: 600, width: 900, height: 600, toJSON() {} });
    const plan = makeMockPlan({ origin: demoPlaces[0], destination: demoPlaces[1], departure_local: "2026-10-16T06:00", cargo_lb: 42000, spacing_mi: 25, wind_measure: "gust", rest: { mode: "auto" } });
    const props = { plan, heatmap: null, selected: "B", checkpoint: null, theme: "04", phase: "idle", heatmapError: null };
    const { rerender, unmount } = render(<MapView {...props} layoutKey="peek:false" />);
    const map = fake.maps[0];
    await act(() => map.handlers.get("style.load")());
    const fitted = map.fitBounds.mock.calls.length;
    act(() => fake.resizes[0]());
    expect(map.fitBounds).toHaveBeenCalledTimes(fitted);
    rerender(<MapView {...props} layoutKey="half:false" />);
    expect(map.fitBounds).toHaveBeenCalledTimes(fitted);
    act(() => { map.handlers.get("dragstart")({ originalEvent: new Event("mousedown") }); fake.resizes[0](); });
    expect(map.fitBounds).toHaveBeenCalledTimes(fitted);
    expect(map.resize.mock.calls.length).toBeGreaterThanOrEqual(2);
    await act(() => map.handlers.get("styleimagemissing")({ id: "severity-4" }));
    expect(map.hasImage("severity-4")).toBe(true);
    expect(screen.queryByRole("region", { name: "Weather risk legend" })).toBeNull();
    const legend = screen.getByRole("button", { name: "Legend" });
    fireEvent.click(legend);
    expect(screen.getByRole("region", { name: "Weather risk legend" })).toHaveTextContent("No tint = Low");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(legend).toHaveFocus();
    fireEvent.click(legend); fireEvent.pointerDown(document.body);
    expect(legend).toHaveAttribute("aria-expanded", "false");
    map.images.delete("severity-3");
    act(() => map.handlers.get("styleimagemissing")({ id: "severity-3" }));
    expect(map.hasImage("severity-3")).toBe(true);
    rerender(<MapView {...props} theme="02" layoutKey="full:true" />);
    await act(() => map.handlers.get("style.load")());
    // No stale asynchronous image can overwrite the new theme: all sprites already exist.
    for (const id of MAP_SYMBOL_IDS) expect(map.hasImage(id), id).toBe(true);
    expect(vi.mocked(mapSymbolImage).mock.lastCall?.[1].stop).toBe("#D1B6FF");
    expect(map.fitBounds).toHaveBeenCalledTimes(fitted);
    unmount();
    const markers = fake.markers.slice(); markers.forEach((marker) => marker.setLngLat.mockClear());
    timeline.set(12);
    await act(() => new Promise((resolve) => requestAnimationFrame(resolve)));
    expect(markers.every((marker) => marker.remove.mock.calls.length === 1 && marker.setLngLat.mock.calls.length === 0)).toBe(true);
    expect(map.remove).toHaveBeenCalledOnce();
    vi.restoreAllMocks();
  });
  it("never saves an unframed StrictMode mount as a restored-plan camera", async () => {
    const rect = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 900, bottom: 600, width: 900, height: 600, toJSON() {} });
    const plan = JSON.parse(JSON.stringify(makeMockPlan({ origin: demoPlaces[0], destination: demoPlaces[1], departure_local: "2026-10-16T06:00", cargo_lb: 42000, spacing_mi: 25, wind_measure: "gust", rest: { mode: "auto" } })));
    render(<StrictMode><MapView plan={plan} heatmap={null} selected="B" checkpoint={null} theme="04" phase="idle" heatmapError={null} /></StrictMode>);
    const map = fake.maps.at(-1);
    expect(planCameras.has(plan.plan_id)).toBe(false);
    await act(async () => { map.handlers.get("style.load")(); rect.mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 700, bottom: 600, width: 700, height: 600, toJSON() {} }); await new Promise(requestAnimationFrame); });
    expect(map.fitBounds).toHaveBeenCalledTimes(2);
    expect(map.jumpTo).not.toHaveBeenCalled();
    expect(map.resize.mock.invocationCallOrder[0]).toBeLessThan(map.fitBounds.mock.invocationCallOrder[0]);
    act(() => fake.resizes.at(-1)!());
    expect(map.fitBounds).toHaveBeenCalledTimes(2);
  });

  it("registers every image expression branch before layers, and repairs missing sprites synchronously after a theme change", async () => {
    const plan = makeMockPlan({ origin: demoPlaces[0], destination: demoPlaces[1], departure_local: "2026-10-16T06:00", cargo_lb: 42000, spacing_mi: 25, wind_measure: "gust", rest: { mode: "auto" } });
    const props = { plan, heatmap: prepareHeatmap(makeMockHeatmap(plan)), selected: "B", checkpoint: null, theme: "04", phase: "idle", heatmapError: null };
    const { rerender } = render(<MapView {...props} />), map = fake.maps[0];
    const add = map.addLayer.getMockImplementation();
    map.addLayer.mockImplementation((layer: any) => {
      const expression = layer.layout?.["icon-image"];
      if (expression) {
        if (typeof expression === "string") expect(map.hasImage(expression), expression).toBe(true);
        else for (const feature of map.getSource(layer.source).data.features) expect(map.hasImage(feature.properties.image), feature.properties.image).toBe(true);
        // Route selection can choose any of these branches without another layer install.
        for (const id of MAP_SYMBOL_IDS) expect(map.hasImage(id), `${layer.id}: ${id}`).toBe(true);
      }
      const pattern = layer.paint?.["fill-pattern"];
      if (pattern) for (const id of ["heat-0", "heat-1", "heat-2", "heat-3", "heat-4", "heat-unknown"]) expect(map.hasImage(id)).toBe(true);
      add(layer);
    });
    await act(() => map.handlers.get("style.load")());
    rerender(<MapView {...props} theme="02" />);
    await act(() => map.handlers.get("style.load")());
    for (const id of MAP_SYMBOL_IDS) {
      map.images.delete(id); map.handlers.get("styleimagemissing")({ id });
      expect(map.hasImage(id), id).toBe(true); // No await/microtask permitted here.
    }
  });

  it("docks a compact preview legend at top-left, then restores the full bottom legend", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response('', { status: 404 }));
    const plan = makeMockPlan({ origin: demoPlaces[0], destination: demoPlaces[1], departure_local: "2026-10-16T06:00", cargo_lb: 42000, spacing_mi: 25, wind_measure: "gust", rest: { mode: "auto" } });
    render(<MapView plan={plan} heatmap={null} selected="B" checkpoint={null} theme="04" phase="idle" heatmapError={null} />);
    await act(() => fake.maps[0].handlers.get("style.load")());
    act(() => drive.start(plan, plan.routes[1]));
    const dock = screen.getByRole("button", { name: "Corridor weather legend" }).parentElement;
    expect(dock).toHaveClass("map-preview-legend");
    expect(dock?.querySelector('.corridor-legend-levels')).toBeNull();
    expect(screen.getByRole("region", { name: "Drive preview controls" }).closest(".map-bottom-dock")).not.toBe(dock);
    act(() => drive.end());
    expect(screen.getByRole("button", { name: "Corridor weather legend" }).parentElement).toHaveClass("map-bottom-dock");
    expect(screen.getByRole("button", { name: "Corridor weather legend" }).querySelector('.corridor-legend-levels')).not.toBeNull();
  });

});
