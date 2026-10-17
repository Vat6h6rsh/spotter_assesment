"""One-hour per-cell forecasts with stampede protection and a UTC daily budget.

Budget units are location forecasts (a batch of 25 consumes 25), not HTTP GETs.
Batches are small and parallel: Open-Meteo latency grows superlinearly with batch size under load.
"""
import time
from concurrent.futures import ThreadPoolExecutor, wait
from contextlib import ExitStack
from datetime import datetime, timezone
from threading import Lock

import h3
from django.conf import settings
from django.core.cache import cache

from planner.domain.weather import WeatherSeries
from planner.providers.base import ProviderError
from planner.providers.openmeteo import OpenMeteo
from planner.providers.resilience import cache_lock


BATCH = 25


def budget_key() -> str:
    return f"wx:budget:{datetime.now(timezone.utc):%Y-%m-%d}"


def budget_usage() -> dict[str, int]:
    return {"used_today": cache.get(budget_key(), 0), "limit": settings.WEATHER_DAILY_BUDGET}


def reserve_budget(requested: int) -> int:
    key = budget_key()
    deadline = time.monotonic() + 2
    while time.monotonic() < deadline:
        with cache_lock(f"lock:{key}", 5) as acquired:
            if acquired:
                used = cache.get(key, 0)
                allowed = max(0, min(requested, settings.WEATHER_DAILY_BUDGET - used))
                cache.set(key, used + allowed, 172800)
                return allowed
        time.sleep(0.01)
    return 0


class WeatherStore:
    def get_many(self, cells: list[str], *, time_budget_s: float | None = None) -> tuple[dict[str, WeatherSeries | None], list[dict[str, str]]]:
        # Optional caller budget includes both fetch waves and waiting on another owner.
        deadline = time.monotonic() + time_budget_s if time_budget_s is not None else None
        unique = list(dict.fromkeys(cells))
        keys = {cell: f"wx:v1:{cell}" for cell in unique}
        cached = cache.get_many(keys.values())
        today = datetime.now(timezone.utc).date()
        results = {cell: cached.get(key) for cell, key in keys.items()}
        results = {cell: value if value is not None and value.start.date() == today else None for cell, value in results.items()}
        warnings: list[dict[str, str]] = []
        with ExitStack() as stack:
            owned: list[str] = []
            waiting: list[str] = []
            for cell in unique:
                if results[cell] is not None:
                    continue
                acquired = stack.enter_context(cache_lock(f"lock:{keys[cell]}", 90))
                if acquired:
                    # Another worker may have filled the cache since get_many.
                    value = cache.get(keys[cell])
                    if value is not None and value.start.date() == today:
                        results[cell] = value
                    else:
                        owned.append(cell)
                else:
                    waiting.append(cell)
            allowed = reserve_budget(len(owned)) if owned else 0
            if allowed < len(owned):
                warnings.append({"code": "WEATHER_BUDGET", "message": "Daily weather budget exhausted; unavailable cells are Unknown."})
            batches = [owned[i:min(i + BATCH, allowed)] for i in range(0, allowed, BATCH)]

            def fetch_batch(batch: list[str]) -> dict[str, WeatherSeries]:
                locations = [h3.cell_to_latlng(cell) for cell in batch]
                values = OpenMeteo().fetch(locations)
                mapped = dict(zip(batch, values))
                cache.set_many({keys[cell]: value for cell, value in mapped.items()}, 3600)
                return mapped

            if batches:
                pool = ThreadPoolExecutor(max_workers=6)
                futures = [pool.submit(fetch_batch, batch) for batch in batches]
                done, pending = wait(futures, timeout=max(0, deadline - time.monotonic()) if deadline is not None else None)
                if pending:
                    # HTTP requests cannot be killed. Keep their cell locks until they finish
                    # caching, while returning completed batches within the caller's budget.
                    deferred = stack.pop_all()
                    mutex = Lock()
                    remaining = len(pending)

                    def release_locks(future):
                        nonlocal remaining
                        with mutex:
                            remaining -= 1
                            if remaining == 0:
                                deferred.close()

                    for future in pending:
                        future.add_done_callback(release_locks)
                pool.shutdown(wait=not pending, cancel_futures=True)
                for future in done:
                    try:
                        results.update(future.result())
                    except ProviderError:
                        warnings.append({"code": "WEATHER_UNAVAILABLE", "message": "Some forecasts are unavailable; those checkpoints are Unknown."})
            wait_deadline = deadline if deadline is not None else time.monotonic() + 14
            while waiting and time.monotonic() < wait_deadline:
                for cell in waiting[:]:
                    value = cache.get(keys[cell])
                    if value is not None and value.start.date() == today:
                        results[cell] = value
                        waiting.remove(cell)
                    elif cache.get(f"lock:{keys[cell]}") is None:
                        waiting.remove(cell)
                if waiting:
                    time.sleep(0.025)
        if any(value is None for value in results.values()) and not warnings:
            warnings.append({"code": "WEATHER_UNAVAILABLE", "message": "Some forecasts are unavailable; those checkpoints are Unknown."})
        return results, list({w["code"]: w for w in warnings}.values())
