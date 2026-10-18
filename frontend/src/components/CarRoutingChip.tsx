import { useEffect, useId, useState } from "react";
import { planner, usePlanner } from "../state/planner";
import { Icon } from "./Icon";

const shown = new Set<string>();
export function CarRoutingChip() {
  const { plan, truckUpgrade } = usePlanner();
  const id = useId();
  const [visible, setVisible] = useState<string | null>(null);
  const car = !!plan && !plan.providers.routing.truck_aware;
  const tipKey = car && (truckUpgrade === "pending" || truckUpgrade === "failed") ? `${plan.plan_id}:${truckUpgrade}` : null;
  useEffect(() => {
    if (!tipKey || shown.has(tipKey)) return;
    const show = setTimeout(() => { shown.add(tipKey); setVisible(tipKey); }, 0);
    const hide = setTimeout(() => setVisible(null), 1500);
    return () => { clearTimeout(show); clearTimeout(hide); };
  }, [tipKey]);
  const tip = visible === tipKey && tipKey !== null;
  return <>
    <span className="sr-only" role="status" aria-live="polite">{truckUpgrade === "done" ? "Truck route ready. Routes updated for your truck." : ""}</span>
    {car && <span className="car-chip-wrap">
      {truckUpgrade === "ready" ? <button className="header-chip car-chip" onClick={() => planner.useTruckRoute()}>Use truck route</button> :
        <span className="header-chip car-chip" aria-describedby={tip ? id : undefined}>
          {truckUpgrade === "pending" ? <span className="spinner" aria-hidden="true" /> : <Icon name="warning" size={16} />}
          <span>Car routing{truckUpgrade === "pending" && " · finding truck route"}<span className="sr-only">: truck restrictions not applied</span></span>
        </span>}
      {tip && <span id={id} role="tooltip" className="car-routing-tip" key={tipKey}>
        {truckUpgrade === "failed" ? "Truck route didn't load. These routes ignore truck limits." : "Truck route is taking longer. Showing a car route meanwhile; we'll switch when it's ready."}
      </span>}
    </span>}
  </>;
}
