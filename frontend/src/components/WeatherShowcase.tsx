import { useEffect, useRef, useState } from "react";
import { getWeatherHotspot } from "../api/client";
import type { AvailableHotspot, HotspotExample, HotspotTrip } from "../api/types";
import { useServerWake } from "../state/serverWake";
import { number } from "../lib/fmt";
import { localTime, zonedToUtc } from "../lib/time";
import { WeatherIcon } from "./WeatherIcon";
import { Modal } from "./Modal";
import { Icon } from "./Icon";

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
  const [hotspot, setHotspot] = useState<AvailableHotspot | null>(null);
  const [open, setOpen] = useState(false), [selected, setSelected] = useState(0);
  const [hint, setHint] = useState<"glow" | "tip" | null>(null);
  const busyRef = useRef(busy), autoOpenRef = useRef(autoOpen);
  useEffect(() => { busyRef.current = busy; }, [busy]);
  useEffect(() => {
    if (wake.status !== "ready") return;
    const controller = new AbortController();
    void getWeatherHotspot(controller.signal, demo).then(data => {
      if (controller.signal.aborted || !data.available) return;
      setHotspot(data);
      if (autoOpenRef.current && !busyRef.current && !shownToday()) { rememberShown(); setOpen(true); }
    }).catch(() => { /* Optional demo helper: never interrupt planning on failure. */ });
    return () => controller.abort();
  }, [wake.status, demo]);
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
  return <>
    {hotspot && <div className="showcase-trigger">
      <button type="button" className="button secondary showcase-button" data-hint={hint ?? undefined} aria-describedby={hint === "tip" ? "showcase-tip" : undefined} disabled={busy} onClick={() => { rememberHint(); setHint(null); setSelected(0); setOpen(true); }}>
        <Icon name="rain" size={20} />Today's toughest weather
      </button>
      {hint === "tip" && <span id="showcase-tip" role="tooltip" className="showcase-tip">Plan a real trip through today's worst US weather</span>}
    </div>}
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
