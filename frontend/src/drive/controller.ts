import type { Map } from 'maplibre-gl';
import { timeline } from '../state/timeline';
import { prepareGeometry, pointAtDistance } from '../lib/geometry';
import type { Coordinate } from '../lib/geometry';
import { programmaticCamera } from '../map/camera';
import { easeOutCubic } from '../map/paint';
import { drive } from './state';
import type { DriveSession } from './state';
import { clamp, motionPolicy, routePose, selectCardTriggers, smoothBearing, speedToZoom, tripBounds } from './math';
import { loadTruck } from './loadTruck';
import type { TruckRenderer } from './loadTruck';
import { monuments } from './monuments';

export function createDriveController(map: Map, session: DriveSession, padding: () => { top: number; bottom: number; left: number; right: number }, announce: (text: string) => void) {
  const geometry = prepareGeometry(session.route), triggers = selectCardTriggers(session.plan, session.route);
  const policy = motionPolicy(matchMedia('(prefers-reduced-motion: reduce)').matches);
  const saved = { center: [map.getCenter().lng, map.getCenter().lat] as Coordinate, zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing() };
  const abort = new AbortController(), cards = monuments(map, session, announce);
  let renderer: TruckRenderer | null = null, disposed = false, started = performance.now(), outroStart = 0, previous = started;
  let lastElapsed = -1, revision = timeline.revision(), wasFollowing = true, lastPop = -Infinity;
  let center = routePose(geometry, 0).position, angle = routePose(geometry, 0).heading, zoom = speedToZoom(center[1], routePose(geometry, 0).mph, drive.get().speed, session.pacing);
  const seen = new Set<string>(), queue: typeof triggers = [];
  const move = (reason: 'drive-intro' | 'drive-chase' | 'drive-outro' | 'drive-restore', action: () => void) => programmaticCamera(reason, action);
  const chasePadding = () => {
    const base = padding(), height = map.getContainer().clientHeight;
    return { ...base, top: Math.max(base.top, height * .24), bottom: Math.max(base.bottom, 120) };
  };
  if (policy.follow) move('drive-intro', () => map.flyTo({ center, bearing: angle, pitch: policy.pitch, zoom, padding: chasePadding(), duration: policy.introMs, curve: 1.2, easing: easeOutCubic, essential: false }));
  if (policy.three) void loadTruck(abort.signal).then(value => {
    if (disposed) { value?.dispose(); return; }
    renderer = value;
    const pose = routePose(geometry, clamp((timeline.get() - session.start) * 3600, 0, session.route.total_s));
    renderer?.set(pose.position, pose.heading);
    // isStyleLoaded() is false while newly added routes/images are being processed.
    // The style already exists and accepts custom layers during that interval.
    if (renderer && map.getStyle()) {
      try { map.addLayer(renderer.layer); drive.model(true); }
      catch { renderer.dispose(); renderer = null; }
    }
    timeline.requestFrame();
  });
  const media = matchMedia('(prefers-reduced-motion: reduce)');
  const motionChange = () => { if (media.matches) drive.end(); };
  media.addEventListener('change', motionChange);
  const visibility = () => { if (document.hidden) timeline.play(false); };
  document.addEventListener('visibilitychange', visibility);
  let pausedAt = 0;
  const stopPlay = timeline.subscribePlay(() => {
    if (drive.get().phase !== 'intro') return;
    if (!timeline.isPlaying()) { pausedAt = performance.now(); if (policy.follow) map.stop(); }
    else if (pausedAt) {
      const now = performance.now(); started += now - pausedAt; pausedAt = 0;
      if (policy.follow && drive.get().follow) move('drive-intro', () => map.flyTo({ center, bearing: angle, pitch: policy.pitch, zoom, padding: chasePadding(), duration: Math.max(0, policy.introMs - (now - started)) }));
    }
  });
  return {
    install() {
      if (renderer && !map.getLayer(renderer.layer.id)) {
        try { map.addLayer(renderer.layer); drive.model(true); }
        catch { renderer.dispose(); renderer = null; drive.model(false); }
      }
    },
    frame(hour: number, now: number) {
      if (disposed) return false;
      const state = drive.get(), elapsed = clamp((hour - session.start) * 3600, 0, session.route.total_s), pose = routePose(geometry, elapsed);
      const dt = clamp((now - previous) / 1000, 0, .1); previous = now;
      const scrubbed = revision !== timeline.revision(); revision = timeline.revision();
      const moving = timeline.isPlaying() && state.phase === 'chase' && pose.mph > 0;
      renderer?.set(pose.position, pose.heading, moving ? .015 * Math.sin(now * .008) : 0);
      if (renderer) map.triggerRepaint();
      if (state.phase === 'intro') {
        // Pause also holds the swoop clock; Resume continues from the same point.
        if ((timeline.isPlaying() && now - started >= policy.introMs) || scrubbed) drive.chase();
      }
      if (state.phase === 'outro' || elapsed >= session.route.total_s) {
        if (!outroStart) {
          outroStart = now; drive.outro();
          if (policy.follow) move('drive-outro', () => map.fitBounds(tripBounds(session.plan), { padding: padding(), pitch: 0, bearing: 0, duration: policy.outroMs, easing: easeOutCubic }));
        }
        cards.tick(now);
        if (now - outroStart >= policy.outroMs) drive.end(true);
        return true;
      }
      if (policy.follow && state.follow && (state.phase === 'chase' || scrubbed)) {
        const targetZoom = speedToZoom(pose.position[1], pose.mph || 55, state.speed, session.pacing);
        const metresPerPx = 78271.517 * Math.cos(pose.position[1] * Math.PI / 180) / 2 ** zoom;
        const distance = pose.mi / (geometry.distance || 1) * geometry.prefix.at(-1)!;
        const ahead = pointAtDistance(geometry.points, geometry.prefix, distance + 80 * metresPerPx / 1609.344);
        if (scrubbed || !wasFollowing) { center = ahead; angle = pose.heading; zoom = targetZoom; }
        else if (timeline.isPlaying()) {
          const alpha = 1 - Math.exp(-dt / .25);
          center = [center[0] + (ahead[0] - center[0]) * alpha, center[1] + (ahead[1] - center[1]) * alpha];
          angle = smoothBearing(angle, pose.heading, dt, state.speed);
          zoom += clamp((targetZoom - zoom) * (1 - Math.exp(-dt / 1.5)), -.3 * dt, .3 * dt);
        }
        if (timeline.isPlaying() || scrubbed || !wasFollowing) move('drive-chase', () => map.jumpTo({ center, bearing: angle, pitch: policy.pitch, zoom, padding: chasePadding() }));
      }
      wasFollowing = state.follow;
      if (scrubbed) {
        cards.clear(); queue.length = 0; seen.clear();
        triggers.filter(trigger => trigger.elapsed <= elapsed).forEach(trigger => seen.add(trigger.id));
        const nearest = triggers.reduce<typeof triggers[number] | null>((best, trigger) => !best || Math.abs(trigger.elapsed - elapsed) < Math.abs(best.elapsed - elapsed) ? trigger : best, null);
        if (nearest) queue.push(nearest);
      } else {
        for (const trigger of triggers) if (trigger.elapsed <= elapsed && trigger.elapsed > lastElapsed && !seen.has(trigger.id)) { queue.push(trigger); seen.add(trigger.id); }
      }
      if (!drive.isScrubbing() && queue.length && now - lastPop >= 1500) { cards.show(queue.shift()!, now); lastPop = now; }
      lastElapsed = elapsed;
      const cardPending = cards.tick(now);
      return (state.phase === 'intro' && timeline.isPlaying()) || cardPending || queue.length > 0;
    },
    dispose(restore: boolean) {
      if (disposed) return;
      disposed = true; abort.abort(); cards.clear();
      stopPlay();
      media.removeEventListener('change', motionChange); document.removeEventListener('visibilitychange', visibility);
      if (map.getLayer('drive-truck')) map.removeLayer('drive-truck');
      renderer?.dispose(); renderer = null;
      map.stop();
      if (restore && policy.follow) move('drive-restore', () => map.jumpTo(saved));
    },
  };
}
export type DriveController = ReturnType<typeof createDriveController>;
