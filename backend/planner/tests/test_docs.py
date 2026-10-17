"""Public documentation checks and recursive field drift protection with offline replay."""
import copy
import re
import httpx
import pytest
from django.contrib.staticfiles import finders
from rest_framework import serializers

from planner.api.schema import PlanResponse, DepartureAdvice, Health, GeocodeResult, HeatmapResponse, Error, HotspotAvailable, HotspotUnavailable


def assert_documented_fields(serializer, data, path="response"):
    """DRF ignores extra keys, so explicitly check every nested object's field names."""
    if data is None:
        assert serializer.allow_null, path
        return
    if isinstance(serializer, serializers.ListSerializer):
        for i, row in enumerate(data):
            assert_documented_fields(serializer.child, row, f"{path}[{i}]")
    elif isinstance(serializer, serializers.Serializer):
        fields = serializer.fields
        assert set(data) <= set(fields), f"Undocumented fields at {path}: {set(data) - set(fields)}"
        assert {key for key, field in fields.items() if field.required} <= set(data), path
        for key, value in data.items():
            assert_documented_fields(fields[key], value, f"{path}.{key}")
    elif isinstance(serializer, serializers.ListField):
        for i, value in enumerate(data):
            assert_documented_fields(serializer.child, value, f"{path}[{i}]")


def assert_matches(serializer_class, data):
    assert_documented_fields(serializer_class(), data)
    serializer = serializer_class(data=data)
    assert serializer.is_valid(), serializer.errors


def test_schema_contains_five_api_paths(client):
    response = client.get("/api/schema/", HTTP_ACCEPT="application/vnd.oai.openapi+json")
    assert response.status_code == 200
    schema = response.json()
    assert schema["openapi"].startswith("3.")
    assert set(schema["paths"]) == {"/api/health", "/api/geocode", "/api/plans", "/api/plans/{plan_id}/heatmap", "/api/weather/hotspot"}
    assert schema["info"]["title"] == "Spotter Weather Route API"
    assert schema["info"]["version"] == "0.5.0"
    assert "Place names: GeoNames (CC BY 4.0)" in schema["info"]["description"]
    assert schema["paths"]["/api/plans"]["post"]["requestBody"]
    hotspot = schema['paths']['/api/weather/hotspot']['get']
    assert hotspot['tags'] == ['Weather']
    assert set(hotspot['responses']) == {'200', '429'}
    assert len(schema['components']['schemas']['HotspotResponse']['oneOf']) == 2


@pytest.mark.parametrize("path,asset", [
    ("/api/docs/", "drf_spectacular_sidecar/swagger-ui-dist/swagger-ui-bundle.js"),
    ("/api/redoc/", "drf_spectacular_sidecar/redoc/bundles/redoc.standalone.js"),
])
def test_documentation_html_uses_self_hosted_assets(client, settings, path, asset):
    # Unit tests use uncollected assets; deployment runs collectstatic as in README.
    settings.STORAGES = {"staticfiles": {"BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"}}
    response = client.get(path)
    assert response.status_code == 200
    assert response["Content-Type"].startswith("text/html")
    assert f"/static/{asset}" in response.content.decode()
    assert not re.search(r'(?:src|href)=[\"\']https?://', response.content.decode())
    if path == "/api/docs/":
        assert '"validatorUrl": null' in response.content.decode()
    assert finders.find(asset)


def test_api_root_redirects_to_docs(client):
    response = client.get("/api/")
    assert response.status_code == 302
    assert response["Location"] == "/api/docs/"


@pytest.mark.parametrize("mode", ["auto", "none", "custom", "unknown"])
def test_plan_response_documentation_drift(client, plan_request, replay, mode):
    if mode == "unknown":
        replay["weather"].mock(return_value=httpx.Response(403))
    elif mode == "custom":
        plan_request["rest"] = {"mode": "custom", "drive_hours": 2, "rest_hours": 1}
    else:
        plan_request["rest"] = {"mode": mode}
    response = client.post("/api/plans", plan_request, format="json")
    assert response.status_code == 200
    data = response.json()
    assert_matches(PlanResponse, data)
    # Ensure additions or deletions deep in a response actually trip the drift guard.
    changed = copy.deepcopy(data)
    changed["routes"][0]["checkpoints"][0]["undocumented"] = True
    with pytest.raises(AssertionError, match="Undocumented"):
        assert_documented_fields(PlanResponse(), changed)
    del changed["routes"][0]["checkpoints"][0]["level"]
    del changed["routes"][0]["checkpoints"][0]["undocumented"]
    with pytest.raises(AssertionError):
        assert_documented_fields(PlanResponse(), changed)


def test_other_documented_responses(client, plan_request, replay):
    assert_matches(Health, client.get("/api/health").json())
    assert_matches(GeocodeResult, client.get("/api/geocode", {"q": "Joliet"}).json())
    plan = client.post("/api/plans", plan_request, format="json").json()
    assert_matches(HeatmapResponse, client.get(f"/api/plans/{plan['plan_id']}/heatmap").json())
    assert_matches(Error, client.get("/api/plans/p_missing/heatmap").json())


def test_recorded_example_matches_source_and_schema(fixture_json):
    from planner.api.examples import PLAN, REPLAY
    expected = fixture_json("smoke_plan.json")
    for route in expected["routes"]:
        route["checkpoints"] = route["checkpoints"][:3]
    assert PLAN == expected
    assert_matches(PlanResponse, PLAN)
    assert_matches(GeocodeResult, REPLAY["geocode"])
    assert_matches(HeatmapResponse, REPLAY["heatmap"])
    import base64
    heatmap = REPLAY["heatmap"]
    assert len(base64.b64decode(heatmap["levels_b64"])) == heatmap["hours"] * len(heatmap["cells"])
    # Also protect the nullable nested advice object when the current weather yields none.
    assert_matches(DepartureAdvice, {"offset_h": 6, "route_id": "A", "summary": "Leave 6 h later on A: Severe miles 25 → 0"})


def test_all_documentation_fields_have_help_text():
    def walk(field):
        assert field.help_text, repr(field)
        if isinstance(field, serializers.ListSerializer):
            for child in field.child.fields.values():
                walk(child)
        elif isinstance(field, serializers.Serializer):
            for child in field.fields.values():
                walk(child)
        elif isinstance(field, serializers.ListField):
            walk(field.child)
    for cls in (PlanResponse, Health, GeocodeResult, HeatmapResponse, Error, HotspotAvailable, HotspotUnavailable):
        for field in cls().fields.values():
            walk(field)


def test_hotspot_response_drift(client, replay, offline):
    # Fixture-derived weather, real catalogue/service and both HTTP 200 branches.
    offline.get('https://api.weather.gov/alerts/active').mock(return_value=httpx.Response(200, json={
        'features': [{'properties': {'status': 'Actual', 'severity': 'Severe',
                      'event': 'High Wind Warning', 'geocode': {'UGC': ['TXZ418']}}}]}))
    response = client.get('/api/weather/hotspot')
    assert response.status_code == 200 and response.json()['available']
    data = response.json()
    assert_matches(HotspotAvailable, data)
    assert 1 <= len(data['more']) <= 2
    for extra in data['more']:
        assert set(extra) == {'hazard', 'headline', 'summary', 'peak', 'suggested_trip'}
        assert set(extra['peak']) == set(data['peak'])
        assert set(extra['suggested_trip']) == set(data['suggested_trip'])
    changed = copy.deepcopy(data)
    changed['peak']['undocumented'] = True
    with pytest.raises(AssertionError, match='Undocumented'):
        assert_documented_fields(HotspotAvailable(), changed)
    del changed['peak']['undocumented']
    del changed['suggested_trip']['origin']['tz']
    with pytest.raises(AssertionError):
        assert_documented_fields(HotspotAvailable(), changed)
    from django.core.cache import cache
    from planner.services.weather_store import budget_key
    cache.clear()  # Remove weather too: an exhausted budget still permits cached coverage.
    cache.set(budget_key(), 9000, 60)
    unavailable = client.get('/api/weather/hotspot')
    assert unavailable.status_code == 200 and unavailable.json()['available'] is False
    assert_matches(HotspotUnavailable, unavailable.json())
    from planner.api.examples import HOTSPOT, HOTSPOT_UNAVAILABLE_EXAMPLE
    assert_matches(HotspotAvailable, HOTSPOT)
    changed = copy.deepcopy(HOTSPOT)
    changed['more'][0]['peak']['undocumented'] = True
    with pytest.raises(AssertionError, match='Undocumented'):
        assert_documented_fields(HotspotAvailable(), changed)
    del changed['more'][0]['peak']['undocumented']
    del changed['more'][0]['suggested_trip']['origin']['tz']
    with pytest.raises(AssertionError):
        assert_documented_fields(HotspotAvailable(), changed)
    changed = copy.deepcopy(HOTSPOT)
    del changed['more']
    with pytest.raises(AssertionError):
        assert_documented_fields(HotspotAvailable(), changed)
    assert_matches(HotspotUnavailable, HOTSPOT_UNAVAILABLE_EXAMPLE.value)


def test_recorded_checkpoint_clearance_is_reproducible(fixture_json):
    from datetime import datetime
    import h3
    from planner.domain.weather import clearance
    from planner.providers.openmeteo import OpenMeteo
    from planner.services.plan_service import iso

    request = fixture_json('openmeteo_request.json')
    cells = [h3.latlng_to_cell(float(lat), float(lon), 5) for lat, lon in zip(
        request['latitude'].split(','), request['longitude'].split(','))]
    series = dict(zip(cells, map(OpenMeteo.normalise, fixture_json('openmeteo.json'))))
    plan = fixture_json('smoke_plan.json')
    for route in plan['routes']:
        for cp in route['checkpoints']:
            data = series[h3.latlng_to_cell(cp['lat'], cp['lon'], 5)]
            hours, at = clearance(data, datetime.fromisoformat(cp['eta_utc']), cp['level'],
                                  plan['inputs']['cargo_lb'], plan['inputs']['wind_measure'])
            assert cp['clears_in_h'] == hours
            assert cp['clears_at_utc'] == (iso(at) if at else None)


def test_recorded_checkpoint_places_are_reproducible(fixture_json):
    from planner.domain.geometry import M_PER_MI
    from planner.domain.places import checkpoint_places
    from planner.providers.osrm import OSRMRouter
    from planner.providers.util import distinct_routes

    raw = fixture_json("osrm.json")
    routes = distinct_routes([OSRMRouter.normalise(route, i) for i, route in enumerate(raw["routes"])])
    recorded = fixture_json("smoke_plan.json")
    assert len(routes) == len(recorded["routes"])
    for route, example in zip(routes, recorded["routes"]):
        checkpoints = example["checkpoints"]
        places = checkpoint_places(checkpoints, [route.road_at(cp["mi"] * M_PER_MI) for cp in checkpoints])
        assert places == [{key: cp[key] for key in ("place", "place_label")} for cp in checkpoints]
