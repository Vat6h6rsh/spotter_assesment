from datetime import datetime, timezone
from math import isfinite

from django.conf import settings

from planner.domain.geometry import Point
from planner.domain.weather import WeatherSeries
from .base import ProviderError
from .resilience import get_json


def optional_number(value: object) -> float | None:
    if isinstance(value, (int, float)) and isfinite(value) and value >= 0:
        return float(value)
    return None


class OpenMeteo:
    def fetch(self, locations: list[Point]) -> list[WeatherSeries]:
        if not 1 <= len(locations) <= 100:
            raise ValueError("Open-Meteo batches require 1–100 locations")
        params: dict[str, str | int | float] = {
            "latitude": ",".join(str(p[0]) for p in locations), "longitude": ",".join(str(p[1]) for p in locations),
            "hourly": "wind_speed_10m,wind_gusts_10m,rain,showers,snowfall",
            "wind_speed_unit": "mph", "precipitation_unit": "inch", "timezone": "GMT", "forecast_days": 8,
        }
        url = "https://api.open-meteo.com/v1/forecast"
        if settings.OPEN_METEO_API_KEY:
            url = "https://customer-api.open-meteo.com/v1/forecast"
            params["apikey"] = settings.OPEN_METEO_API_KEY
        # Large multi-location responses are slow under load (measured 19 s for 100 x 8 days vs 2 s for 25).
        data = get_json("openmeteo", url, params, timeout=15.0)
        records = data if isinstance(data, list) else [data]
        try:
            if len(records) != len(locations):
                raise ValueError("Missing locations")
            return [self.normalise(record) for record in records]
        except (KeyError, TypeError, ValueError, IndexError) as exc:
            raise ProviderError("Open-Meteo returned an invalid forecast") from exc

    @staticmethod
    def normalise(record: dict) -> WeatherSeries:
        hourly = record["hourly"]
        times = [datetime.fromisoformat(t).replace(tzinfo=timezone.utc) for t in hourly["time"]]
        if not times or any((b - a).total_seconds() != 3600 for a, b in zip(times, times[1:])):
            raise ValueError("Forecast must be contiguous hourly UTC")
        arrays = [[optional_number(v) for v in hourly[name]] for name in ("wind_speed_10m", "wind_gusts_10m", "rain", "showers", "snowfall")]
        if any(len(a) != len(times) for a in arrays):
            raise ValueError("Mismatched weather arrays")
        wind, gust, rain, showers, snow = arrays
        combined_rain = [a + b if a is not None and b is not None else None for a, b in zip(rain, showers)]
        return WeatherSeries(times[0], wind, gust, combined_rain, snow, datetime.now(timezone.utc))
