import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeMockPlan, demoPlaces } from '../api/mock';
import { drive } from './state';
import { selectCardTriggers } from './math';
vi.mock('maplibre-gl', () => ({ Marker: class {
  element: HTMLElement;
  constructor({ element }: { element: HTMLElement }) { this.element = element; }
  setLngLat() { return this; } addTo() { document.body.append(this.element); return this; } remove() { this.element.remove(); }
} }));
import { monuments } from './monuments';
import type { Map } from 'maplibre-gl';
import { weatherIconUrl } from '../lib/weatherIconAssets';
import { planner } from '../state/planner';
import type { Checkpoint, Level } from '../api/types';
afterEach(() => { document.querySelectorAll('.drive-monument-marker, .drive-edge-pulse').forEach(element => element.remove()); drive.end(); });
describe('monument budget and safe card content', () => {
  it('keeps the No Travel card readable with reduced motion and omits the edge pulse', () => {
    const original = window.matchMedia;
    vi.spyOn(window, 'matchMedia').mockImplementation(query => ({ ...original(query), matches: true }));
    const plan = makeMockPlan({ origin: demoPlaces[0], destination: demoPlaces[1], departure_local: '2026-10-16T06:00', cargo_lb: 42000, spacing_mi: 25, wind_measure: 'gust', rest: { mode: 'auto' } });
    const route = { ...plan.routes[0], checkpoints: [{ ...plan.routes[0].checkpoints[0], level: 4 as const, drivers: ['wind'] }] };
    drive.start(plan, route); const cards = monuments({ getContainer: () => document.body } as unknown as Map, drive.get().session!, vi.fn());
    cards.show(selectCardTriggers(plan, route)[0], 0);
    expect(document.querySelector('.drive-monument-badge')).toHaveTextContent('Travel not recommended'); expect(document.querySelector('.drive-edge-pulse')).toBeNull();
    expect(document.querySelector('.drive-monument-badge source')).toHaveAttribute('media', '(prefers-reduced-motion: reduce)');
    expect(document.querySelector('.drive-monument-badge source')).toHaveAttribute('srcset', weatherIconUrl('wind', true));
    cards.clear(); drive.end();
  });
  it.each([['wind', 'gust', 'Gust 47 mph', 'wind'], ['wind', 'sustained', 'Sustained wind 31 mph', 'wind'], ['rain', 'gust', 'Rain 0.40 in/hr', 'extreme-rain'], ['snow', 'gust', 'Snow 0.20 in/hr', 'extreme-snow']] as const)('renders a severity header with the %s driver, a big value, place and ETA', (driver, measure, value, icon) => {
    const plan = makeMockPlan({ origin: demoPlaces[0], destination: demoPlaces[1], departure_local: '2026-10-16T06:00', cargo_lb: 42000, spacing_mi: 25, wind_measure: measure, rest: { mode: 'auto' } });
    const route = { ...plan.routes[0], checkpoints: [{ ...plan.routes[0].checkpoints[0], level: 4 as const, drivers: [driver], gust_mph: 47, wind_mph: 31, rain_in: .4, snow_in: .2 }] };
    drive.start(plan, route);
    const cards = monuments({ getContainer: () => document.body } as unknown as Map, drive.get().session!, vi.fn());
    cards.show(selectCardTriggers(plan, route)[0], 0);
    const body = document.querySelector('.drive-monument-body')!;
    expect(body.firstElementChild).toHaveTextContent('Travel not recommended');
    expect(body.querySelector('.drive-monument-badge .weather-icon')).toHaveAttribute('data-weather', icon);
    expect(body.querySelector('.drive-monument-badge img')).toHaveAttribute('width', '56');
    expect(body.querySelector('.drive-monument-driver')).toHaveTextContent(value);
    expect(body.children[2]).toHaveClass('drive-monument-place'); expect(body.children[3]).toHaveTextContent('ETA');
    expect(document.querySelector('.drive-edge-pulse')).toBeInTheDocument(); cards.tick(701); expect(document.querySelector('.drive-edge-pulse')).toBeNull();
    cards.clear(); drive.end();
  });
  it('shows at most three cards, animates only the inner wrapper, and leaves collapsed pins', () => {
    const plan = makeMockPlan({ origin: demoPlaces[0], destination: demoPlaces[1], departure_local: '2026-10-16T06:00', cargo_lb: 42000, spacing_mi: 25, wind_measure: 'gust', rest: { mode: 'auto' } });
    const route = { ...plan.routes[0], checkpoints: plan.routes[0].checkpoints.slice(0, 4).map(cp => ({ ...cp, level: 3 as const, place_label: '<img src=x onerror=alert(1)>', drivers: ['wind'], gust_mph: 47 })) };
    drive.start(plan, route); const announce = vi.fn(), cards = monuments({} as Map, drive.get().session!, announce);
    selectCardTriggers(plan, route).filter(t => t.checkpoint).forEach((trigger, i) => cards.show(trigger, i * 50));
    expect(document.querySelectorAll('.drive-monument:not([data-collapsed])')).toHaveLength(3);
    expect(document.querySelectorAll('.drive-monument-marker > .drive-monument')).toHaveLength(4);
    expect(document.querySelector('.drive-monument-marker')?.getAttribute('aria-hidden')).toBe('true');
    expect(document.querySelector('.drive-monument-place img')).toBeNull(); expect(document.querySelector('.drive-monument-place')).toHaveTextContent('<img src=x onerror=alert(1)>'); expect(document.body.textContent).toContain('Gust 47 mph');
    cards.tick(3000); expect(document.querySelectorAll('.drive-monument[data-collapsed]')).toHaveLength(4);
    expect(document.querySelectorAll('.drive-monument-pin')).toHaveLength(4); expect(announce).toHaveBeenCalledTimes(4);
    cards.clear(); expect(document.querySelector('.drive-monument-marker')).toBeNull(); drive.end();
  });
});

const createPlan = () => makeMockPlan({ origin: demoPlaces[0], destination: demoPlaces[1], departure_local: '2026-10-16T06:00', cargo_lb: 43000, spacing_mi: 25, wind_measure: 'gust', rest: { mode: 'auto' } });
function showCard(patch: Partial<Checkpoint>, plan = createPlan()) {
  const route = plan.routes[2], cp = { ...route.checkpoints[0], drivers: ['wind'], ...patch };
  drive.start(plan, route);
  const announce = vi.fn(), cards = monuments({ getContainer: () => document.body } as unknown as Map, drive.get().session!, announce);
  cards.show({ id: 'test', elapsed: cp.elapsed_s, position: [cp.lon, cp.lat], checkpoint: cp }, 0);
  return { plan, cp, cards, announce, body: document.querySelector('.drive-monument-body')! };
}
describe('weather guidance by severity', () => {
  it.each([[0, 'Low'], [1, 'Moderate'], [2, 'High'], [3, 'Severe'], [4, 'Travel not recommended'], [null, 'Unknown']] as const)('uses the correct header for level %s', (level, title) => {
    const { body, cards } = showCard({ level: level as Level });
    expect(body.querySelector('.drive-monument-badge')).toHaveTextContent(title);
    expect(body.textContent?.includes('Drive with extreme caution')).toBe(level === 3);
    if (level !== 3 && level !== 4) expect(body.textContent).not.toMatch(/Clear roads|Eases in|No clearing|Or:/);
    cards.clear();
  });
  it.each([null, undefined])('shows the No Travel fallback for clearing %s, with safe provider text', clears_in_h => {
    const plan = createPlan(); plan.recommendation.departure_advice = null;
    const { body, cards, announce } = showCard({ level: 4, clears_in_h, clears_at_utc: null }, plan);
    expect(body).toHaveTextContent('No clearing in the next 48 h.');
    expect(body.querySelector('button')).toBeNull();
    expect(announce).toHaveBeenCalledWith(expect.stringContaining('Travel not recommended'));
    expect(announce).toHaveBeenCalledWith(expect.stringContaining('No clearing in the next 48 h.'));
    cards.clear();
  });
  it('shows spot-local clearing after ETA, the load rule and a departure alternative', () => {
    const { body, cards, announce } = showCard({ level: 4, load_adjusted: true, gust_mph: 47, wind_mph: 24, clears_in_h: 6, clears_at_utc: '2026-10-17T02:00:00Z', tz: 'America/Denver' });
    expect(body.querySelector('.drive-monument-driver')).toHaveTextContent('Gust 47 mph · 43,000 lb');
    expect(body).toHaveTextContent(/Clear roads in about 6 h \(Fri,? 8:00 PM MDT\)\./);
    expect(body).toHaveTextContent(`Or: ${createPlan().recommendation.departure_advice!.summary}`);
    expect(announce).toHaveBeenCalledWith(expect.stringContaining('Clear roads in about 6 h'));
    cards.clear();
  });
  it.each([4, null])('only adds a Severe easing estimate when provided (%s)', clears_in_h => {
    const { body, cards } = showCard({ level: 3, clears_in_h });
    expect(body).toHaveTextContent('Drive with extreme caution');
    expect(body.textContent?.includes('Eases in about 4 h')).toBe(clears_in_h !== null);
    expect(body).not.toHaveTextContent('Travel not recommended'); expect(body.querySelector('button')).toBeNull();
    cards.clear();
  });
  it('ends the preview before replanning in the origin zone and preserves planning preferences', () => {
    const plan = createPlan();
    plan.inputs.departure_utc = '2026-11-01T04:30:00Z'; plan.inputs.departure_local = '2026-10-31T23:30';
    plan.inputs.weather_slowdown = false;
    plan.recommendation.departure_advice = { offset_h: 6, route_id: 'B', summary: '<img src=x onerror=alert(1)>' };
    const submit = vi.spyOn(planner, 'submit').mockImplementation(async request => {
      expect(drive.get().session).toBeNull(); expect(drive.get().summary).toBeNull();
      expect(request).toEqual({ origin: plan.inputs.origin, destination: plan.inputs.destination, departure_local: '2026-11-01T04:30', cargo_lb: 43000, spacing_mi: 25, wind_measure: 'gust', rest: { mode: 'auto' }, weather_slowdown: false });
      return true;
    });
    const { body, cards } = showCard({ level: 4 }, plan);
    const action = body.querySelector('button')!;
    expect(action).toHaveTextContent('Plan +6 h');
    expect(action.closest('[aria-hidden="true"]')).toBeNull();
    expect(body.querySelector('.drive-monument-advice img')).toBeNull(); expect(body).toHaveTextContent('Or: <img src=x onerror=alert(1)>');
    action.click(); expect(submit).toHaveBeenCalledOnce(); expect(action).toBeDisabled();
    cards.clear();
  });
  it('keeps a focused action visible, retains the three-card cap, and makes collapsed actions inert', () => {
    const { body, cards, cp } = showCard({ level: 4 });
    const action = body.querySelector('button')!; action.focus();
    cards.tick(9000); expect(body.parentElement).not.toHaveAttribute('data-collapsed');
    for (let i = 0; i < 3; i++) cards.show({ id: `more-${i}`, elapsed: 0, position: [cp.lon, cp.lat], checkpoint: cp }, i + 1);
    expect(document.querySelectorAll('.drive-monument:not([data-collapsed])')).toHaveLength(3);
    expect(action).toHaveFocus(); expect(body.parentElement).not.toHaveAttribute('data-collapsed');
    action.blur(); cards.tick(10000);
    expect(body.parentElement).toHaveAttribute('data-collapsed', 'true'); expect((body as HTMLElement).inert).toBe(true);
    cards.clear();
  });
});
