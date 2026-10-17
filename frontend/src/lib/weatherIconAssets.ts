import type { WeatherIconName } from "./weatherIcons";
import wind from "../assets/meteocons/animated/wind.svg?url";
import windsock from "../assets/meteocons/animated/windsock.svg?url";
import raindrops from "../assets/meteocons/animated/raindrops.svg?url";
import rain from "../assets/meteocons/animated/rain.svg?url";
import extremeRain from "../assets/meteocons/animated/extreme-rain.svg?url";
import snow from "../assets/meteocons/animated/snow.svg?url";
import extremeSnow from "../assets/meteocons/animated/extreme-snow.svg?url";
import thunder from "../assets/meteocons/animated/thunderstorms-rain.svg?url";
import day from "../assets/meteocons/animated/clear-day.svg?url";
import night from "../assets/meteocons/animated/clear-night.svg?url";
import unknown from "../assets/meteocons/animated/not-available.svg?url";
import windStatic from "../assets/meteocons/static/wind.svg?url";
import windsockStatic from "../assets/meteocons/static/windsock.svg?url";
import raindropsStatic from "../assets/meteocons/static/raindrops.svg?url";
import rainStatic from "../assets/meteocons/static/rain.svg?url";
import extremeRainStatic from "../assets/meteocons/static/extreme-rain.svg?url";
import snowStatic from "../assets/meteocons/static/snow.svg?url";
import extremeSnowStatic from "../assets/meteocons/static/extreme-snow.svg?url";
import thunderStatic from "../assets/meteocons/static/thunderstorms-rain.svg?url";
import dayStatic from "../assets/meteocons/static/clear-day.svg?url";
import nightStatic from "../assets/meteocons/static/clear-night.svg?url";
import unknownStatic from "../assets/meteocons/static/not-available.svg?url";

const animated: Record<WeatherIconName, string> = { wind, windsock, raindrops, rain, "extreme-rain": extremeRain, snow, "extreme-snow": extremeSnow, "thunderstorms-rain": thunder, "clear-day": day, "clear-night": night, "not-available": unknown };
const still: Record<WeatherIconName, string> = { wind: windStatic, windsock: windsockStatic, raindrops: raindropsStatic, rain: rainStatic, "extreme-rain": extremeRainStatic, snow: snowStatic, "extreme-snow": extremeSnowStatic, "thunderstorms-rain": thunderStatic, "clear-day": dayStatic, "clear-night": nightStatic, "not-available": unknownStatic };
export function weatherIconUrl(icon: WeatherIconName, staticOnly = false) {
  return (staticOnly ? still : animated)[icon];
}
