import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeMockPlan, demoPlaces } from '../api/mock';
import { drive } from './state';
import { timeline } from '../state/timeline';
const fake = vi.hoisted(() => ({ load: vi.fn(async () => null), show: vi.fn(), clear: vi.fn() }));
vi.mock('./loadTruck', () => ({ loadTruck: fake.load }));
vi.mock('./monuments', () => ({ monuments: () => ({ show: fake.show, clear: fake.clear, tick: () => false }) }));
import { createDriveController } from './controller';
import type { Map } from 'maplibre-gl';

function setup(reduced = false) {
  vi.spyOn(window, 'matchMedia').mockImplementation(query => ({ media: query, matches: reduced, onchange: null, addListener() {}, removeListener() {}, dispatchEvent: () => true, addEventListener() {}, removeEventListener() {} }));
  const plan = makeMockPlan({ origin: demoPlaces[0], destination: demoPlaces[1], departure_local: '2026-10-16T06:00', cargo_lb: 42000, spacing_mi: 25, wind_measure: 'gust', rest: { mode: 'auto' } });
  drive.start(plan, plan.routes[1]);
  const map = { getCenter: () => ({ lng: -98, lat: 40 }), getZoom: () => 6, getPitch: () => 0, getBearing: () => 0, getContainer: () => ({ clientHeight: 600 }), flyTo: vi.fn(), fitBounds: vi.fn(), jumpTo: vi.fn(), stop: vi.fn(), getStyle: () => ({ layers: [] }), isStyleLoaded: () => false, addLayer: vi.fn(), getLayer: vi.fn(), removeLayer: vi.fn(), triggerRepaint: vi.fn() };
  const controller = createDriveController(map as unknown as Map, drive.get().session!, () => ({ top: 40, bottom: 24, left: 32, right: 48 }), vi.fn());
  return { plan, controller, map, session: drive.get().session!, now: performance.now() };
}
afterEach(() => { drive.end(); timeline.reset(); vi.restoreAllMocks(); fake.load.mockClear(); fake.show.mockClear(); });
describe('preview lifecycle and reduced motion', () => {
  it('keeps reduced motion in 2D without a camera move or a three import, including at arrival', () => {
    const { controller, map, session, now } = setup(true);
    controller.frame(session.start, now + 20);
    expect(drive.get().phase).toBe('chase');
    timeline.set(session.start + 4); controller.frame(timeline.get(), now + 100);
    drive.skip(); controller.frame(session.end, now + 200);
    expect(fake.load).not.toHaveBeenCalled(); expect(map.flyTo).not.toHaveBeenCalled(); expect(map.jumpTo).not.toHaveBeenCalled(); expect(map.fitBounds).not.toHaveBeenCalled();
    expect(drive.get().summary?.id).toBe(session.route.id); controller.dispose(true);
    expect(map.jumpTo).not.toHaveBeenCalled();
  });
  it('holds time during the swoop, chases only while following, and restores the camera on close', () => {
    const { controller, map, session, now } = setup();
    expect(map.flyTo).toHaveBeenCalledWith(expect.objectContaining({ duration: 2000, pitch: 56 }));
    controller.frame(session.start, now + 2100); expect(drive.get().phase).toBe('chase');
    controller.frame(session.start + 1, now + 2200); expect(map.jumpTo).toHaveBeenCalled();
    drive.follow(false); map.jumpTo.mockClear(); controller.frame(session.start + 2, now + 2300); expect(map.jumpTo).not.toHaveBeenCalled();
    drive.follow(true); controller.frame(session.start + 2, now + 2400); expect(map.jumpTo).toHaveBeenCalled();
    controller.dispose(true); expect(map.jumpTo).toHaveBeenLastCalledWith({ center: [-98, 40], zoom: 6, pitch: 0, bearing: 0 });
  });
  it('uses selected arrival, jumps to outro on Skip, and never changes plan inputs', () => {
    const { controller, map, session, now, plan } = setup(), before = JSON.stringify(plan);
    expect(session.route.id).toBe('B');
    drive.speed(4); expect(timeline.get()).toBe(session.start);
    timeline.set(session.end + 50); expect(timeline.get()).toBe(session.end);
    timeline.set(session.start);
    drive.skip(); expect(timeline.get()).toBe(session.end);
    controller.frame(session.end, now + 100); expect(map.fitBounds).toHaveBeenCalledWith(expect.any(Array), expect.objectContaining({ pitch: 0, bearing: 0, duration: 1400 }));
    controller.frame(session.end, now + 2100); expect(drive.get().session).toBeNull(); expect(drive.get().summary?.id).toBe('B');
    expect(JSON.stringify(plan)).toBe(before); controller.dispose(false);
  });
  it('reseeds the camera on a paused scrub without a long animated sweep', () => {
    const { controller, map, session, now } = setup();
    controller.frame(session.start, now + 2100); timeline.play(false);
    map.jumpTo.mockClear(); timeline.set(session.start + 6); controller.frame(timeline.get(), now + 2200);
    expect(map.jumpTo).toHaveBeenCalledOnce(); expect(map.flyTo).toHaveBeenCalledOnce(); controller.dispose(true);
  });
  it('adds a fresh layer on second Play even while MapLibre reports the style busy, re-adds after a style swap and clears suspension at rest/pause', async () => {
    const renderers = [0, 1].map(() => ({ layer: { id: 'drive-truck', type: 'custom' }, set: vi.fn(), dispose: vi.fn() }));
    fake.load.mockResolvedValueOnce(renderers[0] as never).mockResolvedValueOnce(renderers[1] as never);
    const { controller, map, plan } = setup();
    const layers = new globalThis.Map();
    map.getLayer.mockImplementation(id => layers.get(id));
    map.addLayer.mockImplementation(layer => layers.set(layer.id, layer));
    map.removeLayer.mockImplementation(id => layers.delete(id));
    await Promise.resolve();
    expect(map.getLayer('drive-truck')).toBe(renderers[0].layer);
    controller.dispose(true); drive.end();
    expect(map.getLayer('drive-truck')).toBeUndefined(); expect(renderers[0].dispose).toHaveBeenCalledOnce();
    drive.start(plan, plan.routes[0]);
    const next = createDriveController(map as unknown as Map, drive.get().session!, () => ({ top: 40, bottom: 24, left: 32, right: 48 }), vi.fn());
    await Promise.resolve();
    expect(map.getLayer('drive-truck')).toBe(renderers[1].layer);
    layers.clear(); next.install(); expect(map.getLayer('drive-truck')).toBe(renderers[1].layer);
    const session = drive.get().session!, now = performance.now();
    drive.chase(); next.frame(session.start + 1, now + 2500);
    expect(Math.abs(renderers[1].set.mock.lastCall![2])).toBeLessThanOrEqual(.015);
    timeline.play(false); next.frame(session.start + 1, now + 2600);
    expect(renderers[1].set.mock.lastCall![2]).toBe(0);
    timeline.play(true);
    const rest = session.route.rests[0], elapsed = (Date.parse(rest.start_utc) - Date.parse(plan.inputs.departure_utc)) / 1000 + 60;
    next.frame(session.start + elapsed / 3600, now + 2700);
    expect(renderers[1].set.mock.lastCall![2]).toBe(0);
    next.dispose(true); next.dispose(true); expect(renderers[1].dispose).toHaveBeenCalledOnce();
  });

});
