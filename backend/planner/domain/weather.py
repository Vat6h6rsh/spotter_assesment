from dataclasses import dataclass
from datetime import datetime, timedelta
from math import floor

from .risk import WindMeasure, classify


@dataclass(frozen=True)
class WeatherSeries:
    start: datetime
    wind: list[float | None]
    gust: list[float | None]
    rain: list[float | None]
    snow: list[float | None]
    fetched_at: datetime


@dataclass(frozen=True)
class WeatherSample:
    wind: float | None = None
    gust: float | None = None
    rain: float | None = None
    snow: float | None = None
    forecast_hour: datetime | None = None
    beyond_horizon: bool = False


def sample(series: WeatherSeries | None, eta: datetime) -> WeatherSample:
    if series is None:
        return WeatherSample()
    hours = (eta - series.start).total_seconds() / 3600
    nearest = floor(hours + 0.5)  # Half-hour ties use the following hour.
    ceiling = -floor(-hours)
    if hours < 0 or nearest >= len(series.wind) or ceiling >= len(series.rain):
        return WeatherSample(beyond_horizon=True)
    return WeatherSample(series.wind[nearest], series.gust[nearest], series.rain[ceiling], series.snow[ceiling],
                         series.start + timedelta(hours=nearest))


def clearance(series: WeatherSeries | None, eta: datetime, level: int | None,
              cargo_lb: float, measure: WindMeasure) -> tuple[int | None, datetime | None]:
    """First whole-hour delay with known risk <= High at this cell, at most 48 samples."""
    if level not in (3, 4):
        return None, None
    for hours in range(1, 49):
        at = eta + timedelta(hours=hours)
        value = sample(series, at)
        if value.beyond_horizon:
            break
        risk = classify(value.wind, value.gust, value.rain, value.snow, cargo_lb, measure)
        if risk.level is not None and risk.level <= 2:
            return hours, at
    return None, None
