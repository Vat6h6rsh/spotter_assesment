import copy
from datetime import datetime, timedelta, timezone

import httpx
import pytest

from planner.domain.geometry import Geometry, M_PER_MI
from planner.domain.weather_delay import adjusted_geometry, owned_edges_m, slowdown


@pytest.mark.parametrize("rain,snow,factor,reason", [
    (0.0, 0.0, 1.0, None),
    (0.019, 0.019, 1.0, None),            # below trace: dry
    (0.02, 0.0, 0.92, "Light rain −8%"),
    (0.2499, 0.0, 0.92, "Light rain −8%"),
    (0.25, 0.0, 0.90, "Heavy rain −10%"),
    (0.0, 0.02, 0.92, "Light snow −8%"),
    (0.0, 0.99, 0.92, "Light snow −8%"),
    (0.0, 1.0, 0.78, "Heavy snow −22%"),
    (0.6, 1.5, 0.78, "Heavy snow −22%"),  # worst factor wins
    (None, None, 1.0, None),              # unknown weather: no adjustment (coverage flags it)
])
def test_slowdown_thresholds(rain, snow, factor, reason):
    result = slowdown(rain, snow)
    assert result.factor == factor and result.reason == reason


def straight_route(miles: float = 100, mph: float = 50) -> Geometry:
    n = 101
    cum_m = [miles * M_PER_MI * i / (n - 1) for i in range(n)]
    return Geometry([(40.0, -100 + i * 0.01) for i in range(n)], cum_m, [m / M_PER_MI / mph * 3600 for m in cum_m])


def test_identity_when_no_slowdown():
    g = straight_route()
    assert adjusted_geometry(g, [0, 25, 50, 75, 100], [1.0] * 5) is g


def test_owned_stretches_are_slowed_exactly():
    g = straight_route(100, 50)            # 2 h at 50 mph
    miles = [0, 25, 50, 75, 100]
    # Owned stretches: 0-12.5, 12.5-37.5, 37.5-62.5, 62.5-87.5, 87.5-100 mi. Slow the middle one (25 mi) to 0.78.
    adjusted = adjusted_geometry(g, miles, [1, 1, 0.78, 1, 1])
    base_middle = 25 / 50 * 3600
    assert adjusted.cum_drive_s[-1] == pytest.approx(7200 + base_middle / 0.78 - base_middle)
    assert adjusted.cum_m == g.cum_m and adjusted.points == g.points
    assert all(b >= a for a, b in zip(adjusted.cum_drive_s, adjusted.cum_drive_s[1:]))
    # Before the slowed stretch nothing changes.
    assert adjusted.at_m(30 * M_PER_MI)[1] == pytest.approx(g.at_m(30 * M_PER_MI)[1])


def test_edges_tile_route():
    assert owned_edges_m([0, 25, 50, 60])[1:-1] == pytest.approx([12.5 * M_PER_MI, 37.5 * M_PER_MI, 55 * M_PER_MI])


def test_rejects_bad_factors():
    with pytest.raises(ValueError):
        adjusted_geometry(straight_route(), [0, 100], [1.0])
    with pytest.raises(ValueError):
        adjusted_geometry(straight_route(), [0, 100], [0.0, 1.0])


def snowy_weather(replay, fixture_json):
    """Re-mock Open-Meteo so every hour has heavy snow (1.5 in/hr) and calm wind."""
    original = fixture_json("openmeteo.json")
    midnight = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)

    def response(request):
        count = len(request.url.params["latitude"].split(","))
        records = []
        for i in range(count):
            record = copy.deepcopy(original[i % len(original)])
            hours = len(record["hourly"]["time"])
            record["hourly"]["time"] = [(midnight + timedelta(hours=h)).strftime("%Y-%m-%dT%H:%M") for h in range(hours)]
            record["hourly"].update({"wind_speed_10m": [5.0] * hours, "wind_gusts_10m": [8.0] * hours,
                                     "rain": [0.0] * hours, "showers": [0.0] * hours, "snowfall": [1.5] * hours})
            records.append(record)
        return httpx.Response(200, json=records if count > 1 else records[0])

    replay["weather"].mock(side_effect=response)


def test_plan_adds_weather_delay_only_when_enabled(client, plan_request, replay, fixture_json):
    snowy_weather(replay, fixture_json)
    slowed = client.post("/api/plans", plan_request, format="json").json()
    plain = client.post("/api/plans", {**plan_request, "weather_slowdown": False}, format="json").json()
    for fast, slow in zip(plain["routes"], slowed["routes"]):
        assert fast["weather_delay_s"] == 0
        # Heavy snow everywhere: drive time / 0.78, so the delay is about 28% of the base drive time.
        assert slow["weather_delay_s"] == pytest.approx(fast["drive_s"] * (1 / 0.78 - 1), rel=0.02)
        assert slow["drive_s"] == pytest.approx(fast["drive_s"] + slow["weather_delay_s"])
        assert slow["total_s"] > fast["total_s"]
        assert {cp["slowdown"] for cp in slow["checkpoints"]} == {"Heavy snow −22%"}
        assert {cp["speed_factor"] for cp in fast["checkpoints"]} == {1.0}
