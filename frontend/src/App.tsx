import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { planner, usePlanner } from "./state/planner";
import { timeline } from "./state/timeline";
import { drive } from "./drive/state";
import { initializeTheme, resolveTheme, usePreferences } from "./state/preferences";
import { serverWake } from "./state/serverWake";
import { localTime } from "./lib/time";
import { duration, unit, number } from "./lib/fmt";
import { PlanForm } from "./components/PlanForm";
import { RoutePanel } from "./components/RoutePanel";
import { CheckpointPanel } from "./components/CheckpointPanel";
import { ForecastClock } from "./components/ForecastClock";
import { CompareModal } from "./components/CompareModal";
import { Settings } from "./components/Settings";
import { Icon } from "./components/Icon";
import { PanelErrorBoundary } from "./components/PanelErrorBoundary";
import { ServerWakeCard, ServerWakeChip } from "./components/ServerWakeChip";
import { PlanningWait } from "./components/PlanningWait";
import "./App.css";
const MapView = lazy(() => import("./map/MapView"));
type Snap = "peek" | "half" | "full";
function useMobile() {
  const [mobile, setMobile] = useState(() => matchMedia("(max-width: 1023px)").matches);
  useEffect(() => {
    const query = matchMedia("(max-width: 1023px)");
    const listener = () => setMobile(query.matches);
    query.addEventListener("change", listener);
    return () => query.removeEventListener("change", listener);
  }, []);
  return mobile;
}
function App() {
  const { plan, heatmap, phase, selectedRoute, checkpoint, selectionSource, demo, cached, offline, error, heatmapError } = usePlanner();
  const prefs = usePreferences(), mobile = useMobile();
  const [page, setPage] = useState<"plan" | "settings">("plan"), [editing, setEditing] = useState(!plan);
  const [compare, setCompare] = useState(false), [checkpoints, setCheckpoints] = useState(false), [collapsed, setCollapsed] = useState(false);
  const [previewRoute, setPreviewRoute] = useState<string | null>(null);
  const [snap, setSnap] = useState<Snap>(plan ? "peek" : "full"), dragStart = useRef(0);
  const route = plan?.routes.find((r) => r.id === selectedRoute) ?? plan?.routes[0];
  const pick = plan?.routes.find((r) => r.id === plan.recommendation.route_id) ?? route;
  const theme = resolveTheme(prefs.theme, matchMedia("(prefers-color-scheme: dark)").matches);
  useEffect(() => initializeTheme(), []);
  useEffect(() => {
    const query = matchMedia("(min-width: 1024px) and (pointer: fine)");
    const update = () => { document.documentElement.dataset.density = query.matches ? "compact" : "comfortable"; };
    update(); query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    const stop = serverWake.start();
    return () => { planner.cancel(); stop(); };
  }, []);
  useEffect(() => {
    const online = () => planner.setOffline(!navigator.onLine);
    window.addEventListener("online", online);
    window.addEventListener("offline", online);
    return () => { window.removeEventListener("online", online); window.removeEventListener("offline", online); };
  }, []);
  useEffect(() => {
    let previous = planner.get();
    return planner.subscribe(() => {
      const next = planner.get();
      if (next.startedAt !== previous.startedAt && next.phase === "routes") setSnap("peek");
      if (next.plan && next.plan.plan_id !== previous.plan?.plan_id) {
        setEditing(false); setCollapsed(false); setSnap("peek"); setCheckpoints(false); setPreviewRoute(null);
      }
      if (next.checkpoint !== null && (next.checkpoint !== previous.checkpoint || next.selectedRoute !== previous.selectedRoute)) {
        setCheckpoints(true); setSnap("full");
      }
      previous = next;
    });
  }, []);
  function edit() { setPage("plan"); setEditing(true); setCollapsed(false); setSnap("full"); setCheckpoints(false); }
  function openList() {
    const selected = planner.get().selectedRoute;
    if (selected) planner.selectCheckpoint(selected, null);
    setCheckpoints(true); setSnap("full");
  }
  function closeCheckpoints() { setCheckpoints(false); if (route) planner.selectCheckpoint(route.id, null); if (mobile) setSnap("half"); }
  const planBusy = phase === "routes" || phase === "weather";
  const clock = plan && <PanelErrorBoundary label="Forecast clock"><ForecastClock key={plan.plan_id} plan={plan} selected={selectedRoute} heatmap={heatmap?.data ?? null} /></PanelErrorBoundary>;
  const drawer = plan && route && <PanelErrorBoundary label="Checkpoint drawer"><CheckpointPanel plan={plan} route={route} index={checkpoint} onClose={closeCheckpoints} onList={openList} /></PanelErrorBoundary>;
  return <div className="app-shell">
    <a className="skip-link" href="#main-content">Skip to route planning</a>
    <header className="app-header">
      <a className="brand" href="#" aria-label="Spotter Weather Route home" onClick={(event) => { event.preventDefault(); setPage("plan"); }}>
        <img src="/spotter-ai-logo.webp" alt="Spotter AI" />
      </a>
      <span className="brand-divider" /><span className="product-name">Weather Route</span>
      <div className="mobile-trip">{plan ? <><strong>{plan.inputs.origin.label.split(",")[0]}<Icon name="arrow" size={16} />{plan.inputs.destination.label.split(",")[0]}</strong><time dateTime={plan.inputs.departure_utc}>{localTime(plan.inputs.departure_utc, plan.inputs.origin_tz)}</time></> : <strong>Plan a trip</strong>}</div>
      <nav aria-label="Main navigation">
        <button className={`plan-tab ${page === "plan" ? "active" : ""}`} aria-current={page === "plan" ? "page" : undefined} onClick={() => setPage("plan")}>Plan</button>
        {mobile && <button className="mobile-edit icon-button" aria-label="Edit trip" title="Edit trip" onClick={edit}><Icon name="edit" /></button>}
        <button className={page === "settings" ? "active" : ""} aria-label="Settings" title="Settings" aria-current={page === "settings" ? "page" : undefined} onClick={() => { if (drive.get().session) drive.end(); timeline.play(false); setPage("settings"); }}><Icon name="settings" /><span>Settings</span></button>
      </nav>
      <div className="header-right">
        <ServerWakeChip />
        {plan && !plan.providers.routing.truck_aware && <span className="header-chip car-chip" title="Car routing: truck restrictions not applied"><Icon name="warning" size={16} /><span>Car routing<span className="sr-only">: truck restrictions not applied</span></span></span>}
        {offline && <span className="header-chip"><Icon name="offline" size={16} />Offline</span>}
        {demo && <span className="demo-badge">Demo data</span>}
      </div>
    </header>
    {page === "settings" && <Settings onBack={() => setPage("plan")} />}
    <div className="planning-page" hidden={page !== "plan"}>
      <div className="trip-bar" hidden={!plan}>{plan && <>
        <div className="trip-destinations"><Icon name="origin" size={16} /><strong>{plan.inputs.origin.label.split(",").slice(0, 2).join(",")}</strong><Icon name="arrow" size={16} /><Icon name="pin" size={16} /><strong>{plan.inputs.destination.label.split(",").slice(0, 2).join(",")}</strong></div>
        <div className="trip-fact"><Icon name="departure" size={16} /><time dateTime={plan.inputs.departure_utc}>{localTime(plan.inputs.departure_utc, plan.inputs.origin_tz)}</time></div>
        <div className="trip-fact cargo-fact num"><Icon name="weight" size={16} />{unit(plan.inputs.cargo_lb, "lb")}</div>
        <span className="trip-spacing num"><Icon name="ruler" size={16} />{unit(plan.inputs.spacing_mi, "mi")}</span>
        <button className="button secondary edit-trip" onClick={edit}><Icon name="edit" size={16} />Edit trip</button>
      </>}</div>
      <main className={`control-room ${collapsed && !editing ? "routes-collapsed" : ""} ${checkpoints && route && !mobile ? "has-checkpoint" : ""}`} id="main-content">
        <div className="workspace">
          <PanelErrorBoundary label="Map"><Suspense fallback={<div className="map-loading" role="status">Opening your map…</div>}>
            <MapView plan={plan} heatmap={heatmap} selected={selectedRoute} checkpoint={checkpoint} selectionSource={selectionSource} theme={theme} phase={phase} heatmapError={heatmapError} previewRoute={previewRoute} layoutKey={`${snap}:${checkpoints}`} />
          </Suspense></PanelErrorBoundary>
          <aside className="left-panel" data-snap={snap} aria-label={editing ? "Plan your trip" : "Routes and verdict"}
            onClickCapture={(event) => {
              if (mobile && snap === "peek" && (event.target as Element).closest(".strips-toggle")) setSnap("half");
            }}>
            {mobile && <div className="sheet-handle" onPointerDown={(event) => {
              if ((event.target as HTMLElement).closest("button")) return;
              dragStart.current = event.clientY; event.currentTarget.setPointerCapture(event.pointerId);
            }} onPointerUp={(event) => {
              if ((event.target as HTMLElement).closest("button")) return;
              const delta = event.clientY - dragStart.current, snaps: Snap[] = ["peek", "half", "full"];
              if (Math.abs(delta) > 30) setSnap(snaps[Math.max(0, Math.min(2, snaps.indexOf(snap) + (delta < 0 ? 1 : -1)))]);
            }}>
              <button className="sheet-grabber" aria-label="Change panel height" title="Change panel height" onClick={() => setSnap(snap === "peek" ? "half" : snap === "half" ? "full" : "peek")}><span className="drag-pill" /></button>
              <div className="snap-buttons" aria-label="Panel height">{(["peek", "half", "full"] as const).map((s) => <button key={s} className={snap === s ? "snap-active" : ""} aria-label={`${s} panel`} aria-pressed={snap === s} onClick={() => setSnap(s)}>{s === "peek" ? "Overview" : s === "half" ? "Routes" : "Details"}</button>)}</div>
            </div>}
            {mobile && snap === "peek" && <button className="mobile-verdict" onClick={() => setSnap(plan ? "half" : "full")}>
              <span><strong>{plan ? plan.recommendation.status === "none_eligible" ? "No route is clear at this departure" : plan.recommendation.status === "insufficient_data" ? "More weather data needed" : `${plan.recommendation.status === "tentative" ? "Leaning" : "Take"} ${pick?.id} · ${pick?.label}` : "Plan a trip"}</strong>
                {pick && <span className="num">{duration(pick.total_s)} · {number(pick.risk.miles_by_level.severe)} Severe · {pick.is_fastest ? "Fastest" : `+${duration(pick.total_s - Math.min(...(plan?.routes.map(r => r.total_s) ?? [0])))} vs fastest`}</span>}
              </span><Icon name="chevron-up" />
            </button>}
            {mobile && (cached || offline) && plan && snap === "peek" && <div className="saved-chip num">Saved {localTime(plan.created_at, plan.inputs.origin_tz, false)}{!offline && <button onClick={() => planner.retry()}>Refresh</button>}</div>}
            <div className="sheet-content">
              <ServerWakeCard />
              <div className="status-stack" aria-live="polite">
                {(cached || offline) && plan && <div className="banner neutral"><span>{offline ? "Offline: showing your last plan" : "Saved plan"} from <time dateTime={plan.created_at}>{localTime(plan.created_at, plan.inputs.origin_tz, false)}</time>.</span>{!offline && <button onClick={() => planner.retry()}>Refresh</button>}</div>}
                {error && <div className="banner error-banner" role="alert"><span>{error}</span><button onClick={() => planner.retry()}>Retry</button></div>}
                {heatmapError && <div className="banner warning-banner"><span>Corridor heatmap unavailable. Routes and checkpoint forecasts are still here.</span><button onClick={() => planner.retryHeatmap()}>Retry heatmap</button></div>}
                {plan?.recommendation.status === "tentative" && <div className="banner warning-banner"><Icon name="alert" size={16} /><span>Tentative recommendation. Missing weather may change the safest route.</span></div>}
                {plan?.recommendation.status === "insufficient_data" && <div className="banner warning-banner"><Icon name="help" size={16} /><span>Not enough weather data to recommend a route. Review coverage and retry.</span><button onClick={() => planner.retry()}>Retry</button></div>}
              </div>
              {mobile && checkpoints && route && plan ? drawer : <PanelErrorBoundary label="Route panel">{editing ? <PlanForm key={plan?.plan_id ?? "new"} initial={plan} onComplete={() => setEditing(false)} onClose={() => setEditing(false)} /> : <RoutePanel onCompare={() => setCompare(true)} onCheckpoints={openList} onCollapse={() => setCollapsed(true)} onPreview={setPreviewRoute} />}</PanelErrorBoundary>}
              {planBusy && <div className="loading-skeleton" aria-hidden="true"><div className="skeleton-verdict" />{[0, 1, 2].map(i => <div className="skeleton-card" key={i}><span /><span /></div>)}</div>}
            </div>
            {mobile && clock}
          </aside>
          {collapsed && !editing && !mobile && <button className="expand-routes button secondary" onClick={() => setCollapsed(false)}><Icon name="expand" />Routes</button>}
          {!mobile && checkpoints && route && plan && drawer}
        </div>
        {!mobile && clock}
        <PlanningWait />
      </main>
    </div>
    {compare && plan && <CompareModal plan={plan} onClose={() => setCompare(false)} />}
  </div>;
}
export default App;
