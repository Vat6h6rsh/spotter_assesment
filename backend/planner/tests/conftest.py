import copy
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path

import httpx
import pytest
import respx
from django.core.cache import cache
from rest_framework.test import APIClient

FIXTURES = Path(__file__).parent / "fixtures"


@pytest.fixture(autouse=True)
def offline(settings):
    """Any unexpected HTTP request is a test failure, including management tests."""
    settings.TOMTOM_API_KEY = ""
    settings.OPEN_METEO_API_KEY = ""
    settings.ALLOWED_HOSTS = ["testserver", "localhost", "127.0.0.1"]
    cache.clear()
    with respx.mock(assert_all_mocked=True, assert_all_called=False) as router:
        yield router
    cache.clear()


@pytest.fixture
def fixture_json():
    def read(name):
        return json.loads((FIXTURES / name).read_text(encoding="utf-8"))
    return read


@pytest.fixture
def client():
    return APIClient()


@pytest.fixture
def plan_request():
    from zoneinfo import ZoneInfo
    now = datetime.now(timezone.utc) + timedelta(hours=1)
    return {
        "origin": {"label": "Joliet, IL, USA", "lat": 41.525, "lon": -88.081},
        "destination": {"label": "Denver, CO, USA", "lat": 39.739, "lon": -104.990},
        "departure_local": now.astimezone(ZoneInfo("America/Chicago")).strftime("%Y-%m-%dT%H:%M"),
        "cargo_lb": 42000, "spacing_mi": 25, "wind_measure": "gust", "rest": {"mode": "auto"},
    }


@pytest.fixture
def replay(offline, fixture_json):
    osrm = offline.get(url__startswith="https://router.project-osrm.org/route/v1/driving/").mock(
        return_value=httpx.Response(200, json=fixture_json("osrm.json")))
    original = fixture_json("openmeteo.json")
    midnight = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)

    def weather_response(request):
        count = len(request.url.params["latitude"].split(","))
        records = []
        for i in range(count):
            record = copy.deepcopy(original[i % len(original)])
            record["hourly"]["time"] = [(midnight + timedelta(hours=h)).strftime("%Y-%m-%dT%H:%M") for h in range(len(record["hourly"]["time"]))]
            records.append(record)
        return httpx.Response(200, json=records if count > 1 else records[0])

    weather = offline.get(url__startswith="https://api.open-meteo.com/v1/forecast").mock(side_effect=weather_response)
    photon = offline.get(url__startswith="https://photon.komoot.io/api").mock(return_value=httpx.Response(200, json=fixture_json("photon_shape.json")))
    geocode = offline.get(url__startswith="https://geocoding-api.open-meteo.com/v1/search").mock(
        return_value=httpx.Response(200, json=fixture_json("openmeteo_geocode.json")))
    return {"osrm": osrm, "weather": weather, "photon": photon, "geocode": geocode}
