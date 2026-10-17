import { useRef, useState } from "react";
import type { Place, Plan, PlanRequest } from "../api/types";
import { nextDeparture, zonedToUtc } from "../lib/time";
import { useServerWake } from "../state/serverWake";
import { usePreferences } from "../state/preferences";
import { planner, usePlanner } from "../state/planner";
import { PlaceInput } from "./PlaceInput";
import { PlanningOptions } from "./PlanningOptions";
import type { Options } from "./PlanningOptions";
import { Icon } from "./Icon";
import { WeatherShowcase } from "./WeatherShowcase";
const originDefault = { label: "Joliet, IL, USA", lat: 41.525, lon: -88.081 };
const destinationDefault = {
  label: "Denver, CO, USA",
  lat: 39.739,
  lon: -104.99,
};
export function PlanForm({
  initial,
  onComplete,
  onClose,
}: {
  initial: Plan | null;
  onComplete: () => void;
  onClose: () => void;
}) {
  const defaults = usePreferences(),
    { phase, demo } = usePlanner();
  const form = useRef<HTMLFormElement>(null);
  const wake = useServerWake();
  const [origin, setOrigin] = useState<Place | null>(
    initial?.inputs.origin ?? originDefault,
  );
  const [destination, setDestination] = useState<Place | null>(
    initial?.inputs.destination ?? destinationDefault,
  );
  const [departure, setDeparture] = useState(
    initial?.inputs.departure_local ?? nextDeparture(),
  );
  const [cargo, setCargo] = useState(initial?.inputs.cargo_lb ?? 42000);
  const [options, setOptions] = useState<Options>(
    initial
      ? {
          spacing: initial.inputs.spacing_mi,
          wind: initial.inputs.wind_measure,
          rest: initial.inputs.rest,
          weatherSlowdown: initial.inputs.weather_slowdown ?? true,
        }
      : { spacing: defaults.spacing, wind: defaults.wind, rest: defaults.rest, weatherSlowdown: defaults.weatherSlowdown },
  );
  const [validation, setValidation] = useState("");
  const busy = phase === "routes" || phase === "weather";
  return (
    <form
      ref={form}
      className="plan-form"
      onSubmit={async (event) => {
        event.preventDefault();
        setValidation("");
        if (!origin || !destination) {
          setValidation(
            "Select an origin and destination from the place matches.",
          );
          return;
        }
        if (origin.lat === destination.lat && origin.lon === destination.lon) {
          setValidation("Choose two different places.");
          return;
        }
        const inputs: PlanRequest = {
          origin,
          destination,
          departure_local: departure,
          cargo_lb: cargo,
          spacing_mi: options.spacing,
          wind_measure: options.wind,
          rest: options.rest,
          weather_slowdown: options.weatherSlowdown,
        };
        if (await planner.submit(inputs)) onComplete();
      }}
    >
      <div className="plan-form-fields">
      <div className="panel-heading">
        <h1>Plan a trip</h1>
        {initial && (
          <button
            className="icon-button"
            type="button"
            onClick={onClose}
            aria-label="Close trip editor"
            title="Close trip editor"
          >
            <Icon name="close" size={18} />
          </button>
        )}
      </div>
      <PlaceInput label="From" value={origin} onChange={setOrigin} />
      <button className="swap-places icon-button" type="button" title="Swap origin and destination" aria-label="Swap origin and destination" onClick={() => { setOrigin(destination); setDestination(origin); }}><Icon name="swap" size={16} /></button>
      <PlaceInput label="To" value={destination} onChange={setDestination} />
      <label htmlFor="departure">
        Departure (your origin’s time)
        <input
          id="departure"
          type="datetime-local"
          value={departure}
          required
          onChange={(e) => setDeparture(e.target.value)}
        />
        <span className="field-hint">
          {departure && origin ? departureEcho(departure, origin, initial) : "Choose your origin and departure · next 72 hours"}
        </span>
      </label>
      <label htmlFor="cargo">
        Cargo weight
        <span className="input-unit">
        <input
          id="cargo"
          type="number"
          inputMode="numeric"
          className="num"
          min={0}
          max={80000}
          step={1}
          required
          value={cargo}
          onChange={(e) => setCargo(Number(e.target.value))}
        />
        <span>lb</span>
        </span>
      </label>
      <details className="more-options">
        <summary>
          <Icon name="chevron-right" size={16} />More options <span>Spacing, wind & rests</span>
        </summary>
        <PlanningOptions
          value={options}
          onChange={(patch) =>
            setOptions((current) => ({ ...current, ...patch }))
          }
          prefix="trip"
        />
      </details>
      <WeatherShowcase demo={demo} busy={busy} autoOpen={!initial} onOwn={() => form.current?.querySelector<HTMLInputElement>('[role="combobox"]')?.focus()} onPlan={trip => {
        setOrigin(trip.origin); setDestination(trip.destination); setCargo(trip.cargo_lb); setDeparture(trip.departure_local); setValidation("");
        void planner.submit({ origin: trip.origin, destination: trip.destination, cargo_lb: trip.cargo_lb, departure_local: trip.departure_local, spacing_mi: options.spacing, wind_measure: options.wind, rest: options.rest, weather_slowdown: options.weatherSlowdown }).then(success => { if (success) onComplete(); });
      }} />
      {validation && (
        <p className="inline-error" role="alert">
          {validation}
        </p>
      )}
      </div>
      <div className="plan-form-footer">
      <button
        className="button primary plan-submit"
        type="submit"
        aria-busy={busy}
        disabled={busy}
      >
        {busy ? (
          <>
            {wake.status === "waking" ? "Waiting for the server\u2026" : "Planning your trip\u2026"}
          </>
        ) : (
          <>
            Plan routes <Icon name="arrow" size={19} />
          </>
        )}
      </button>
      {busy && (
        <button
          type="button"
          className="text-button cancel-plan"
          onClick={() => planner.cancel()}
        >
          Cancel request
        </button>
      )}
      <p className="form-footnote">
        <Icon name="globe" size={14} /> US & Canada · built for planning before
        you drive
      </p>
      </div>
    </form>
  );
}

function departureEcho(wall: string, origin: Place, initial: Plan | null) {
  const zone = "tz" in origin && typeof origin.tz === "string" ? origin.tz
    : initial?.inputs.origin.lat === origin.lat && initial.inputs.origin.lon === origin.lon ? initial.inputs.origin_tz
      : origin.lat === originDefault.lat && origin.lon === originDefault.lon ? "America/Chicago" : null;
  try {
    const options: Intl.DateTimeFormatOptions = { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: zone ?? "UTC", ...(zone ? { timeZoneName: "short" } : {}) };
    const date = zone ? zonedToUtc(wall, zone) : `${wall}:00Z`;
    return `${new Intl.DateTimeFormat("en-US", options).format(new Date(date))}${zone ? "" : " · origin local time"}`;
  } catch { return "Enter a departure within the next 72 hours"; }
}
