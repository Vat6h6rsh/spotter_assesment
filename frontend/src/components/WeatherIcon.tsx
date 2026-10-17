import type { WeatherIconName } from "../lib/weatherIcons";
import { weatherIconUrl } from "../lib/weatherIconAssets";
/** A picture source prevents SMIL from running at all under reduced motion, even in HTML map markers. */
export function WeatherIcon({ icon, size = 56, staticOnly = false }: { icon: WeatherIconName; size?: number; staticOnly?: boolean }) {
  return <picture className="weather-icon" data-weather={icon} style={{ width: size, height: size }} aria-hidden="true">
    {!staticOnly && <source media="(prefers-reduced-motion: reduce)" srcSet={weatherIconUrl(icon, true)} />}
    <img src={weatherIconUrl(icon, staticOnly)} width={size} height={size} alt="" />
  </picture>;
}
