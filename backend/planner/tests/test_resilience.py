from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
import threading
import time

import h3
import httpx
import pytest
from django.core.cache import cache

from planner.domain.weather import WeatherSeries
from planner.providers.base import ProviderError
from planner.providers.resilience import get_json, singleflight
from planner.services.heatmap_service import build_heatmap
from planner.services.weather_store import WeatherStore, budget_key, budget_usage, reserve_budget


@pytest.mark.parametrize("status,expected_calls", [(403, 1), (429, 2), (500, 2)])
def test_one_retry_only_for_transient_errors(status, expected_calls, offline):
    mock = offline.get("https://provider.test/data").mock(return_value=httpx.Response(status))
    with pytest.raises(ProviderError):
        get_json("example", "https://provider.test/data", {})
    assert mock.call_count == expected_calls


def test_circuit_opens_at_five_failures_and_closes_after_expiry(offline, monkeypatch):
    mock = offline.get("https://provider.test/data").mock(return_value=httpx.Response(403))
    for _ in range(5):
        with pytest.raises(ProviderError):
            get_json("example", "https://provider.test/data", {})
    with pytest.raises(ProviderError, match="temporarily"):
        get_json("example", "https://provider.test/data", {})
    assert mock.call_count == 5
    cache.delete("circuit:example:open")  # Simulate the 60-second TTL expiring.
    mock.mock(return_value=httpx.Response(200, json={"ok": True}))
    assert get_json("example", "https://provider.test/data", {}) == {"ok": True}
    assert cache.get("circuit:example:failures") is None


def test_singleflight_computes_once_across_threads():
    calls = []
    def compute():
        calls.append(True)
        time.sleep(0.05)
        return {"ok": True}
    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(lambda _: singleflight("example", 60, compute), range(4)))
    assert len(calls) == 1
    assert results == [{"ok": True}] * 4


def test_budget_atomic_and_never_overspends(settings):
    settings.WEATHER_DAILY_BUDGET = 5
    with ThreadPoolExecutor(max_workers=4) as pool:
        reservations = list(pool.map(reserve_budget, [3, 3, 3, 3]))
    assert sum(reservations) == 5
    assert budget_usage() == {"used_today": 5, "limit": 5}


def test_weather_cache_and_exhausted_budget_unknown(settings, replay):
    settings.WEATHER_DAILY_BUDGET = 1
    first, second = h3.latlng_to_cell(41.5, -88, 5), h3.latlng_to_cell(40, -100, 5)
    store = WeatherStore()
    results, warnings = store.get_many([first, first, second])
    assert results[first] is not None and results[second] is None
    assert warnings[0]["code"] == "WEATHER_BUDGET"
    assert replay["weather"].call_count == 1
    again, _ = store.get_many([first])
    assert again[first] == results[first]
    assert replay["weather"].call_count == 1


def test_weather_batches_25_max_and_six_concurrent(monkeypatch):
    cells = list(h3.grid_disk(h3.latlng_to_cell(40, -100, 5), 13))[:401]
    active = peak = 0
    sizes = []
    mutex = threading.Lock()
    start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    series = WeatherSeries(start, [0] * 192, [0] * 192, [0] * 192, [0] * 192, start)
    def fetch(self, locations):
        nonlocal active, peak
        with mutex:
            active += 1
            peak = max(peak, active)
            sizes.append(len(locations))
        time.sleep(0.03)
        with mutex:
            active -= 1
        return [series] * len(locations)
    monkeypatch.setattr("planner.services.weather_store.OpenMeteo.fetch", fetch)
    result, warnings = WeatherStore().get_many(cells)
    assert all(result.values()) and not warnings
    assert sorted(sizes) == [1] + [25] * 16  # 401 cells
    assert peak <= 6


def test_weather_scan_deadline_keeps_inflight_locks_and_caches_late_result(monkeypatch):
    release = threading.Event()
    finished = threading.Event()
    cell = h3.latlng_to_cell(40, -100, 5)
    now = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    series = WeatherSeries(now, [0.] * 192, [0.] * 192, [0.] * 192, [0.] * 192, now)
    def fetch(self, locations):
        release.wait(2)
        finished.set()
        return [series] * len(locations)
    monkeypatch.setattr('planner.services.weather_store.OpenMeteo.fetch', fetch)
    try:
        started = time.monotonic()
        results, warnings = WeatherStore().get_many([cell], time_budget_s=0.05)
        assert time.monotonic() - started < 1
        assert results[cell] is None and warnings[0]['code'] == 'WEATHER_UNAVAILABLE'
        assert cache.get(f'lock:wx:v1:{cell}') is not None
    finally:
        release.set()
        assert finished.wait(2)
        deadline = time.monotonic() + 2
        while cache.get(f'lock:wx:v1:{cell}') and time.monotonic() < deadline:
            time.sleep(0.005)
    assert cache.get(f'wx:v1:{cell}') == series
    assert cache.get(f'lock:wx:v1:{cell}') is None


@pytest.mark.parametrize("used,expected_res", [(70, 4), (71, 3), (100, 3)])
def test_heatmap_budget_resolution_and_unknown(used, expected_res, settings):
    settings.WEATHER_DAILY_BUDGET = 100
    cache.set(budget_key(), used, 60)
    # Zero remaining calls; patching store avoids network while testing corridor policy.
    from unittest.mock import patch
    from planner.services.heatmap_service import corridor
    points = [[(41.5, -88), (41.6, -88)]]
    now = datetime.now(timezone.utc)
    plan = {"points": points, "result": {"inputs": {"departure_utc": now.isoformat(), "cargo_lb": 0, "wind_measure": "gust"}}}
    with patch.object(WeatherStore, "get_many", side_effect=lambda cells: ({cell: None for cell in cells}, [])):
        result = build_heatmap("p_test", plan)
    assert result["res"] == expected_res
    import base64
    assert set(base64.b64decode(result["levels_b64"])) == {255}


def test_weather_stampede_lock_fetches_each_cell_once(monkeypatch):
    calls = []
    now = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    series = WeatherSeries(now, [0] * 192, [0] * 192, [0] * 192, [0] * 192, now)
    def fetch(self, locations):
        calls.append(len(locations))
        time.sleep(0.05)
        return [series] * len(locations)
    monkeypatch.setattr("planner.services.weather_store.OpenMeteo.fetch", fetch)
    cell = h3.latlng_to_cell(40, -100, 5)
    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(lambda _: WeatherStore().get_many([cell]), range(4)))
    assert calls == [1]
    assert all(result[0][cell] == series for result in results)


def test_heatmap_large_corridor_falls_back_to_res3(monkeypatch):
    seen = []
    def fake_corridor(points, res):
        seen.append(res)
        return [f"cell{i}" for i in range(601 if res == 4 else 100)]
    monkeypatch.setattr("planner.services.heatmap_service.corridor", fake_corridor)
    monkeypatch.setattr(WeatherStore, "get_many", lambda self, cells: ({cell: None for cell in cells}, []))
    plan = {"points": [], "result": {"inputs": {"departure_utc": datetime.now(timezone.utc).isoformat(), "cargo_lb": 0, "wind_measure": "gust"}}}
    result = build_heatmap("p_test", plan)
    assert result["res"] == 3 and seen == [4, 3]
