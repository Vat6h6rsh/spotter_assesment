import type { Plan, Route } from "../api/types";
import { localTime } from "../lib/time";
import { duration, number, percent, unit } from "../lib/fmt";
import { planner } from "../state/planner";
import { checkpointPlaceLabel } from "../lib/checkpointPlace";
import { severity } from "../lib/risk";
import { Icon } from "./Icon";
import { Severity } from "./Severity";
import { checkpointClearing, checkpointDriver } from "../lib/checkpoint";
import { weatherIconFor } from "../lib/weatherIcons";
import { WeatherIcon } from "./WeatherIcon";

export function CheckpointPanel({
  plan,
  route,
  index,
  onClose,
  onList,
}: {
  plan: Plan;
  route: Route;
  index: number | null;
  onClose: () => void;
  onList: () => void;
}) {
  const checkpoint =
    index === null ? null : route.checkpoints.find((cp) => cp.i === index);
  if (!checkpoint)
    return (
      <aside className="checkpoint-panel" aria-label="Checkpoint list">
        <div className="panel-heading">
          <h2>Checkpoints · Route {route.id}</h2>
          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            aria-label="Close checkpoints"
            title="Close checkpoints"
          >
            <Icon name="close" size={20} />
          </button>
        </div>
        <div className="checkpoint-content">
          <p className="muted">Select a checkpoint to inspect conditions at your expected arrival.</p>
          <ol className="checkpoint-list">
            {route.checkpoints.map((cp) => (
              <li key={cp.i}>
                <button
                  type="button"
                  aria-label={`Checkpoint ${route.id}-${cp.i}, ${checkpointPlaceLabel(cp)}, mile ${number(cp.mi)}, ${severity(cp.level).label}, ETA ${localTime(cp.eta_utc, cp.tz)}`}
                  onClick={() => planner.selectCheckpoint(route.id, cp.i)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") { event.preventDefault(); planner.selectCheckpoint(route.id, cp.i); }
                  }}
                >
                  <span className="checkpoint-list-copy">
                    <strong>{checkpointPlaceLabel(cp)}</strong>
                    <span className="checkpoint-list-details">
                      <span className="checkpoint-list-meta num">Mile {number(cp.mi)} · <time dateTime={cp.eta_utc}>{localTime(cp.eta_utc, cp.tz, false)}</time> · +{duration(cp.elapsed_s).replace("h", " h").replace("m", " m")}</span>
                      <Severity level={cp.level} />
                    </span>
                    <span className="checkpoint-list-driver">{checkpointDriver(cp, plan.inputs)}</span>
                  </span>
                  <Icon name="chevron-right" size={16} />
                </button>
              </li>
            ))}
          </ol>
        </div>
      </aside>
    );

  const offset = route.checkpoints.findIndex((cp) => cp.i === checkpoint.i);
  const previous = route.checkpoints[offset - 1];
  const next = route.checkpoints[offset + 1];
  const speed = (value: number | null) =>
    value === null ? "Unknown mph" : unit(value, "mile-per-hour");
  const precipitation = (value: number | null) =>
    `${value === null ? "Unknown" : number(value, 2)} in/hr`;
  const driverTag = (factor: string) =>
    checkpoint.drivers.includes(factor) ? <span className="driver-tag">Driver</span> : null;
  const clearing = checkpointClearing(checkpoint);

  return (
    <aside
      className="checkpoint-panel checkpoint-detail"
      aria-label={`Checkpoint ${route.id}-${checkpoint.i} detail`}
    >
      <div className="panel-heading checkpoint-detail-header">
        <button type="button" className="text-button checkpoint-back" onClick={onList}>
          <Icon name="chevron-left" size={16} />
          All checkpoints
        </button>
        <button
          type="button"
          className="icon-button"
          onClick={onClose}
          aria-label="Close checkpoint detail"
          title="Close checkpoint detail"
        >
          <Icon name="close" size={20} />
        </button>
      </div>
      <div className="checkpoint-content">
        <h2>{checkpointPlaceLabel(checkpoint)}</h2>
        <p className="checkpoint-subtitle num">Mile {number(checkpoint.mi)} · Route {route.id}</p>
        <div className="checkpoint-eta">
          <time dateTime={checkpoint.eta_utc}>{localTime(checkpoint.eta_utc, checkpoint.tz)}</time>
          <span className="num">{duration(checkpoint.elapsed_s)} into the trip</span>
        </div>
        <div className="checkpoint-severity">
          <WeatherIcon icon={weatherIconFor(checkpoint)} staticOnly size={32} />
          <Severity level={checkpoint.level} />
        </div>
        {clearing && <p className="checkpoint-clearing num">{clearing}</p>}

        <dl className="weather-rows">
          <div className="weather-row">
            <dt className="weather-row-main">
              <Icon name="wind" size={20} />
              <span>Wind</span>
              {driverTag("wind")}
            </dt>
            <dd className="weather-values num">
              <span>gust <strong>{speed(checkpoint.gust_mph)}</strong></span>
              <span>sustained <strong>{speed(checkpoint.wind_mph)}</strong></span>
            </dd>
          </div>
          <div className="weather-row">
            <dt className="weather-row-main">
              <Icon name="rain" size={20} />
              <span>Rain</span>
              {driverTag("rain")}
            </dt>
            <dd className="weather-values num"><strong>{precipitation(checkpoint.rain_in)}</strong></dd>
          </div>
          <div className="weather-row">
            <dt className="weather-row-main">
              <Icon name="snow" size={20} />
              <span>Snow</span>
              {driverTag("snow")}
            </dt>
            <dd className="weather-values num"><strong>{precipitation(checkpoint.snow_in)}</strong></dd>
          </div>
        </dl>

        <div className="rule-box">
          <h3>Why this rating</h3>
          <p>{checkpoint.rule}</p>
          {checkpoint.slowdown && <p className="slowdown-note">
            <Icon name="rain" size={16} />
            Speed on this stretch: {checkpoint.slowdown} (FHWA estimate)
          </p>}
          {checkpoint.load_adjusted && (
            <p className="load-note num">
              <Icon name="truck" size={16} />
              Load-adjusted · {unit(plan.inputs.cargo_lb, "pound")}
            </p>
          )}
          <dl>
            <div>
              <dt>Base wind</dt>
              <dd><Severity level={checkpoint.base_wind_level} /></dd>
            </div>
            <div>
              <dt>Load adjustment</dt>
              <dd>{checkpoint.load_adjusted ? "Applied to wind" : "None"}</dd>
            </div>
            <div>
              <dt>Wind measure</dt>
              <dd>{plan.inputs.wind_measure === "gust" ? "Higher of gust / sustained" : "Sustained"}</dd>
            </div>
            <div>
              <dt>Route weather coverage</dt>
              <dd className="num">{percent(route.risk.coverage)}</dd>
            </div>
          </dl>
        </div>
        {checkpoint.beyond_horizon && (
          <p className="state-notice">
            Beyond the available forecast. Unknown is never treated as Low.
          </p>
        )}
        <p className="fine-print">
          Forecast hour{" "}
          {checkpoint.forecast_hour_utc
            ? <time dateTime={checkpoint.forecast_hour_utc}>{localTime(checkpoint.forecast_hour_utc, checkpoint.tz, false)}</time>
            : "unavailable"}
          {" · fetched "}
          <time dateTime={plan.providers.weather.fetched_at}>
            {localTime(plan.providers.weather.fetched_at, checkpoint.tz, false)}
          </time>
        </p>
      </div>
      <div className="checkpoint-nav">
        <button
          type="button"
          className="button secondary num"
          disabled={!previous}
          aria-label={previous ? `Previous checkpoint, mile ${number(previous.mi)}, ${checkpointPlaceLabel(previous)}` : "Previous checkpoint"}
          onClick={() => previous && planner.selectCheckpoint(route.id, previous.i)}
        >
          <Icon name="chevron-left" size={16} />
          <span className="checkpoint-nav-label"><small>Previous</small><strong>{previous ? checkpointPlaceLabel(previous) : "Start of route"}</strong></span>
        </button>
        <button
          type="button"
          className="button secondary num"
          disabled={!next}
          aria-label={next ? `Next checkpoint, mile ${number(next.mi)}, ${checkpointPlaceLabel(next)}` : "Next checkpoint"}
          onClick={() => next && planner.selectCheckpoint(route.id, next.i)}
        >
          <span className="checkpoint-nav-label"><small>Next</small><strong>{next ? checkpointPlaceLabel(next) : "End of route"}</strong></span>
          <Icon name="chevron-right" size={16} />
        </button>
      </div>
    </aside>
  );
}
