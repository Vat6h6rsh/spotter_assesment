import { useSyncExternalStore } from 'react';
import type { Plan, Route } from '../api/types';
import { timeline } from '../state/timeline';
import { departureHour, forecastBase, previewPacing } from './math';
export interface DriveSession { id: number; plan: Plan; route: Route; base: string; start: number; end: number; pacing: number }
interface DriveState { session: DriveSession | null; speed: 1 | 2 | 4; phase: 'idle' | 'intro' | 'chase' | 'outro'; follow: boolean; model: boolean; summary: Route | null; summaryVerdict: string | null; summaryAdvice: string | null }
let state: DriveState = { session: null, speed: 1, phase: 'idle', follow: true, model: false, summary: null, summaryVerdict: null, summaryAdvice: null };
const listeners = new Set<() => void>();
let scrubUntil = 0, scrubbing = false;
let sequence = 0;
const update = (patch: Partial<DriveState>) => { state = { ...state, ...patch }; listeners.forEach(fn => fn()); timeline.requestFrame(); };
export const drive = {
  get: () => state,
  subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },
  start(plan: Plan, route: Route, base = forecastBase(plan)) {
    if (state.session) drive.end();
    const start = departureHour(plan, base), end = start + route.total_s / 3600, pacing = previewPacing(route.total_s);
    timeline.configure({ max: end, msPerHour: pacing / state.speed, held: true });
    timeline.set(start);
    update({ session: { id: ++sequence, plan, route, base, start, end, pacing }, phase: 'intro', follow: true, model: false, summary: null, summaryVerdict: null, summaryAdvice: null });
    timeline.play(true);
  },
  chase() { if (!state.session) return; update({ phase: 'chase' }); timeline.configure({ held: false }); },
  speed(value: 1 | 2 | 4) {
    update({ speed: value });
    try { localStorage.setItem('spotter.drive.speed', String(value)); } catch { /* Optional preference. */ }
    if (state.session) timeline.configure({ msPerHour: state.session.pacing / value });
  },
  restoreSpeed() { try { const value = Number(localStorage.getItem('spotter.drive.speed')); if (value === 1 || value === 2 || value === 4) update({ speed: value }); } catch { /* Optional preference. */ } },
  follow(value: boolean) { update({ follow: value }); },
  model(value: boolean) { update({ model: value }); },
  scrub(active?: boolean) { if (active !== undefined) scrubbing = active; scrubUntil = performance.now() + 250; },
  isScrubbing: () => scrubbing || performance.now() < scrubUntil,
  skip() { if (!state.session) return; timeline.set(state.session.end); update({ phase: 'outro' }); timeline.play(false); },
  outro() { update({ phase: 'outro' }); timeline.play(false); },
  end(complete = false) {
    const summary = complete ? state.session?.route ?? null : null;
    const summaryVerdict = !summary ? null : summary.risk.miles_by_level.no_travel > 0 ? 'Blocked: No Travel crossed' : state.session?.plan.recommendation.route_id === summary.id ? 'Recommended route' : summary.eligible ? 'Alternative route' : 'Weather data incomplete';
    const recommendation = state.session?.plan.recommendation, advice = recommendation?.departure_advice;
    const pick = state.session?.plan.routes.find(route => route.id === recommendation?.route_id && route.eligible && route.risk.miles_by_level.no_travel === 0);
    const summaryAdvice = !summary || summary.risk.miles_by_level.no_travel === 0 ? null : advice ? `Leave ${advice.offset_h} h later on Route ${advice.route_id}` : pick ? `Take Route ${pick.id}` : null;
    timeline.play(false); timeline.configure({ max: 48, msPerHour: 1200, held: false });
    timeline.set(Math.min(48, timeline.get())); scrubbing = false; scrubUntil = 0;
    update({ session: null, phase: 'idle', model: false, summary, summaryVerdict, summaryAdvice });
  },
  dismissSummary() { update({ summary: null, summaryVerdict: null, summaryAdvice: null }); },
};
export const useDrive = () => useSyncExternalStore(drive.subscribe, drive.get);
