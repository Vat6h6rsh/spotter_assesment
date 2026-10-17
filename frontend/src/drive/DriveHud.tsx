import { useEffect, useRef, useState } from 'react';
import { IconPlayerPauseFilled, IconPlayerPlayFilled, IconPlayerSkipForward, IconVolume, IconVolumeOff, IconX, IconCurrentLocation, IconChevronDown, IconTruckFilled, IconBolt, IconPlayerTrackNext } from '@tabler/icons-react';
import { timeline, usePlaying } from '../state/timeline';
import { duration, localTime } from '../lib/time';
import { number } from '../lib/fmt';
import { checkpointPlaceLabel } from '../lib/checkpointPlace';
import { drive, useDrive } from './state';
import { previewAudio } from './audio';
import { TruckCredit } from './credits';
import './drive.css';

// Founder decision: Satie plays on Play; the HUD offers a remembered mute preference.
const MUTE_KEY = 'spotter.drive.muted';
const TRACKS = { satie: '/audio/gnossienne-no-1.mp3', aajtak: '/audio/mausam-aaj-tak.mp3' } as const;
function readMuted() { try { return localStorage.getItem(MUTE_KEY) === '1'; } catch { return false; } }
function saveMuted(value: boolean) { try { localStorage.setItem(MUTE_KEY, value ? '1' : '0'); } catch { /* storage unavailable */ } }

export function DriveHud() {
  const state = useDrive();
  return <DriveHudContent key={state.session?.id ?? 'idle'} />;
}
function DriveHudContent() {
  const state = useDrive(), playing = usePlaying(), session = state.session;
  const clock = useRef<HTMLSpanElement>(null), place = useRef<HTMLSpanElement>(null), restBadge = useRef<HTMLSpanElement>(null), file = useRef<HTMLInputElement>(null);
  const audio = useRef<ReturnType<typeof previewAudio> | null>(null);
  const [muted, setMuted] = useState(readMuted), [menu, setMenu] = useState(false), [track, setTrack] = useState<'satie' | 'aajtak' | 'own'>('satie');
  const mutedRef = useRef(muted);
  useEffect(() => { mutedRef.current = muted; }, [muted]);
  const hud = useRef<HTMLDivElement>(null);
  useEffect(() => {
    drive.restoreSpeed();
  }, []);
  useEffect(() => {
    if (!session) return;
    const sound = previewAudio(); audio.current = sound;
    // Play was a user gesture, so the browser allows sound to start right away.
    if (!mutedRef.current) sound.unmute(true);
    let previous = performance.now();
    const stop = timeline.onFrame((hour, now) => {
      const seconds = Math.max(0, Math.min(session.route.total_s, (hour - session.start) * 3600));
      const hours = Math.floor(seconds / 3600), minutes = Math.floor(seconds % 3600 / 60);
      if (clock.current) clock.current.textContent = `+${hours} h ${String(minutes).padStart(2, '0')} m`;
      const cp = session.route.checkpoints.findLast(point => point.elapsed_s <= seconds) ?? session.route.checkpoints[0];
      if (place.current) place.current.textContent = checkpointPlaceLabel(cp);
      const rest = session.route.rests.find(point => { const start = (Date.parse(point.start_utc) - Date.parse(session.plan.inputs.departure_utc)) / 1000; return seconds >= start && seconds < start + point.duration_s; });
      if (restBadge.current) { restBadge.current.hidden = !rest; restBadge.current.textContent = rest ? `Resting · ${duration(rest.duration_s)}` : ''; }
      const pending = sound.tick(Math.min(.1, (now - previous) / 1000), timeline.isPlaying(), drive.get().phase === 'outro'); previous = now;
      return pending;
    });
    const resume = timeline.subscribePlay(() => { if (timeline.isPlaying()) sound.resume(); });
    return () => { stop(); resume(); sound.finish(); audio.current = null; };
  }, [session]);
  useEffect(() => {
    if (!session) return;
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); drive.end(); return; }
      const target = event.target as HTMLElement;
      if (target.closest('input, textarea, select, [contenteditable="true"]')) return;
      // Space/arrow shortcuts are scoped to the HUD or map; normal UI controls retain their keys.
      if (!target.closest('.drive-hud, .maplibregl-canvas') && target !== document.body) return;
      if (event.key === ' ' && !target.closest('button')) { event.preventDefault(); timeline.play(!timeline.isPlaying()); }
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); drive.scrub(); timeline.set(Math.max(session.start, Math.min(session.end, timeline.get() + (event.key === 'ArrowLeft' ? -1 : 1)))); }
    };
    document.addEventListener('keydown', keyboard);
    return () => document.removeEventListener('keydown', keyboard);
  }, [session]);
  useEffect(() => {
    if (!menu) return;
    const close = (event: PointerEvent) => { if (!hud.current?.contains(event.target as Node)) setMenu(false); };
    document.addEventListener('pointerdown', close); return () => document.removeEventListener('pointerdown', close);
  }, [menu]);
  useEffect(() => {
    if (!state.summary) return;
    const timeout = setTimeout(() => drive.dismissSummary(), 10000);
    return () => clearTimeout(timeout);
  }, [state.summary]);
  if (!session) return state.summary && <div className="drive-complete" role="status">
    <IconTruckFilled size={20} aria-hidden="true" /><div><strong>Trip complete · Route {state.summary.id}</strong><span className="drive-verdict" data-blocked={state.summary.risk.miles_by_level.no_travel > 0}>{state.summaryVerdict}</span>{state.summaryAdvice && <span className="drive-summary-advice">{state.summaryAdvice}</span>}<span className="num">Arrive {localTime(state.summary.arrival_utc, state.summary.arrival_tz)} · {number(state.summary.risk.miles_by_level.severe)} Severe mi · {number(state.summary.risk.miles_by_level.no_travel)} No Travel mi · {duration(state.summary.weather_delay_s ?? 0)} weather delay</span></div>
    <button type="button" className="icon-button" aria-label="Dismiss trip summary" onClick={() => drive.dismissSummary()}><IconX size={20} /></button>
  </div>;
  const chooseTrack = (value: keyof typeof TRACKS) => {
    setTrack(value); setMenu(false);
    audio.current?.select(TRACKS[value]);
  };
  return <div className="drive-overlay">
    {state.phase === 'intro' && !matchMedia('(prefers-reduced-motion: reduce)').matches && <div className="drive-title" role="status" style={{ animationPlayState: playing ? 'running' : 'paused' }}>
      <strong className="drive-title-band">Mausam · {session.plan.inputs.origin.label.split(',').slice(0, 2).join(',')} → {session.plan.inputs.destination.label.split(',').slice(0, 2).join(',')}</strong>
      <div><span className="route-letter">{session.route.id}</span><strong>{session.route.label}</strong><time dateTime={session.plan.inputs.departure_utc}>Depart {localTime(session.plan.inputs.departure_utc, session.plan.inputs.origin_tz)}</time></div>
    </div>}
    {!state.follow && <button type="button" className="button secondary drive-follow" onClick={() => drive.follow(true)}><IconCurrentLocation size={16} />Follow truck</button>}
    <div className="drive-hud" ref={hud} role="region" aria-label="Drive preview controls" tabIndex={0}>
      <div className="drive-route"><span className="route-letter">{session.route.id}</span><div><strong>{session.route.label}</strong><span ref={place}>{checkpointPlaceLabel(session.route.checkpoints[0])}</span></div></div>
      <div className="drive-time"><span ref={clock} className="num">+0 h 00 m</span><span ref={restBadge} className="drive-rest" hidden /></div>
      <div className="drive-buttons">
        <div className="drive-speeds" role="group" aria-label="Preview speed">
          {([1, 2, 4] as const).map(speed => <button type="button" key={speed} aria-label={`${speed}× speed`} aria-pressed={state.speed === speed} onClick={() => drive.speed(speed)}>{speed === 1 ? <IconPlayerPlayFilled size={12} /> : speed === 2 ? <IconPlayerTrackNext size={12} /> : <IconBolt size={12} />}<span>{speed}×</span></button>)}
        </div>
        <button type="button" className="icon-button" aria-label={playing ? 'Pause drive preview' : 'Resume drive preview'} title={playing ? 'Pause (Space)' : 'Resume (Space)'} disabled={state.phase === 'outro'} onClick={() => timeline.play(!playing)}>{playing ? <IconPlayerPauseFilled size={20} /> : <IconPlayerPlayFilled size={20} />}</button>
        <button type="button" className="icon-button" aria-label="Skip to arrival" title="Skip to arrival" onClick={() => drive.skip()}><IconPlayerSkipForward size={20} /></button>
        <div className="drive-music">
          <button type="button" className="icon-button" aria-label={muted ? 'Unmute preview music' : 'Mute preview music'} title={muted ? 'Unmute music' : 'Mute music'} aria-pressed={muted} onClick={() => { audio.current?.unmute(muted); saveMuted(!muted); setMuted(!muted); timeline.requestFrame(); }}>{muted ? <IconVolumeOff size={20} /> : <IconVolume size={20} />}</button>
          <button type="button" className="drive-music-menu" aria-label="Choose preview music" aria-expanded={menu} onClick={() => setMenu(!menu)}><IconChevronDown size={16} /></button>
          {menu && <div className="drive-track-menu" role="group" aria-label="Music track">
            <button type="button" aria-pressed={track === 'satie'} onClick={() => chooseTrack('satie')}>Gnossienne No. 1 · Erik Satie</button>
            <button type="button" aria-pressed={track === 'aajtak'} onClick={() => chooseTrack('aajtak')}>Mausam Aaj Tak</button>
            <button type="button" onClick={() => { file.current?.click(); setMenu(false); }}>Use my own music file…</button>
            <span className="fine-print">Your own file stays on this device.</span>
          </div>}
          <input ref={file} type="file" accept="audio/*" className="sr-only" aria-label="Your own music file" onChange={event => { const picked = event.currentTarget.files?.[0]; if (picked) { audio.current?.file(picked); setTrack('own'); } event.currentTarget.value = ''; }} />
        </div>
        <button type="button" className="icon-button" aria-label="Close drive preview" title="Close (Esc)" onClick={() => drive.end()}><IconX size={20} /></button>
      </div>
    </div>
    {state.model && <p className="drive-credits fine-print"><TruckCredit /></p>}
  </div>;
}
