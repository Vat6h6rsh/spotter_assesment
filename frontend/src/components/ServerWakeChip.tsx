import { useEffect, useState } from "react";
import { serverWake, useServerWake } from "../state/serverWake";
import { usePlanner } from "../state/planner";
import { WaitingRoad } from "./WaitingRoad";
import { useElapsed } from "../lib/useElapsed";
const tips = [
  "We check the forecast for the hour your truck reaches each checkpoint, not just the weather right now.",
  "Wind is rated by the stronger of gusts and sustained wind, unless you switch to sustained in More options.",
  "Cargo weight matters: above 40,000 lb, 35 mph winds rate Severe; above 30,000 lb, 45 mph winds rate No Travel.",
  "Missing weather shows as Unknown — never as safe.",
  "Rain and snow slow your arrival, so the forecast hour for later checkpoints shifts with them.",
  "Truck routes come from TomTom, using your rig's weight.",
];
export function ServerWakeChip() {
  const wake = useServerWake();
  return wake.status === "waking" && wake.slow ? <div className="server-wake-chip">Waking up the server…</div> : null;
}
export function ServerWakeCard() {
  const wake = useServerWake();
  const { phase } = usePlanner();
  const seconds = useElapsed(wake.startedAt, wake.status === "waking");
  const [paused, setPaused] = useState(false);
  const [tip, setTip] = useState(0);
  const [dismissed, setDismissed] = useState<number | null>(null);
  const queued = phase === "routes" || phase === "weather";
  const visible = seconds >= 8 && wake.startedAt !== null && dismissed !== wake.startedAt;
  useEffect(() => {
    if (!visible || paused || wake.status !== "waking") return;
    const timer = setInterval(() => setTip((value) => (value + 1) % tips.length), 8000);
    return () => clearInterval(timer);
  }, [visible, paused, wake.status]);
  useEffect(() => {
    if (wake.status !== "ready" || wake.startedAt === null) return;
    const timer = setTimeout(() => setDismissed(wake.startedAt), 400);
    return () => clearTimeout(timer);
  }, [wake.status, wake.startedAt]);
  const announcement = wake.status === "unavailable" ? "The server didn't answer. Nothing is wrong with your trip."
    : wake.status === "ready" && wake.startedAt !== null ? "The server is ready."
    : wake.status === "waking" && seconds >= 45 ? "Taking a little longer than usual. Still trying — you can keep this tab open."
    : wake.status === "waking" && seconds >= 8 ? "Waking up the server. You can fill in your trip meanwhile." : "";
  return <>
    <div className="sr-only" role="status" aria-live="polite">{announcement}</div>
    {(visible || wake.status === "unavailable") && <section className={`server-wake-card ${wake.status === "ready" ? "is-ready" : ""} ${paused ? "is-paused" : ""}`} aria-label="Server startup">
      <div className="waiting-heading"><h2>Waking up the server</h2><span className="num" aria-hidden="true">{seconds} s</span></div>
      <p>{wake.status === "unavailable" ? "The server didn't answer. Nothing is wrong with your trip." : seconds >= 45 ? "Taking a little longer than usual. Still trying — you can keep this tab open." : `Our free server naps when nobody's using it, so the first visit takes up to a minute. You can fill in your trip meanwhile${queued ? "; it will run the moment the server is ready" : ""}.`}</p>
      <WaitingRoad compact paused={paused || wake.status !== "waking"} />
      <span className="fine-print" id="wake-estimate">Usually under a minute</span>
      <div className={`wake-estimate ${seconds >= 50 && wake.status === "waking" ? "is-indeterminate" : ""}`} role="progressbar" aria-labelledby="wake-estimate" aria-valuetext={wake.status === "ready" ? "The server is ready" : wake.status === "unavailable" ? "The server did not answer" : `Waking the server, ${seconds} seconds so far`}>
        <span style={{ width: `${wake.status === "ready" ? 100 : 90 * (1 - (1 - Math.min(seconds / 50, 1)) ** 2)}%` }} />
      </div>
      <p className="waiting-tip fine-print" key={tip}>{tips[tip]}</p>
      <div className="waiting-actions">
        {wake.status === "unavailable" && <button className="button primary" onClick={() => { void serverWake.retry(); }}>Try again</button>}
        <button className="text-button" onClick={() => setPaused(!paused)}>{paused ? "Play animation" : "Pause animation"}</button>
      </div>
    </section>}
  </>;
}
