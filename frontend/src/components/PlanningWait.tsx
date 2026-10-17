import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { planner, usePlanner } from "../state/planner";
import { useServerWake } from "../state/serverWake";
import { WaitingRoad } from "./WaitingRoad";
import { useElapsed } from "../lib/useElapsed";
import type { PlanRequest } from "../api/types";
function planningSteps(inputs: PlanRequest) {
  return ["Finding your start and end points", "Getting truck routes from TomTom",
    `Placing weather checkpoints every ${inputs.spacing_mi} mi`, "Fetching hourly forecasts for each checkpoint",
    `Rating wind, rain and snow for your ${inputs.cargo_lb.toLocaleString("en-US")} lb load`, "Ranking routes and picking the safest"];
}
function Narration({ inputs, startedAt, waking, announce }: { inputs: PlanRequest; startedAt: number; waking: boolean; announce: (message: string) => void }) {
  const [step, setStep] = useState(0);
  const [shown, setShown] = useState(false);
  const [paused, setPaused] = useState(false);
  const seconds = useElapsed(startedAt);
  useEffect(() => {
    const timer = setTimeout(() => setShown(true), 500);
    return () => clearTimeout(timer);
  }, []);
  useEffect(() => {
    if (waking || step >= 3) return;
    const timer = setInterval(() => setStep((value) => Math.min(value + 1, 3)), 1200);
    return () => clearInterval(timer);
  }, [waking, step]);
  const steps = planningSteps(inputs);
  const message = !shown ? "Planning your trip" : waking ? "Waiting for the server to wake up (usually under a minute)" : steps[step];
  useEffect(() => { announce(message); }, [announce, message]);
  const map = shown ? document.querySelector(".map-region") : null;
  return <>

    {map && createPortal(<div className="planning-wait-overlay">
      <section className={`planning-wait-card ${paused ? "is-paused" : ""}`} aria-label="Trip planning">
        <h2>Planning {inputs.origin.label.split(",")[0].trim()} → {inputs.destination.label.split(",")[0].trim()}</h2>
        <WaitingRoad paused={paused} />
        {waking ? <p>Waiting for the server to wake up (usually under a minute)</p> : <ol className="planning-steps">{steps.map((text, index) => <li key={text} className={index === step ? "is-current" : index > step ? "is-next" : "is-earlier"} aria-current={index === step ? "step" : undefined}>
          <span className={index === step ? "spinner" : "step-dot"} aria-hidden="true" /><span>{text}{index > step && <span className="fine-print"> · next</span>}</span>
        </li>)}</ol>}
        {seconds >= 25 && <p className="fine-print">Taking longer than usual. Long routes have more checkpoints to check.</p>}
        <div className="waiting-actions">{seconds >= 10 && <><span className="num" aria-hidden="true">{seconds} s</span><button className="text-button" onClick={() => planner.cancel()}>Cancel</button></>}
          <button className="text-button" onClick={() => setPaused(!paused)}>{paused ? "Play animation" : "Pause animation"}</button>
        </div>
      </section>
    </div>, map)}
  </>;
}
export function PlanningWait() {
  const { submitted, startedAt, phase, plan } = usePlanner();
  const wake = useServerWake();
  const [announcement, announce] = useState("");
  const busy = phase === "routes" || phase === "weather";
  return <>
    {busy && submitted && startedAt !== null && <Narration key={startedAt} inputs={submitted} startedAt={startedAt} waking={wake.status === "waking"} announce={announce} />}
    <div className="sr-only" role="status" aria-live="polite">{phase === "heatmap" && plan ? `Weather checked at ${plan.routes.reduce((n, r) => n + r.checkpoints.length, 0)} checkpoints. Building corridor heatmap…` : busy ? announcement : ""}</div>
  </>;
}
