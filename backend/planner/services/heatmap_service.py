import base64
from datetime import datetime, timedelta, timezone

import h3
from django.core.cache import cache

from planner.domain.geometry import densify
from planner.domain.risk import classify
from planner.domain.weather import sample
from planner.providers.resilience import singleflight
from .plan_service import iso
from .weather_store import WeatherStore, budget_usage


def corridor(points: list[list[tuple[float, float]]], res: int) -> list[str]:
    cells: set[str] = set()
    for route in points:
        for lat, lon in densify(route, 10000):
            cells.update(h3.grid_disk(h3.latlng_to_cell(lat, lon, res), 1))
    return sorted(cells)


def get_heatmap(plan_id: str) -> dict | None:
    plan = cache.get(f"plan:v1:{plan_id}")
    if plan is None:
        return None
    return singleflight(f"heatmap:v1:{plan_id}", 3600, lambda: build_heatmap(plan_id, plan), wait_s=30)


def build_heatmap(plan_id: str, plan: dict) -> dict:
    usage = budget_usage()
    res = 3 if usage["used_today"] > usage["limit"] * 0.7 else 4
    cells = corridor(plan["points"], res)
    if len(cells) > 600 and res == 4:
        res, cells = 3, corridor(plan["points"], 3)
    weather, warnings = WeatherStore().get_many(cells)
    inputs = plan["result"]["inputs"]
    base = datetime.fromisoformat(inputs["departure_utc"]).replace(minute=0, second=0, microsecond=0)
    levels = bytearray()
    for hour in range(49):
        at = base + timedelta(hours=hour)
        for cell in cells:
            value = sample(weather[cell], at)
            level = classify(value.wind, value.gust, value.rain, value.snow, inputs["cargo_lb"], inputs["wind_measure"]).level
            levels.append(255 if level is None else level)
    fetched = min((s.fetched_at for s in weather.values() if s), default=datetime.now(timezone.utc))
    result = {"plan_id": plan_id, "res": res, "base_utc": iso(base), "hours": 49, "cells": cells,
              "levels_b64": base64.b64encode(levels).decode("ascii"), "fetched_at": iso(fetched)}
    if warnings:
        result["_warnings"] = warnings
    return result
