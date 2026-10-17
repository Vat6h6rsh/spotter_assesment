import type { Checkpoint } from "../api/types";

export type WeatherIconName = "wind" | "windsock" | "raindrops" | "rain" | "extreme-rain" | "snow" | "extreme-snow" | "thunderstorms-rain" | "clear-day" | "clear-night" | "not-available";
type Weather = Pick<Checkpoint, "level" | "drivers" | "rain_in" | "snow_in" | "eta_utc" | "tz">;

/** Weather depictions only; severity shapes and all UI controls remain Tabler. */
export function weatherIconFor(weather: Weather): WeatherIconName {
  if (weather.level === null) return "not-available";
  const driver = weather.drivers[0]?.toLowerCase() ?? "";
  if (/thunder|lightning/.test(driver)) return "thunderstorms-rain";
  if (/wind|gust/.test(driver)) return weather.level >= 3 ? "wind" : "windsock";
  if (/snow/.test(driver) || (!driver && (weather.snow_in ?? 0) > 0))
    return weather.level >= 2 || (weather.snow_in ?? 0) >= .1 ? "extreme-snow" : "snow";
  if (/rain/.test(driver) || (!driver && (weather.rain_in ?? 0) > 0))
    return weather.level >= 3 || (weather.rain_in ?? 0) > .3 ? "extreme-rain" : (weather.rain_in ?? 0) < .1 ? "raindrops" : "rain";
  if (driver || weather.level > 0) return "not-available";
  // No solar data in the contract: use origin-local ETA hour as a day/night visual cue.
  try {
    const hour = Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone: weather.tz }).format(new Date(weather.eta_utc)));
    return hour < 6 || hour >= 18 ? "clear-night" : "clear-day";
  } catch { return "not-available"; }
}
