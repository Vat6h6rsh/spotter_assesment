import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { makeMockPlan, demoPlaces } from '../api/mock';
import { timeline } from '../state/timeline';
import { drive } from './state';
import { DriveHud } from './DriveHud';
afterEach(() => { act(() => drive.end()); timeline.reset(); });
describe('preview HUD controls', () => {
  it('shows the two-second Mausam title with the trip, route and departure, and skips it under reduced motion', () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 404 }));
    const plan = makeMockPlan({ origin: demoPlaces[0], destination: demoPlaces[1], departure_local: '2026-10-16T06:00', cargo_lb: 42000, spacing_mi: 25, wind_measure: 'gust', rest: { mode: 'auto' } });
    act(() => drive.start(plan, plan.routes[1])); const { container } = render(<DriveHud />);
    const title = container.querySelector('.drive-title')!;
    expect(title).toHaveTextContent(`Mausam · ${plan.inputs.origin.label.split(',').slice(0, 2).join(',')} → ${plan.inputs.destination.label.split(',').slice(0, 2).join(',')}`);
    expect(title).toHaveTextContent(plan.routes[1].label); expect(title.querySelector('.route-letter')).toHaveTextContent('B');
    expect(title.querySelector('time')).toHaveAttribute('dateTime', plan.inputs.departure_utc);
    fireEvent.click(screen.getByRole('button', { name: 'Pause drive preview' })); expect(title).toHaveStyle({ animationPlayState: 'paused' });
    act(() => drive.chase()); expect(container.querySelector('.drive-title')).toBeNull();
    const original = window.matchMedia;
    vi.spyOn(window, 'matchMedia').mockImplementation(query => ({ ...original(query), matches: query.includes('reduced-motion') }));
    act(() => drive.start(plan, plan.routes[0])); expect(container.querySelector('.drive-title')).toBeNull();
  });
  it('stamps the recommendation or No Travel verdict at completion without endorsing an alternative', () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 404 }));
    const plan = makeMockPlan({ origin: demoPlaces[0], destination: demoPlaces[1], departure_local: '2026-10-16T06:00', cargo_lb: 42000, spacing_mi: 25, wind_measure: 'gust', rest: { mode: 'auto' } });
    render(<DriveHud />);
    for (const [route, label] of [[plan.routes[1], 'Recommended route'], [plan.routes[2], 'Blocked: No Travel crossed'], [plan.routes[0], 'Alternative route']] as const) {
      act(() => { drive.start(plan, route); drive.end(true); });
      expect(screen.getByText(label)).toHaveClass('drive-verdict');
    }
  });
  it('offers delayed departure on a blocked completion, otherwise the recommended route', () => {
    const plan = makeMockPlan({ origin: demoPlaces[0], destination: demoPlaces[1], departure_local: '2026-10-16T06:00', cargo_lb: 43000, spacing_mi: 25, wind_measure: 'gust', rest: { mode: 'auto' } });
    const route = plan.routes[2]; render(<DriveHud />);
    act(() => { drive.start(plan, route); drive.end(true); });
    expect(screen.getByText('Blocked: No Travel crossed')).toHaveAttribute('data-blocked', 'true');
    expect(screen.getByText('Leave 6 h later on Route A')).toBeInTheDocument();
    plan.recommendation.departure_advice = null;
    act(() => { drive.start(plan, route); drive.end(true); });
    expect(screen.getByText('Take Route B')).toBeInTheDocument();
    expect(screen.queryByText(/Leave 6 h/)).toBeNull();
    act(() => { drive.start(plan, plan.routes[1]); drive.end(true); });
    expect(screen.queryByText('Take Route B')).toBeNull(); expect(screen.getByText('Recommended route')).toBeInTheDocument();
  });
  it('keeps the blocked stamp when every route is ineligible, without inventing advice', () => {
    const plan = makeMockPlan({ origin: demoPlaces[0], destination: demoPlaces[1], departure_local: '2026-10-16T06:00', cargo_lb: 43000, spacing_mi: 25, wind_measure: 'gust', rest: { mode: 'auto' } });
    plan.recommendation = { ...plan.recommendation, status: 'none_eligible', route_id: null, departure_advice: null };
    render(<DriveHud />);
    act(() => { drive.start(plan, plan.routes[2]); drive.end(true); });
    expect(screen.getByText('Blocked: No Travel crossed')).toBeInTheDocument();
    expect(screen.queryByText(/Take Route|Leave \d+ h/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss trip summary' }));
    expect(drive.get().summaryAdvice).toBeNull(); expect(screen.queryByRole('status')).toBeNull();
  });
  it('offers speed, pause/resume, arrow-hour scrubbing, a private file picker and Escape close', () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ available: false })));
    const plan = makeMockPlan({ origin: demoPlaces[0], destination: demoPlaces[1], departure_local: '2026-10-16T06:00', cargo_lb: 42000, spacing_mi: 25, wind_measure: 'gust', rest: { mode: 'auto' } });
    act(() => drive.start(plan, plan.routes[1])); render(<DriveHud />);
    // Music is on by default (founder decision): the control offers Mute.
    expect(screen.getByRole('button', { name: 'Mute preview music' })).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(screen.getByRole('button', { name: 'Mute preview music' }));
    expect(screen.getByRole('button', { name: 'Unmute preview music' })).toHaveAttribute('aria-pressed', 'true');
    expect(localStorage.getItem('spotter.drive.muted')).toBe('1');
    localStorage.removeItem('spotter.drive.muted');
    fireEvent.click(screen.getByRole('button', { name: '4× speed' })); expect(drive.get().speed).toBe(4);
    fireEvent.click(screen.getByRole('button', { name: 'Pause drive preview' })); expect(timeline.isPlaying()).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Resume drive preview' })); expect(timeline.isPlaying()).toBe(true);
    const hud = screen.getByRole('region', { name: 'Drive preview controls' });
    fireEvent.keyDown(hud, { key: ' ' }); expect(timeline.isPlaying()).toBe(false);
    fireEvent.keyDown(hud, { key: 'ArrowRight' }); expect(timeline.get()).toBe(1);
    fireEvent.keyDown(hud, { key: 'ArrowLeft' }); expect(timeline.get()).toBe(0);
    fireEvent.click(screen.getByRole('button', { name: 'Choose preview music' }));
    expect(screen.getByRole('button', { name: 'Gnossienne No. 1 · Erik Satie' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Mausam Aaj Tak' })).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(screen.getByRole('button', { name: 'Mausam Aaj Tak' }));
    fireEvent.click(screen.getByRole('button', { name: 'Choose preview music' }));
    expect(screen.getByRole('button', { name: 'Mausam Aaj Tak' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Use my own music file…' })).toBeInTheDocument();
    expect(screen.getByLabelText('Your own music file')).toHaveAttribute('type', 'file');
    fireEvent.keyDown(hud, { key: 'Escape' }); expect(drive.get().session).toBeNull();
  });
});
