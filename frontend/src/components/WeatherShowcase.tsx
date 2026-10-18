import { useEffect, useRef, useState } from "react";
import { getWeatherHotspot } from "../api/client";
import type { AvailableHotspot, HotspotExample, HotspotTrip } from "../api/types";
import { useServerWake } from "../state/serverWake";
import { number } from "../lib/fmt";
import { localTime, zonedToUtc } from "../lib/time";
import { WeatherIcon } from "./WeatherIcon";
import { Modal } from "./Modal";
import { Icon } from "./Icon";
import { WaitingRoad } from "./WaitingRoad";
import { useElapsed } from "../lib/useElapsed";

const scanSteps = [
  "Picking 300 points along 30 freight corridors",
  "Fetching 48-hour forecasts and National Weather Service alerts",
  "Ranking the toughest stretches",
  "Planning a real trip through the worst one to check it",
];
const wakingMessage = "Waiting for the server to wake up first (usually under a minute).";
function scanStep(startedAt: number | null) {
  const elapsed = startedAt === null ? 0 : Date.now() - startedAt;
  return elapsed < 1200 ? 0 : elapsed < 20_000 ? 1 : 3;
}
/** Timed narration describes expected work, never confirmed completions. */
function ShowcaseWait({ startedAt, retry }: { startedAt: number | null; retry: () => void }) {
  const [step, setStep] = useState(() => scanStep(startedAt));
  const [paused, setPaused] = useState(false);
  const seconds = useElapsed(startedAt);
  useEffect(() => {
    if (startedAt === null) return;
    const timers = [1200, 20_000].filter(ms => startedAt + ms > Date.now()).map(ms =>
      setTimeout(() => setStep(scanStep(startedAt)), Math.max(0, startedAt + ms - Date.now())));
    return () => timers.forEach(clearTimeout);
  }, [startedAt]);
  return <div className="showcase-wait">
    <p>{startedAt === null ? wakingMessage : "Scanning US freight corridors for the toughest weather in the next 48 hours."}</p>
    <WaitingRoad compact paused={paused} />
    {startedAt !== null && <ol className="planning-steps">{scanSteps.map((text, index) => <li key={text} className={index === step ? "is-current" : index > step ? "is-next" : "is-earlier"} aria-current={index === step ? "step" : undefined}>
      <span className={index === step ? "spinner" : "step-dot"} aria-hidden="true" /><span>{text}{index > step && <span className="fine-print"> · next</span>}</span>
    </li>)}</ol>}
    <div className="sr-only" role="status" aria-live="polite">{startedAt === null ? wakingMessage : scanSteps[step]}</div>
    <div className="waiting-actions">
      {seconds >= 5 && <span className="num" aria-hidden="true">{seconds} s</span>}
      <button type="button" className="text-button" onClick={() => setPaused(!paused)}>{paused ? "Play animation" : "Pause animation"}</button>
    </div>
    <p className="fine-print">The first check can take up to a minute. After that it's saved for an hour.</p>
    {seconds >= 50 && <p className="fine-print">Taking longer than usual. Still checking.</p>}
    {seconds >= 60 && <button type="button" className="button primary" onClick={retry}>Try again</button>}
  </div>;
}

export const SHOWCASE_DATE_KEY = "spotter.weather.showcase.date";
let shownWithoutStorage = "";
/** The button hint (glow, then a 1.5 s tooltip) plays once per browser-tab session. */
export const SHOWCASE_HINT_KEY = "spotter.weather.showcase.hinted";
const HINT_GLOW_MS = 600, HINT_TOOLTIP_MS = 1500;
let hintedWithoutStorage = false;
function today() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function shownToday() {
  try { return localStorage.getItem(SHOWCASE_DATE_KEY) === today(); }
  catch { return shownWithoutStorage === today(); }
}
function hintPlayed() {
  try { return sessionStorage.getItem(SHOWCASE_HINT_KEY) === "1"; }
  catch { return hintedWithoutStorage; }
}
function rememberHint() {
  hintedWithoutStorage = true;
  try { sessionStorage.setItem(SHOWCASE_HINT_KEY, "1"); } catch { /* Module fallback when storage is blocked. */ }
}
/** The last good result for this tab, so a remounted form (Edit trip) keeps the button usable. */
export const SHOWCASE_LAST_KEY = "spotter.weather.showcase.last";
const LAST_MAX_AGE_MS = 3600_000;
let lastWithoutStorage: { at: number; data: AvailableHotspot } | null = null;
function lastHotspot(): AvailableHotspot | null {
  let saved = lastWithoutStorage;
  try { saved = JSON.parse(sessionStorage.getItem(SHOWCASE_LAST_KEY) || "null"); } catch { /* Module fallback. */ }
  return saved?.data?.available && Date.now() - saved.at < LAST_MAX_AGE_MS ? saved.data : null;
}
function rememberHotspot(data: AvailableHotspot) {
  lastWithoutStorage = { at: Date.now(), data };
  try { sessionStorage.setItem(SHOWCASE_LAST_KEY, JSON.stringify(lastWithoutStorage)); } catch { /* Module fallback when storage is blocked. */ }
}
function rememberShown() {
  shownWithoutStorage = today();
  try { localStorage.setItem(SHOWCASE_DATE_KEY, today()); } catch { /* Session fallback when storage is blocked. */ }
}

export function WeatherShowcase({ demo, busy, autoOpen = true, onPlan, onOwn }: {
  demo: boolean; busy: boolean; autoOpen?: boolean;
  onPlan: (trip: HotspotTrip) => void;
  onOwn: () => void;
}) {
  const wake = useServerWake();
  const [hotspot, setHotspot] = useState<AvailableHotspot | null>(lastHotspot);
  const [lookup, setLookup] = useState<{ attempt: number; status: "loading" | "done"; reason: string; startedAt: number | null }>({ attempt: 0, status: "loading", reason: "", startedAt: null });
  const [open, setOpen] = useState(false), [selected, setSelected] = useState(0);
  const [hint, setHint] = useState<"glow" | "tip" | null>(null);
  const busyRef = useRef(busy), autoOpenRef = useRef(autoOpen);
  useEffect(() => { busyRef.current = busy; }, [busy]);
  useEffect(() => {
    if (wake.status !== "ready") return;
    const controller = new AbortController();
    const first = lookup.attempt === 0;
    const startedAt = Date.now();
    // Publish the request's actual start asynchronously; StrictMode cleanup can cancel it first.
    void Promise.resolve().then(() => {
      if (!controller.signal.aborted) setLookup(current => ({ ...current, status: "loading", startedAt }));
    });
    void getWeatherHotspot(controller.signal, demo).then(data => {
      if (controller.signal.aborted) return;
      // An unavailable or failed refresh never hides a trip this tab already received.
      setLookup(current => ({ ...current, status: "done", reason: data.available ? "" : data.reason }));
      if (!data.available) return;
      setHotspot(data); rememberHotspot(data);
      if (first && autoOpenRef.current && !busyRef.current && !shownToday()) { rememberShown(); setOpen(true); }
    }).catch(() => {
      // Optional demo helper: never interrupt planning on failure.
      if (!controller.signal.aborted) setLookup(current => ({ ...current, status: "done", reason: "The weather check didn't respond. Try again in a minute." }));
    });
    return () => controller.abort();
  }, [wake.status, demo, lookup.attempt]);
  useEffect(() => {
    // Point the driver at the button once the auto-shown dialog (if any) is out of the way.
    if (!hotspot || open || busy || hintPlayed()) return;
    const glow = setTimeout(() => setHint("glow"), 0);
    const tip = setTimeout(() => setHint("tip"), HINT_GLOW_MS);
    const done = setTimeout(() => { rememberHint(); setHint(null); }, HINT_GLOW_MS + HINT_TOOLTIP_MS);
    return () => { clearTimeout(glow); clearTimeout(tip); clearTimeout(done); setHint(null); };
  }, [hotspot, open, busy]);
  const alternatives = (hotspot?.more ?? []).slice(0, 2);
  const examples: HotspotExample[] = hotspot ? [hotspot, ...alternatives] : [];
  const example = examples[selected] ?? hotspot;
  const trip = example?.suggested_trip;
  const checking = wake.status !== "unavailable" && lookup.status === "loading";
  const emptyReason = wake.status === "unavailable" ? "The server isn't responding right now. Try again in a minute." : lookup.reason;
  const retry = () => setLookup(current => ({ attempt: current.attempt + 1, status: "loading", reason: "", startedAt: null }));
  return <>
    <div className="showcase-trigger">
      <button type="button" className="button secondary showcase-button" data-hint={hint ?? undefined} aria-busy={checking && !hotspot ? true : undefined} aria-describedby={hint === "tip" ? "showcase-tip" : undefined} disabled={busy} onClick={() => { rememberHint(); setHint(null); setSelected(0); setOpen(true); }}>
        <Icon name="rain" size={20} />Today's toughest weather
        {checking && !hotspot && <span className="spinner" aria-hidden="true" />}
      </button>
      {hint === "tip" && <span id="showcase-tip" role="tooltip" className="showcase-tip">Plan a real trip through today's worst US weather</span>}
    </div>
    {open && !busy && !hotspot && <Modal title="Today's toughest trucking weather" closeLabel="Close weather showcase" className="weather-showcase" onClose={() => setOpen(false)}>
      {checking ? <ShowcaseWait key={`${lookup.attempt}-${lookup.startedAt}`} startedAt={wake.status === "waking" ? null : lookup.startedAt} retry={retry} /> : <p>No standout trucking weather to show right now.</p>}
      {!checking && emptyReason && <p className="fine-print">{emptyReason}</p>}
      <div className="showcase-actions">
        {!checking && <button type="button" className="button primary" onClick={retry}>Try again</button>}
        <button type="button" className="button secondary" onClick={() => setOpen(false)}>Close</button>
      </div>
    </Modal>}
    {open && !busy && example && trip && <Modal title="See today's toughest trucking weather" closeLabel="Close weather showcase" className="weather-showcase" onClose={() => setOpen(false)}>
      <div className="showcase-weather">
        <WeatherIcon icon={example.hazard === "wind" ? "wind" : example.hazard === "snow" ? "extreme-snow" : example.hazard === "rain" ? "extreme-rain" : "thunderstorms-rain"} size={80} />
        <div>{demo && <span className="demo-badge">Demo data</span>}<p><strong>{example.headline}</strong></p><p>{example.summary}</p></div>
      </div>
      <p>Plan a real trip through it to see how the app handles high-risk weather: risk levels, blocked routes, departure advice and the drive preview.</p>
      <p className="showcase-trip num">{trip.origin.label} → {trip.destination.label} · {number(trip.cargo_lb)} lb · leaves {localTime(zonedToUtc(trip.departure_local, trip.origin.tz), trip.origin.tz)}{trip.verified && <> · Expect {number(trip.verified.high_or_worse_mi)} mi of High+ weather</>}</p>
      {examples.length > 1 && <div className="showcase-alternatives" role="group" aria-label="Today's weather trips"><span className="fine-print">Also today:</span>{examples.map((item, index) => <button type="button" key={`${item.hazard}-${index}`} className="showcase-chip" aria-pressed={selected === index} onClick={() => setSelected(index)}>{item.headline} · {item.suggested_trip.corridor}</button>)}</div>}
      <div className="showcase-actions">
        <button type="button" className="button primary" onClick={() => { setOpen(false); onPlan(trip); }}>Plan this route</button>
        <button type="button" className="button secondary" onClick={() => { setOpen(false); setTimeout(onOwn, 0); }}>Plan my own trip</button>
      </div>
      <p className="fine-print showcase-source">Forecast: Open-Meteo · Alerts: National Weather Service</p>
    </Modal>}
  </>;
}
