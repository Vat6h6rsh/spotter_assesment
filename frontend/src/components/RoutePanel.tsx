import { useState } from "react";
import type { Level, Plan, Route } from "../api/types";
import { localTime, shiftedDepartureRequest } from "../lib/time";
import { duration, number, percent, unit } from "../lib/fmt";
import { severities } from "../lib/risk";
import { planner, usePlanner } from "../state/planner";
import { RiskBar, SeverityIcon } from "./Severity";
import { Icon } from "./Icon";

function RouteCard({ route, plan, selected, onCheckpoints, onPreview }: {
  route: Route; plan: Plan; selected: boolean;
  onCheckpoints: () => void; onPreview: (id: string | null) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const miles = route.risk.miles_by_level;
  const recommended = plan.recommendation.route_id === route.id;
  return (
    <article className={`route-card ${selected ? "selected" : ""}`}
      onMouseEnter={() => onPreview(route.id)} onMouseLeave={() => onPreview(null)}
      onFocus={() => onPreview(route.id)} onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) onPreview(null);
      }}>
      <button className="route-select" aria-pressed={selected}
        aria-label={`Select Route ${route.id}, ${route.label}, ${duration(route.total_s)} elapsed, ${number(route.distance_mi)} miles, ${number(miles.severe)} Severe miles, ${number(miles.high)} High miles, ${number(miles.no_travel)} No Travel miles${recommended ? ", recommended" : ""}`}
        onClick={() => planner.selectRoute(route.id)}>
        <span className="route-card-top">
          <span className="route-letter">{route.id}</span>
          <span className="route-name" title={route.label}>{route.label}</span>
        </span>
        <span className="route-metrics">
          <strong className="num">{duration(route.total_s)}</strong>
          <span className="num">{unit(route.distance_mi, "mi")}</span>
          {(route.weather_delay_s ?? 0) >= 60 && <span className="route-weather-delay num" title="Extra driving time from forecast rain or snow (FHWA estimate)">
            <Icon name="rain" size={16} />+{duration(route.weather_delay_s ?? 0)} weather</span>}
          {recommended ? <span className="route-tag recommended"><Icon name="check" size={16} />{plan.recommendation.status === "tentative" ? "Tentative" : "Recommended"}</span>
            : !route.eligible ? <span className="route-tag blocked"><Icon name="ban" size={16} />Blocked</span>
              : route.is_fastest ? <span className="route-tag"><Icon name="bolt" size={16} />Fastest</span> : null}
        </span>
        <span className="route-risk num">
          <span className="risk-severe"><SeverityIcon level={3} />{number(miles.severe)} Severe</span>
          <span className="risk-high"><SeverityIcon level={2} />{number(miles.high)} High</span>
          {miles.no_travel > 0 && <span className="risk-stop"><SeverityIcon level={4} />{number(miles.no_travel)} No Travel</span>}
        </span>
        <RiskBar miles={miles} />
      </button>
      <button className="route-details-button icon-button" aria-label={`${expanded ? "Collapse" : "Expand"} Route ${route.id} details`}
        title={`${expanded ? "Collapse" : "Expand"} route details`} aria-expanded={expanded}
        aria-controls={`route-${route.id}-details`} onClick={() => setExpanded(!expanded)}>
        <Icon name={expanded ? "chevron-up" : "chevron-down"} size={16} />
      </button>
      {expanded && <div className="route-expanded" id={`route-${route.id}-details`}>
        <dl className="risk-breakdown">
          {severities.map((s, i) => <div key={s.key}>
            <dt className={`risk-${s.token}`}><SeverityIcon level={i === 5 ? null : i as Level} />{s.label}</dt>
            <dd className="num">{unit(miles[s.key], "mi")}</dd>
          </div>)}
        </dl>
        <p className="num">{percent(route.risk.coverage)} weather coverage · average risk {route.risk.avg_risk === null ? "Unknown" : number(route.risk.avg_risk, 2)} / 4</p>
        <p>Arrives <time dateTime={route.arrival_utc}>{localTime(route.arrival_utc, route.arrival_tz)}</time></p>
        <p className="num">Elapsed time includes {duration(route.rest_s)} of rests{(route.weather_delay_s ?? 0) >= 60 ? ` and ${duration(route.weather_delay_s ?? 0)} of weather slowdowns (rain or snow, FHWA estimate)` : ""}.</p>
        <div className="rest-list">
          {route.rests.length ? route.rests.map((rest, i) => <p key={i}>
            <Icon name={rest.kind === "break30" ? "coffee" : rest.kind === "rest10h" ? "bed" : "rest"} size={16} />
            <span className="num">Mile {number(rest.at_mi)} · {duration(rest.duration_s)}<br />
              <time dateTime={rest.start_utc}>{localTime(rest.start_utc, rest.lon < -102 ? "America/Denver" : plan.inputs.origin_tz)}</time></span>
          </p>) : <p>No planned rests.</p>}
        </div>
        <button className="button quiet full-width" onClick={() => { planner.selectRoute(route.id); onCheckpoints(); }}>
          <Icon name="list" size={16} />View checkpoints ({number(route.checkpoints.length)})
        </button>
      </div>}
    </article>
  );
}

export function RoutePanel({ onCompare, onCheckpoints, onCollapse, onPreview }: {
  onCompare: () => void; onCheckpoints: () => void; onCollapse: () => void;
  onPreview: (id: string | null) => void;
}) {
  const { plan, selectedRoute, phase } = usePlanner();
  if (!plan) return null;
  const recommendation = plan.recommendation, advice = recommendation.departure_advice;
  const pick = plan.routes.find((route) => route.id === recommendation.route_id);
  const routes = [...plan.routes].sort((a, b) => a.rank - b.rank);
  const busy = phase === "routes" || phase === "weather";
  return <div className="route-panel">
    <div className={`verdict verdict-${recommendation.status}`}>
      <div className="verdict-main">
        <div className="verdict-title">
          <span className="verdict-icon"><Icon name={recommendation.status === "recommended" ? "check-filled" : recommendation.status === "none_eligible" ? "ban" : "alert"} /></span>
          <h1>{recommendation.status === "none_eligible" ? "No route is clear at this departure"
            : recommendation.status === "insufficient_data" ? "More data needed."
              : `${recommendation.status === "tentative" ? "Leaning" : "Take"} ${pick?.id} · ${pick?.label}`}</h1>
        </div>
        {recommendation.status === "tentative" && <p className="verdict-notice">Forecast incomplete; this may change.</p>}
        <p className="verdict-tradeoff">{recommendation.tradeoff || "Review each route before you go."}</p>
        <div className="verdict-chips num">{recommendation.reasons.slice(0, 2).map((reason) => <span key={reason}>{reason}</span>)}</div>
        <details className="verdict-why">
          <summary><Icon name="chevron-right" size={16} />Why this pick</summary>
          {recommendation.reasons.slice(2).map((reason) => <p className="num" key={reason}>{reason}</p>)}
          <p>No Travel first, then Severe and High exposure, average risk and elapsed time. Missing weather stays Unknown.</p>
          {recommendation.status === "none_eligible" && <p>Least exposure: {routes.map((route) => `${route.id} · ${route.label}`).join("; ")}</p>}
        </details>
      </div>
      {advice && <div className="departure-advice">
        <p><Icon name="clock" size={16} /><span>{advice.summary}</span></p>
        <button className="button secondary" disabled={busy} onClick={() => planner.submit(shiftedDepartureRequest(plan, advice.offset_h))}>
          Leave {advice.offset_h} h later
        </button>
      </div>}
    </div>
    <div className="route-list-heading">
      <h2>Routes</h2>
      <div><button className="button secondary" aria-label="Compare routes" onClick={onCompare}><Icon name="compare" size={16} />Compare</button>
        <button className="icon-button" onClick={onCheckpoints} aria-label="Checkpoints" title="View checkpoints"><Icon name="list" /></button>
        <button className="icon-button desktop-only" onClick={onCollapse} aria-label="Collapse route panel" title="Collapse route panel"><Icon name="collapse" /></button></div>
    </div>
    <div className="route-cards" aria-label="Route options" onKeyDown={(event) => {
      if (!["ArrowDown", "ArrowUp"].includes(event.key) || !(event.target as HTMLElement).classList.contains("route-select")) return;
      const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>(".route-select"));
      const index = buttons.indexOf(event.target as HTMLButtonElement);
      event.preventDefault();
      buttons[(index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length].focus();
    }}>
      {routes.map((route) => <RouteCard key={`${plan.plan_id}-${route.id}`} route={route} plan={plan} selected={route.id === selectedRoute} onCheckpoints={onCheckpoints} onPreview={onPreview} />)}
    </div>
    <details className="data-notes"><summary><Icon name="info" size={16} />Data and planning notes</summary>
      {plan.warnings.map((warning) => <p key={warning.code}>{warning.message}</p>)}
      <p>Route risk is rated at each checkpoint’s ETA. Weather fetched <time dateTime={plan.providers.weather.fetched_at}>{localTime(plan.providers.weather.fetched_at, plan.inputs.origin_tz)}</time>. Plan while parked; verify road restrictions and current advisories.</p>
    </details>
  </div>;
}
