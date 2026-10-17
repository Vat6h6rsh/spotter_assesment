import base64
import copy
from datetime import datetime, timedelta, timezone
import gzip
import json
from zoneinfo import ZoneInfo

import h3
import httpx
import pytest
from django.core.cache import cache

from planner.services.heatmap_service import corridor


def test_health_shape(client):
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "version": "0.5.0", "routing": "osrm", "weather": "open-meteo", "weather_budget": {"used_today": 0, "limit": 9000}}


def test_full_plan_contract_idempotency_and_heatmap(client, plan_request, replay):
    response = client.post("/api/plans", plan_request, format="json")
    assert response.status_code == 200, response.content
    plan = response.json()
    assert set(plan) == {"plan_id", "created_at", "inputs", "providers", "warnings", "recommendation", "routes"}
    assert plan["plan_id"].startswith("p_") and plan["created_at"].endswith("Z")
    assert plan["inputs"]["origin_tz"] == "America/Chicago"
    assert plan["inputs"]["departure_utc"].endswith("Z")
    assert plan["providers"]["routing"] == {"name": "osrm", "truck_aware": False}
    assert {w["code"] for w in plan["warnings"]} >= {"CAR_ROUTING", "FEWER_ROUTES"}
    assert set(plan["recommendation"]) == {"status", "route_id", "reasons", "tradeoff", "departure_advice"}
    assert [route["id"] for route in plan["routes"]] == ["A", "B"]
    for route in plan["routes"]:
        assert set(route) == {"id", "label", "rank", "eligible", "is_fastest", "polyline", "bbox", "distance_mi", "drive_s", "weather_delay_s", "rest_s", "total_s", "arrival_utc", "arrival_tz", "risk", "rests", "progress", "checkpoints"}
        assert route["arrival_tz"] == "America/Denver"
        assert route["arrival_utc"].endswith("Z")
        assert route["total_s"] == route["drive_s"] + route["rest_s"]
        assert set(route["risk"]) == {"miles_by_level", "avg_risk", "coverage", "max_level"}
        assert sum(route["risk"]["miles_by_level"].values()) == pytest.approx(route["distance_mi"])
        assert route["progress"][0] == [0, 0]
        assert route["progress"][-1] == pytest.approx([route["total_s"], route["distance_mi"]])
        for cp in route["checkpoints"]:
            assert set(cp) == {"i", "mi", "lat", "lon", "eta_utc", "tz", "elapsed_s", "level", "wind_mph", "gust_mph", "rain_in", "snow_in", "base_wind_level", "load_adjusted", "drivers", "rule", "forecast_hour_utc", "beyond_horizon", "speed_factor", "slowdown", "place", "place_label", "clears_in_h", "clears_at_utc"}
            assert set(cp["place"]) == {"road", "town", "state", "distance_mi", "direction"}
            assert cp["place_label"] and cp["place"]["town"]
            assert cp["eta_utc"].endswith("Z") and cp["tz"]
        for rest in route["rests"]:
            assert set(rest) == {"at_mi", "start_utc", "duration_s", "kind", "lat", "lon"}
    calls = (replay["osrm"].call_count, replay["weather"].call_count)
    again = client.post("/api/plans", plan_request, format="json").json()
    assert again == plan
    assert (replay["osrm"].call_count, replay["weather"].call_count) == calls
    response = client.get(f"/api/plans/{plan['plan_id']}/heatmap")
    assert response.status_code == 200, response.content
    heatmap = response.json()
    assert set(heatmap) == {"plan_id", "res", "base_utc", "hours", "cells", "levels_b64", "fetched_at"}
    assert heatmap["hours"] == 49 and heatmap["res"] in {3, 4}
    assert len(heatmap["cells"]) <= 600
    assert all(h3.get_resolution(cell) == heatmap["res"] for cell in heatmap["cells"])
    levels = base64.b64decode(heatmap["levels_b64"])
    assert len(levels) == 49 * len(heatmap["cells"])
    assert set(levels) <= {0, 1, 2, 3, 4, 255}
    assert datetime.fromisoformat(heatmap["base_utc"]).minute == 0
    heatmap_calls = replay["weather"].call_count
    assert client.get(f"/api/plans/{plan['plan_id']}/heatmap").json() == heatmap
    assert replay["weather"].call_count == heatmap_calls
    assert len(gzip.compress(json.dumps(heatmap).encode())) < 20000


@pytest.mark.parametrize("path,value,field", [
    (("cargo_lb",), -1, "cargo_lb"), (("cargo_lb",), 80001, "cargo_lb"),
    (("cargo_lb",), "NaN", "cargo_lb"), (("cargo_lb",), "Infinity", "cargo_lb"),
    (("spacing_mi",), 20, "spacing_mi"), (("wind_measure",), "average", "wind_measure"),
    (("origin", "lat"), 0, "origin.lat"), (("destination", "lon"), 10, "destination.lon"),
    (("departure_local",), "garbage", "departure_local"), (("departure_local",), "2026-01-01T00:00", "departure_local"),
    (("departure_local",), "2030-01-01T00:00", "departure_local"), (("departure_local",), "2026-10-15T10:00Z", "departure_local"),
    (("rest",), {"mode": "custom"}, "rest.drive_hours"), (("rest",), {"mode": "random"}, "rest.mode"),
    (("rest",), {"mode": "custom", "drive_hours": 0.9, "rest_hours": 1}, "rest.drive_hours"),
    (("rest",), {"mode": "custom", "drive_hours": 11.1, "rest_hours": 1}, "rest.drive_hours"),
    (("rest",), {"mode": "custom", "drive_hours": 1, "rest_hours": 0.49}, "rest.rest_hours"),
    (("rest",), {"mode": "custom", "drive_hours": 1, "rest_hours": 34.01}, "rest.rest_hours"),
])
def test_plan_validation_error_contract(client, plan_request, path, value, field):
    data = copy.deepcopy(plan_request)
    target = data
    for key in path[:-1]:
        target = target[key]
    target[path[-1]] = value
    response = client.post("/api/plans", data, format="json")
    assert response.status_code == 400
    error = response.json()["error"]
    assert set(error) == {"code", "message", "field"}
    assert error["code"] == "VALIDATION_ERROR" and error["field"] == field


@pytest.mark.parametrize("cargo,spacing,rest", [(0, 10, {"mode": "none"}), (80000, 50, {"mode": "custom", "drive_hours": 1, "rest_hours": 0.5}), (42000, 25, {"mode": "custom", "drive_hours": 11, "rest_hours": 34})])
def test_valid_edges(client, plan_request, replay, cargo, spacing, rest):
    plan_request.update(cargo_lb=cargo, spacing_mi=spacing, rest=rest)
    response = client.post("/api/plans", plan_request, format="json")
    assert response.status_code == 200
    if rest["mode"] == "none":
        assert all(route["rest_s"] == 0 for route in response.json()["routes"])


def test_origin_equal_destination_and_defaults(client, plan_request, replay):
    same = copy.deepcopy(plan_request)
    same["destination"] = same["origin"]
    assert client.post("/api/plans", same, format="json").json()["error"]["field"] == "destination"
    for key in ("spacing_mi", "rest", "wind_measure"):
        plan_request.pop(key)
    plan = client.post("/api/plans", plan_request, format="json").json()
    assert plan["inputs"]["spacing_mi"] == 25
    assert plan["inputs"]["wind_measure"] == "gust"
    assert plan["inputs"]["rest"] == {"mode": "auto"}


def test_geocode_normalisation_caching_and_error_contract(client, replay):
    response = client.get("/api/geocode", {"q": "  Joliet,   IL  "})
    assert response.status_code == 200
    place = response.json()["results"][0]
    assert set(place) == {"id", "label", "lat", "lon", "tz"}
    assert place["label"] == "Joliet, IL, USA" and place["tz"] == "America/Chicago"
    client.get("/api/geocode", {"q": "joliet, il"})
    assert replay["geocode"].call_count == 1
    assert replay["photon"].call_count == 0
    assert client.get("/api/geocode", {"q": "ab"}).status_code == 400
    assert client.get("/api/geocode", {"q": "abc", "limit": 0}).status_code == 400


def test_heatmap_expired(client):
    response = client.get("/api/plans/p_missing/heatmap")
    assert response.status_code == 404 and response.json()["error"]["code"] == "PLAN_EXPIRED"


def test_routing_failure_503(client, plan_request, offline):
    offline.get(url__startswith="https://router.project-osrm.org").mock(return_value=httpx.Response(403))
    response = client.post("/api/plans", plan_request, format="json")
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "PROVIDER_UNAVAILABLE"


def test_no_weather_is_tentative_unknown(client, plan_request, replay):
    replay["weather"].mock(return_value=httpx.Response(403))
    response = client.post("/api/plans", plan_request, format="json")
    assert response.status_code == 200
    plan = response.json()
    assert plan["recommendation"]["status"] == "tentative"
    for route in plan["routes"]:
        assert route["risk"]["avg_risk"] is None and route["risk"]["coverage"] == 0
        assert all(cp["level"] is None for cp in route["checkpoints"])


@pytest.mark.parametrize("route_count", [2, 3])
def test_gzip_cors_and_1000_mile_10_spacing_payload(client, plan_request, replay, fixture_json, route_count):
    if route_count == 3:
        from planner.domain.geometry import decode_polyline, encode_polyline
        raw = fixture_json("osrm.json")
        third = copy.deepcopy(raw["routes"][1])
        points = decode_polyline(third["geometry"])
        # A synthetic distinct corridor exercises the three-route payload budget.
        points[1:-1] = [(lat + 0.25, lon) for lat, lon in points[1:-1]]
        third["geometry"] = encode_polyline(points)
        raw["routes"].append(third)
        replay["osrm"].mock(return_value=httpx.Response(200, json=raw))
    plan_request["spacing_mi"] = 10
    response = client.post("/api/plans", plan_request, format="json", HTTP_ACCEPT_ENCODING="gzip", HTTP_ORIGIN="http://localhost:5173")
    assert response.status_code == 200
    assert response["Content-Encoding"] == "gzip"
    assert response["Access-Control-Allow-Origin"] == "http://localhost:5173"
    assert len(response.content) < 60000
    assert len(json.loads(gzip.decompress(response.content))["routes"]) == route_count


@pytest.mark.parametrize("endpoint,limit", [("geocode", 120), ("plans", 30)])
def test_per_ip_throttles(client, endpoint, limit):
    # Invalid requests still consume their endpoint's per-IP allowance.
    request = (lambda: client.get("/api/geocode", {"q": "a"})) if endpoint == "geocode" else (lambda: client.post("/api/plans", {}, format="json"))
    for _ in range(limit):
        assert request().status_code == 400
    assert request().status_code == 429


def test_tomtom_fails_over_to_osrm_and_keyless_geocoding(client, plan_request, replay, offline, settings):
    settings.TOMTOM_API_KEY = "fixture-key"
    offline.get(url__startswith="https://api.tomtom.com/").mock(return_value=httpx.Response(403))
    assert client.get("/api/geocode", {"q": "Joliet"}).status_code == 200
    plan = client.post("/api/plans", plan_request, format="json").json()
    assert plan["providers"]["routing"]["name"] == "osrm"
    assert replay["geocode"].call_count == 1


def test_geocode_falls_back_to_photon_when_open_meteo_has_no_match(client, replay):
    replay["geocode"].mock(return_value=httpx.Response(200, json={}))
    assert client.get("/api/geocode", {"q": "Zzyzx Road"}).status_code == 200
    assert replay["photon"].call_count == 1


@pytest.mark.parametrize("delta_s,valid", [(-3600, True), (-3601, False), (72 * 3600, True), (72 * 3600 + 1, False)])
def test_departure_window_inclusive_boundaries(plan_request, monkeypatch, delta_s, valid):
    from planner.api.serializers import PlanSerializer
    fixed = datetime(2026, 10, 15, 12, tzinfo=timezone.utc)
    class FrozenDateTime(datetime):
        @classmethod
        def now(cls, tz=None):
            return fixed if tz is not None else fixed.replace(tzinfo=None)
    monkeypatch.setattr("planner.api.serializers.datetime", FrozenDateTime)
    departure = (fixed + timedelta(seconds=delta_s)).astimezone(ZoneInfo("America/Chicago"))
    plan_request["departure_local"] = departure.strftime("%Y-%m-%dT%H:%M:%S")
    assert PlanSerializer(data=plan_request).is_valid() is valid


@pytest.mark.parametrize("local,clock", [("2026-11-01T01:30", datetime(2026, 10, 31, tzinfo=timezone.utc)), ("2027-03-14T02:30", datetime(2027, 3, 13, tzinfo=timezone.utc))])
def test_dst_ambiguous_and_nonexistent_local_departures(plan_request, monkeypatch, local, clock):
    from planner.api.serializers import PlanSerializer
    class FrozenDateTime(datetime):
        @classmethod
        def now(cls, tz=None):
            return clock
    monkeypatch.setattr("planner.api.serializers.datetime", FrozenDateTime)
    plan_request["departure_local"] = local
    serializer = PlanSerializer(data=plan_request)
    assert not serializer.is_valid()
    assert "daylight saving" in str(serializer.errors["departure_local"])


def test_plan_lives_one_hour_independently_of_result_cache(client, plan_request, replay):
    plan = client.post("/api/plans", plan_request, format="json").json()
    cached = cache.get(f"plan:v1:{plan['plan_id']}")
    assert cached is not None
    assert client.get(f"/api/plans/{plan['plan_id']}/heatmap").status_code == 200
    cache.delete(f"plan:v1:{plan['plan_id']}")
    assert client.get(f"/api/plans/{plan['plan_id']}/heatmap").status_code == 404


def test_budget_warning_header_preserves_heatmap_json_contract(client, plan_request, replay, settings):
    from planner.services.weather_store import budget_key
    plan = client.post("/api/plans", plan_request, format="json").json()
    settings.WEATHER_DAILY_BUDGET = 100
    cache.set(budget_key(), 100, 60)
    response = client.get(f"/api/plans/{plan['plan_id']}/heatmap", HTTP_ORIGIN="http://localhost:5173")
    assert response.status_code == 200
    assert set(response.json()) == {"plan_id", "res", "base_utc", "hours", "cells", "levels_b64", "fetched_at"}
    assert json.loads(response["X-Weather-Warnings"])[0]["code"] == "WEATHER_BUDGET"
    assert "X-Weather-Warnings" in response["Access-Control-Expose-Headers"]
    assert set(base64.b64decode(response.json()["levels_b64"])) == {255}
