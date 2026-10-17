import { useEffect, useId, useRef, useState } from "react";
import type { Heatmap, Plan, Route } from "../api/types";
import { elapsedAtHour, hourTimestamp, keyHour, localTime } from "../lib/time";
import { number } from "../lib/fmt";
import { timeline, usePlaying, useTimelineHour } from "../state/timeline";
import { severity } from "../lib/risk";
import { interpolateProgress } from "../lib/geometry";
import { Icon } from "./Icon";
import { checkpointPlaceLabel } from "../lib/checkpointPlace";
import { drive, useDrive } from "../drive/state";
import { preferences } from "../state/preferences";

const clockHelp =
  "Heat and trucks follow this time. Route risk is rated at each checkpoint's ETA.";

function forecastValueText(base: string, departure: string, zone: string, hour: number) {
  const at = hourTimestamp(base, hour);
  const offset = (at.getTime() - Date.parse(departure)) / 3_600_000;
  const date = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZone: zone,
  }).format(at);
  return `${date}, ${number(Math.abs(offset), offset % 1 ? 1 : 0)} ${Math.abs(offset) === 1 ? "hour" : "hours"} ${offset < 0 ? "before" : "after"} departure`;
}

function TimeReadout({
  base,
  zone,
  helpId,
  beyondHorizon,
}: {
  base: string;
  zone: string;
  helpId: string;
  beyondHorizon: boolean;
}) {
  const hour = useTimelineHour();
  const at = hourTimestamp(base, hour);
  return (
    <div className="time-readout" aria-live="off">
      <div className="clock-time">
        <time className="num" dateTime={at.toISOString()}>
          {localTime(at, zone)}
        </time>
        <span className="clock-info-wrap">
          <button
            type="button"
            className="icon-button clock-info"
            aria-label="About forecast time"
            title="About forecast time"
            aria-describedby={helpId}
          >
            <Icon name="info" size={16} />
          </button>
          <span className="clock-tooltip" id={helpId} role="tooltip">
            {clockHelp}
            {beyondHorizon && " Trip continues past +48 h. Checkpoints beyond the slider are still rated."}
          </span>
        </span>
      </div>
      <span className="time-offset num">
        +{number(hour, hour % 1 ? 1 : 0)} h
        {beyondHorizon && <span className="horizon-note"> · Trip continues past +48 h</span>}
      </span>
    </div>
  );
}

function PlayButton({ plan, selected, base }: { plan: Plan; selected?: string | null; base: string }) {
  const playing = usePlaying();
  return (
    <button
      type="button"
      className="play-button"
      aria-label={playing ? "Pause forecast" : "Play forecast"}
      title={playing ? "Pause forecast" : "Play forecast"}
      aria-pressed={playing}
      onClick={() => {
        if (drive.get().session || !preferences.get().drivePreview) timeline.play(!playing);
        else drive.start(plan, plan.routes.find(route => route.id === selected) ?? plan.routes[0], base);
      }}
    >
      <Icon name={playing ? "pause" : "play"} size={20} />
    </button>
  );
}

function Slider({
  base,
  departure,
  zone,
  max,
  helpId,
}: {
  base: string;
  departure: string;
  zone: string;
  max: number;
  helpId: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(
    () =>
      timeline.onFrame((hour) => {
        if (!input.current) return;
        input.current.value = String(hour);
        input.current.style.setProperty("--position", `${max ? (hour / max) * 100 : 0}%`);
        input.current.setAttribute(
          "aria-valuetext",
          forecastValueText(base, departure, zone, hour),
        );
      }),
    [base, departure, zone, max],
  );
  return (
    <div className="slider-wrap">
      <input
        ref={input}
        className="forecast-slider num"
        type="range"
        aria-label="Corridor forecast time"
        aria-describedby={helpId}
        aria-valuetext={forecastValueText(base, departure, zone, timeline.get())}
        min={0}
        max={max}
        step={drive.get().session ? 'any' : 1}
        defaultValue={timeline.get()}
        onPointerDown={(event) => { if (drive.get().session) { drive.scrub(true); event.currentTarget.setPointerCapture?.(event.pointerId); } }}
        onPointerUp={() => drive.scrub(false)}
        onPointerCancel={() => drive.scrub(false)}
        onLostPointerCapture={() => drive.scrub(false)}
        onBlur={() => drive.scrub(false)}
        onInput={(event) => { if (drive.get().session) drive.scrub(); timeline.set(Number(event.currentTarget.value)); }}
        onKeyDown={(event) => {
          if (
            [
              "ArrowLeft",
              "ArrowRight",
              "ArrowUp",
              "ArrowDown",
              "PageUp",
              "PageDown",
              "Home",
              "End",
            ].includes(event.key)
          ) {
            event.preventDefault();
            if (drive.get().session) drive.scrub();
            timeline.set(keyHour(event.key, Math.round(timeline.get()), max));
          }
        }}
      />
      <div className="slider-labels num" aria-hidden="true">
        {[0, 1, 2, 3, 4].map((tick) => {
          const hour = (max * tick) / 4;
          return <span key={tick}>{tick ? "+" : ""}{number(hour, hour % 1 ? 1 : 0)} h</span>;
        })}
      </div>
    </div>
  );
}

function checkpointAtTime(route: Route, elapsed: number) {
  const next = route.checkpoints.findIndex((cp) => cp.elapsed_s > elapsed);
  if (next === 0) return route.checkpoints[0];
  if (next === -1) return route.checkpoints.at(-1);
  return route.checkpoints[next - 1];
}

function JourneyPositions({ plan, base }: { plan: Plan; base: string }) {
  const list = useRef<HTMLUListElement>(null);
  useEffect(() => {
    const root = list.current;
    if (!root) return;
    const labels = Array.from(root.querySelectorAll<HTMLElement>("[data-position]"));
    const rests = plan.routes.map((route) =>
      route.rests.map((rest) => ({
        start: Date.parse(rest.start_utc),
        end: Date.parse(rest.start_utc) + rest.duration_s * 1000,
      })),
    );
    return timeline.onFrame((hour) => {
      const elapsed = elapsedAtHour(base, plan.inputs.departure_utc, hour),
        at = hourTimestamp(base, hour).getTime();
      plan.routes.forEach((route, index) => {
        const label = labels[index];
        if (!label) return;
        const mi = interpolateProgress(route.progress, elapsed);
        label.textContent =
          elapsed < 0
            ? "Waiting to depart"
            : elapsed >= route.total_s
              ? `Arrived · mile ${number(mi)}`
              : `${rests[index].some((rest) => at >= rest.start && at < rest.end) ? "Resting" : "Driving"} · mile ${number(mi)}`;
      });
    });
  }, [plan, base]);
  return (
    <ul
      ref={list}
      className="journey-positions sr-only"
      aria-label="Truck positions at selected time"
      aria-live="off"
    >
      {plan.routes.map((route) => (
        <li key={route.id}>
          <strong>Truck {route.id}</strong>
          <span data-position>Waiting to depart</span>
        </li>
      ))}
    </ul>
  );
}

function RiskStrips({ plan, base, max }: { plan: Plan; base: string; max: number }) {
  const strips = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const playheads = strips.current?.querySelectorAll<HTMLElement>(".risk-playhead");
    return timeline.onFrame((hour) => {
      // The bars describe forecast elapsed time, on the same 0–48 h axis as the trucks.
      const state = drive.get();
      const start = state.session?.start ?? 0;
      const fraction = Math.max(0, Math.min(1, (hour - start) / Math.max(.01, max - start)));
      playheads?.forEach((head) => head.style.setProperty("--playhead", `${fraction * 100}%`));
      if (strips.current) strips.current.dataset.drive = String(Boolean(state.session));
      strips.current?.querySelectorAll<HTMLElement>('.risk-strip-row').forEach(row => {
        row.dataset.driving = String(state.session?.route.id === row.dataset.route);
        row.style.setProperty('--travelled', `${fraction * 100}%`);
      });
    });
  }, [max]);
  return (
    <div className="risk-strips" ref={strips}>
      {plan.routes.map((route) => (
        <div className="risk-strip-row" key={route.id} data-route={route.id}>
          <strong>{route.id}</strong>
          <span
            className="risk-strip"
            role="img"
            aria-label={`Route ${route.id}, checkpoint risk over ${drive.get().session ? 'the drive preview' : 'the next 48 hours'}; details in the checkpoint list`}
          >
            {Array.from({ length: 49 }, (_, index) => {
              const start = drive.get().session?.start ?? 0;
              const hour = start + index / 48 * (max - start);
              const cp = checkpointAtTime(
                route,
                elapsedAtHour(base, plan.inputs.departure_utc, hour),
              );
              const s = severity(cp?.level ?? null);
              return (
                <i
                  key={hour}
                  className={`risk-fill-${s.token}`}
                  title={`${cp ? `${checkpointPlaceLabel(cp)} · ` : ""}+${number(hour)} h · ${s.label}`}
                />
              );
            })}
            <b className="risk-playhead" aria-hidden="true" />
          </span>
        </div>
      ))}
      <JourneyPositions plan={plan} base={base} />
    </div>
  );
}

export function ForecastClock({
  plan,
  heatmap,
  selected,
}: {
  plan: Plan;
  heatmap: Heatmap | null;
  selected?: string | null;
}) {
  const [strips, setStrips] = useState(false);
  const preview = useDrive();
  const showStrips = strips || Boolean(preview.session);
  const max = preview.session ? Math.max(48, preview.session.end) : Math.max(0, Math.min(48, (heatmap?.hours ?? 49) - 1));
  useEffect(() => () => { if (drive.get().session?.plan.plan_id === plan.plan_id) drive.end(); }, [plan.plan_id]);
  const helpId = useId();
  const stripsId = useId();
  const base =
    heatmap?.base_utc ??
    new Date(
      Math.floor(Date.parse(plan.inputs.departure_utc) / 3600000) * 3600000,
    ).toISOString();
  return (
    <section className="forecast-clock" aria-label="Forecast clock" data-strips={showStrips}>
      <div className="clock-controls">
        <PlayButton plan={plan} selected={selected} base={base} />
        <TimeReadout
          base={base}
          zone={plan.inputs.origin_tz}
          helpId={helpId}
          beyondHorizon={plan.routes.some((route) => route.total_s > 172800)}
        />
        <Slider
          base={base}
          departure={plan.inputs.departure_utc}
          zone={plan.inputs.origin_tz}
          helpId={helpId}
          max={max}
        />
        <button
          type="button"
          className="text-button strips-toggle"
          aria-label="Risk strips"
          title="Show or hide risk strips"
          aria-expanded={showStrips}
          aria-controls={stripsId}
          onClick={() => setStrips(!strips)}
        >
          <span className="strips-label">Risk strips</span>
          <Icon name={showStrips ? "chevron-up" : "chevron-down"} size={16} />
        </button>
      </div>
      {showStrips && <div id={stripsId}><RiskStrips plan={plan} base={base} max={preview.session?.end ?? max} /></div>}
    </section>
  );
}
