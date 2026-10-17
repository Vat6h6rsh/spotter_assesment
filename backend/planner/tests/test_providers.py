from datetime import datetime, timezone

import httpx
import pytest

from planner.domain.geometry import interpolate
from planner.providers.base import ProviderError
from planner.providers.geocode_photon import PhotonGeocoder
from planner.providers.geocode_tomtom import TomTomGeocoder
from planner.providers.openmeteo import OpenMeteo
from planner.providers.osrm import OSRMRouter
from planner.providers.tomtom import TomTomRouter

DEPARTURE = datetime(2026, 10, 16, 11, tzinfo=timezone.utc)
ORIGIN, DESTINATION = (41.525, -88.081), (39.739, -104.990)


def test_osrm_recorded_adapter_and_request(offline, fixture_json):
    raw = fixture_json("osrm.json")
    mock = offline.get(url__startswith="https://router.project-osrm.org/route/v1/driving/").mock(return_value=httpx.Response(200, json=raw))
    result = OSRMRouter().routes(ORIGIN, DESTINATION, DEPARTURE, 42000)
    assert result.provider == "osrm" and not result.truck_aware
    assert len(result.routes) == 2
    params = mock.calls[0].request.url.params
    assert dict(params) == {"alternatives": "3", "overview": "full", "geometries": "polyline", "annotations": "distance,duration", "steps": "true"}
    assert "-88.081,41.525;-104.99,39.739" in str(mock.calls[0].request.url)
    for route, recorded in zip(result.routes, raw["routes"]):
        g = route.geometry
        assert len(g.points) == len(g.cum_m) == len(g.cum_drive_s)
        assert g.cum_drive_s[-1] == pytest.approx(sum(sum(leg["annotation"]["duration"]) for leg in recorded["legs"]))
        assert g.cum_drive_s[1] == recorded["legs"][0]["annotation"]["duration"][0]
        assert route.label


def test_tomtom_documented_shape_and_every_parameter(offline, fixture_json, settings):
    settings.TOMTOM_API_KEY = "fixture-key"
    mock = offline.get(url__startswith="https://api.tomtom.com/routing/1/calculateRoute/").mock(return_value=httpx.Response(200, json=fixture_json("tomtom_shape.json")))
    result = TomTomRouter().routes(ORIGIN, DESTINATION, DEPARTURE, 42000)
    assert result.truck_aware and result.provider == "tomtom"
    params = dict(mock.calls[0].request.url.params)
    assert params == {"key": "fixture-key", "travelMode": "truck", "vehicleCommercial": "true",
        "vehicleWeight": str(round(77000 * 0.45359237)), "vehicleHeight": "4.11", "vehicleLength": "22", "vehicleWidth": "2.6",
        "vehicleMaxSpeed": "105", "departAt": "2026-10-16T11:00:00Z", "maxAlternatives": "2", "alternativeType": "anyRoute",
        "instructionsType": "coded", "routeRepresentation": "polyline", "traffic": "true"}
    route = result.routes[0]
    assert route.label == "I-76 / I-80"
    assert route.geometry.cum_drive_s == pytest.approx([0, 50, 175, 300], abs=0.001)
    assert interpolate(route.geometry.cum_m, route.geometry.cum_drive_s, route.geometry.cum_m[1]) == pytest.approx(50)


@pytest.mark.parametrize("provider,fixture,url", [
    (TomTomGeocoder, "geocode_tomtom_shape.json", "https://api.tomtom.com/search/2/search/"),
    (PhotonGeocoder, "photon_shape.json", "https://photon.komoot.io/api"),
])
def test_geocoder_shapes_and_us_canada_filter(provider, fixture, url, offline, fixture_json, settings):
    settings.TOMTOM_API_KEY = "fixture-key"
    mock = offline.get(url__startswith=url).mock(return_value=httpx.Response(200, json=fixture_json(fixture)))
    results = provider().search("Joliet, IL", 5)
    assert results[0].lat == 41.525 and results[0].lon == -88.081
    assert results[0].tz == "America/Chicago"
    assert len(results) == (2 if provider is PhotonGeocoder else 1)
    params = mock.calls[0].request.url.params
    if provider is TomTomGeocoder:
        assert params["countrySet"] == "US,CA" and params["typeahead"] == "true"


def test_openmeteo_real_multi_location_response(offline, fixture_json):
    raw = fixture_json("openmeteo.json")
    request = fixture_json("openmeteo_request.json")
    locations = list(zip(map(float, request["latitude"].split(",")), map(float, request["longitude"].split(","))))
    mock = offline.get("https://api.open-meteo.com/v1/forecast").mock(return_value=httpx.Response(200, json=raw))
    values = OpenMeteo().fetch(locations)
    assert len(values) == 82
    params = dict(mock.calls[0].request.url.params)
    assert params == {k: str(v) for k, v in request.items()}
    assert len(values[0].wind) == 192
    for series, record in zip(values, raw):
        h = record["hourly"]
        assert series.rain == pytest.approx([a + b for a, b in zip(h["rain"], h["showers"])])
        assert series.snow == h["snowfall"]  # Provider snowfall inches are never converted to liquid equivalents.


def test_openmeteo_single_commercial_missing_values(offline, fixture_json, settings):
    settings.OPEN_METEO_API_KEY = "fixture-key"
    record = fixture_json("openmeteo.json")[0]
    record["hourly"]["rain"][0] = None
    record["hourly"]["snowfall"][1] = None
    mock = offline.get("https://customer-api.open-meteo.com/v1/forecast").mock(return_value=httpx.Response(200, json=record))
    series = OpenMeteo().fetch([ORIGIN])[0]
    assert series.rain[0] is None and series.snow[1] is None
    assert mock.calls[0].request.url.params["apikey"] == "fixture-key"


@pytest.mark.parametrize("router,body,url", [
    (OSRMRouter, {"code": "NoRoute", "routes": []}, "https://router.project-osrm.org"),
    (OSRMRouter, {"code": "Ok", "routes": [{}]}, "https://router.project-osrm.org"),
    (TomTomRouter, {"routes": []}, "https://api.tomtom.com"),
    (TomTomRouter, {"routes": [{}]}, "https://api.tomtom.com"),
])
def test_bad_route_responses_raise_safe_error(router, body, url, offline):
    offline.get(url__startswith=url).mock(return_value=httpx.Response(200, json=body))
    with pytest.raises(ProviderError):
        router().routes(ORIGIN, DESTINATION, DEPARTURE, 0)
