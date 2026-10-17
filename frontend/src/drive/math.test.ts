import { describe, expect, it } from 'vitest';
import polyline from '@mapbox/polyline';
import { makeMockPlan, demoPlaces } from '../api/mock';
import { prepareGeometry } from '../lib/geometry';
import { motionPolicy, previewPacing, routePose, selectCardTriggers, smoothBearing, speedToZoom, tripBounds, departureHour, forecastBase } from './math';

const plan = makeMockPlan({ origin: demoPlaces[0], destination: demoPlaces[1], departure_local: '2026-10-16T06:30', cargo_lb: 42000, spacing_mi: 25, wind_measure: 'gust', rest: { mode: 'auto' } });
describe('drive route and camera maths', () => {
  it('interpolates elapsed -> progress miles -> actual polyline and pauses across a rest', () => {
    const route = { ...plan.routes[0], polyline: polyline.encode([[40, -100], [40, -99], [41, -99]]), distance_mi: 100, progress: [[0, 0], [3600, 50], [39600, 50], [43200, 100]] as [number, number][] };
    const geometry = prepareGeometry(route);
    expect(routePose(geometry, -100).position).toEqual([-100, 40]);
    expect(routePose(geometry, 50000).position).toEqual([-99, 41]);
    expect(routePose(geometry, 3600).position).toEqual(routePose(geometry, 20000).position);
    expect(routePose(geometry, 20000).mph).toBe(0);
    expect(routePose(geometry, 1800).mi).toBe(25);
    expect(routePose(geometry, 1800).heading).toBeCloseTo(90, 0);
    expect(routePose(geometry, 42000).heading).toBeCloseTo(0);
  });
  it('selects Moderate+, every slowdown (even Low/Unknown), and every rest in time order', () => {
    const route = { ...plan.routes[0], checkpoints: plan.routes[0].checkpoints.slice(0, 5).map((cp, i) => ({ ...cp, i, elapsed_s: i * 3600, level: [0, 1, 3, 0, null][i] as 0 | 1 | 3 | null, slowdown: i === 3 ? 'Light rain −8%' : null, speed_factor: i === 4 ? .9 : 1 })) };
    const triggers = selectCardTriggers(plan, route);
    expect(triggers.filter(t => t.checkpoint).map(t => t.checkpoint!.i)).toEqual([1, 2, 3, 4]);
    expect(triggers.filter(t => t.restIndex !== undefined)).toHaveLength(route.rests.length);
    expect(triggers.map(t => t.elapsed)).toEqual(triggers.map(t => t.elapsed).sort((a, b) => a - b));
  });
  it('adapts zoom to actual speed, doubles pace by zooming out one stop, and clamps safely', () => {
    const zoom = speedToZoom(40, 60, 1, 1200);
    expect(speedToZoom(40, 60, 2, 1200)).toBeCloseTo(zoom - 1);
    expect(speedToZoom(40, 60, 4, 1200)).toBeCloseTo(zoom - 2);
    expect(speedToZoom(40, 0, 1, 1200)).toBe(9.5);
    expect(speedToZoom(40, 900, 4, 1000)).toBe(5.5);
    expect(previewPacing(24 * 3600)).toBeCloseTo(40000 / 24);
    expect(previewPacing(3600)).toBe(3000);
    expect(previewPacing(100 * 3600)).toBe(1000);
  });
  it('uses the short turn over north and caps angular speed to 25 degrees/s', () => {
    expect(smoothBearing(359, 1, .1, 1)).toBeGreaterThan(359);
    expect(smoothBearing(0, 160, .1, 4)).toBe(2.5);
    expect(smoothBearing(0, 1, .1, 1)).toBe(0);
  });
  it('uses a strict steady-camera 2D path for reduced motion', () => {
    expect(motionPolicy(true)).toEqual({ three: false, follow: false, introMs: 0, outroMs: 0, pitch: 0 });
    expect(motionPolicy(false).introMs).toBe(2000);
  });
  it('includes endpoints outside provider bboxes and preserves fractional departure offsets', () => {
    const changed = { ...plan, inputs: { ...plan.inputs, destination: { ...plan.inputs.destination, lon: -125, lat: 48 } } };
    expect(tripBounds(changed)[0]).toBe(-125); expect(tripBounds(changed)[3]).toBe(48);
    expect(departureHour(plan, forecastBase(plan))).toBe(.5);
  });
});
