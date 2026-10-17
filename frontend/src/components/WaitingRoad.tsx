import { useEffect, useState } from "react";
import { Icon } from "./Icon";
import { WeatherIcon } from "./WeatherIcon";
import type { WeatherIconName } from "../lib/weatherIcons";
const skies: WeatherIconName[] = ["clear-day", "wind", "extreme-rain", "extreme-snow", "thunderstorms-rain"];
export function WaitingRoad({ compact = false, paused = false }: { compact?: boolean; paused?: boolean }) {
  const [sky, setSky] = useState(0);
  useEffect(() => {
    if (paused) return;
    const timer = setInterval(() => setSky((value) => value + 1), 8000);
    return () => clearInterval(timer);
  }, [paused]);
  return <div className={`waiting-road ${compact ? "compact" : "wide"} ${paused ? "is-paused" : ""}`} aria-hidden="true">
    {sky > 0 && <span className="waiting-sky sky-out" key={`old-${sky}`}><WeatherIcon icon={skies[(sky + skies.length - 1) % skies.length]} size={compact ? 32 : 40} staticOnly /></span>}
    <span className="waiting-sky" key={sky}><WeatherIcon icon={skies[sky % skies.length]} size={compact ? 32 : 40} staticOnly /></span>
    <span className="waiting-truck"><Icon name="truck" size={24} /></span>
    <span className="waiting-dashes" />
  </div>;
}
