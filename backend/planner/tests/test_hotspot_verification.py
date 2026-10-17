"""Full hotspot -> create_plan replay, with synthetic TomTom/Open-Meteo HTTP shapes."""
from datetime import datetime, timedelta, timezone
from io import StringIO
import json
import threading
import time
from zoneinfo import ZoneInfo

from django.core.cache import cache
from django.core.management import call_command
import httpx
import pytest

from planner.api.serializers import PlanSerializer
from planner.domain.corridors import CORRIDORS, connected_points
from planner.domain.geometry import M_PER_MI, haversine
from planner.domain.hotspot import next_departure, showcase_segment
from planner.services import hotspot_service as service
from planner.services.plan_service import create_plan
from planner.services.weather_store import budget_usage


@pytest.fixture
def showcase_replay(offline, settings, monkeypatch):
    settings.TOMTOM_API_KEY = 'offline-test-key'
    chosen = tuple(c for c in CORRIDORS if c.road in ('I-75', 'I-10', 'I-80', 'I-90'))
    monkeypatch.setattr(service, 'CORRIDORS', chosen)
    now = datetime.now(timezone.utc)
    midnight = now.replace(hour=0, minute=0, second=0, microsecond=0)
    config = {'misses': 0, 'always_miss': False, 'block': None}

    def weather(request):
        count = len(request.url.params['latitude'].split(','))
        records = []
        for _ in range(count):
            records.append({'hourly': {
                'time': [(midnight + timedelta(hours=i)).strftime('%Y-%m-%dT%H:%M') for i in range(192)],
                'wind_speed_10m': [10] * 192, 'wind_gusts_10m': [50] * 192,
                'rain': [0] * 192, 'showers': [0] * 192, 'snowfall': [0] * 192}})
        return httpx.Response(200, json=records if count > 1 else records[0])

    def routing(request):
        if config['block'] is not None:
            config['block'].wait(2)
        coords = request.url.path.split('/calculateRoute/')[1].split('/json')[0]
        start, end = [tuple(map(float, value.split(','))) for value in coords.split(':')]
        miss = config['always_miss'] or config['misses'] > 0
        config['misses'] -= 1
        # A very short returned route has <25 High miles (and no No Travel when
        # configured below); otherwise return a genuine endpoint-to-endpoint shape.
        if miss:
            end = (start[0] + 0.01, start[1])
        length = haversine(start, end)
        duration = length / M_PER_MI / 55 * 3600
        return httpx.Response(200, json={'routes': [{
            'summary': {'lengthInMeters': length, 'travelTimeInSeconds': duration},
            'legs': [{'points': [{'latitude': p[0], 'longitude': p[1]} for p in (start, end)]}],
            'guidance': {'instructions': [
                {'routeOffsetInMeters': 0, 'travelTimeInSeconds': 0, 'pointIndex': 0, 'roadNumbers': ['I-10']},
                {'routeOffsetInMeters': length, 'travelTimeInSeconds': duration, 'pointIndex': 1}]}}]})

    weather_route = offline.get('https://api.open-meteo.com/v1/forecast').mock(side_effect=weather)
    routes = offline.get(url__startswith='https://api.tomtom.com/routing/1/calculateRoute/').mock(side_effect=routing)
    offline.get('https://api.weather.gov/alerts/active').mock(return_value=httpx.Response(200, json={'features': []}))
    # 40 mph is Severe for this cargo, so a short missed route cannot qualify via No Travel.
    def severe_weather(request):
        response = weather(request)
        payload = response.json()
        for record in payload if isinstance(payload, list) else [payload]:
            record['hourly']['wind_gusts_10m'] = [40] * 192
        return httpx.Response(200, json=payload)
    weather_route.mock(side_effect=severe_weather)
    return config, routes, weather_route


@pytest.mark.parametrize('road,place', [('I-10', 'El Paso, TX'), ('I-75', 'Fort Myers, FL'),
                                       ('I-80', 'Cheyenne, WY')])
def test_endpoints_bracket_peak_on_connected_interstate(road, place):
    corridor = next(c for c in CORRIDORS if c.road == road and any(p.place == place for p in c.points))
    points = connected_points(corridor, CORRIDORS)
    peak = next(p for p in points if p.place == place)
    origin, destination, approach = showcase_segment(points, peak)
    assert points.index(origin) < points.index(peak) < points.index(destination)
    assert 0 < approach <= 300
    exit_mi = sum(haversine((a.lat, a.lon), (b.lat, b.lon)) / M_PER_MI
                  for a, b in zip(points[points.index(peak):points.index(destination)],
                                  points[points.index(peak) + 1:points.index(destination) + 1]))
    assert 150 <= exit_mi <= 300
    if place == 'Fort Myers, FL':
        assert origin.place == 'Naples, FL'  # Miami invites the original I-95 shortcut.
        assert destination.state == 'FL'
    else:
        assert 150 <= approach <= 300


def test_catalogue_end_cannot_be_bracketed():
    points = CORRIDORS[0].points
    assert showcase_segment(points, points[0]) is None
    assert showcase_segment(points, points[-1]) is None


@pytest.mark.parametrize('now,peak,miles,tz,expected', [
    ('2026-10-17T05:30:00Z', '2026-10-17T23:00:00Z', 220, 'America/New_York', '2026-10-17T15:00'),
    ('2026-10-17T05:30:00Z', '2026-10-17T23:10:00Z', 220, 'America/Phoenix', '2026-10-17T13:00'),
    ('2026-10-17T05:30:45Z', '2026-10-17T06:00:00Z', 220, 'America/New_York', '2026-10-17T01:00'),
    ('2026-10-17T05:30:00Z', '2026-10-30T23:00:00Z', 220, 'America/New_York', '2026-10-20T01:00'),
    ('2027-03-14T05:30:00Z', '2027-03-14T08:20:00Z', 55, 'America/New_York', '2027-03-14T04:00'),
    ('2026-11-01T03:00:00Z', '2026-11-01T07:00:00Z', 110, 'America/New_York', '2026-11-01T02:00'),
    # Upper clamp falls in the repeated hour; choose the last representable hour.
    ('2026-10-29T06:30:00Z', '2026-11-10T00:00:00Z', 55, 'America/New_York', '2026-11-01T00:00'),
])
def test_peak_arrival_timing_clamps_and_dst(now, peak, miles, tz, expected):
    at = datetime.fromisoformat(now)
    result = next_departure(at, tz, datetime.fromisoformat(peak), miles)
    assert result == expected
    utc = datetime.fromisoformat(result).replace(tzinfo=ZoneInfo(tz)).astimezone(timezone.utc)
    assert at - timedelta(hours=1) <= utc <= at + timedelta(hours=72)  # the plan API accepts now - 1 h


def test_real_pipeline_verifies_contract_budget_cache_and_warming(showcase_replay, client):
    _, routing, weather = showcase_replay
    output = StringIO()
    call_command('warm_hotspot', stdout=output)
    data = json.loads(output.getvalue())
    assert data['available'] and data['more']
    assert data == client.get('/api/weather/hotspot').json()
    calls, used = routing.call_count, budget_usage()['used_today']
    for item in [data, *data['more']]:
        trip = item['suggested_trip']
        assert set(trip['verified']) == {'max_level', 'high_or_worse_mi', 'route_label'}
        serializer = PlanSerializer(data=trip)
        assert serializer.is_valid(), serializer.errors
        plan = create_plan(serializer.validated_data)
        assert trip['verified'] == service.verified_exposure(plan)
        assert trip['verified']['max_level'] == 3
        assert trip['verified']['high_or_worse_mi'] >= 25
    assert routing.call_count == calls <= 3
    assert budget_usage()['used_today'] == used > 0 and weather.called
    assert cache.get(service.CACHE_KEY) == data


def test_failed_first_real_plan_tries_next_candidate(showcase_replay):
    config, routing, _ = showcase_replay
    config['misses'] = 1
    result = service.get_hotspot()
    assert result['available']
    assert 2 <= routing.call_count <= 4  # failed main, successful main, <=2 extras
    assert result['suggested_trip']['verified']['high_or_worse_mi'] >= 25


def test_three_failed_real_plans_cache_unavailable(showcase_replay):
    config, routing, _ = showcase_replay
    config['always_miss'] = True
    result = service.get_hotspot()
    assert not result['available'] and 'No showcase trip verified' in result['reason']
    assert routing.call_count == 3
    assert service.get_hotspot() == result and routing.call_count == 3


def test_unverified_more_is_dropped(showcase_replay):
    config, routing, _ = showcase_replay
    original = service.create_plan
    def plan(inputs):
        value = original(inputs)
        config['always_miss'] = True
        return value
    from unittest.mock import patch
    with patch.object(service, 'create_plan', side_effect=plan):
        result = service.get_hotspot()
    assert result['available'] and result['more'] == []
    assert 2 <= routing.call_count <= 3


def test_verification_deadline_drops_inflight_more(showcase_replay, monkeypatch):
    config, routing, _ = showcase_replay
    release, finished = threading.Event(), threading.Event()
    original = service.create_plan
    def plan(inputs):
        try:
            value = original(inputs)
            config['block'] = release
            return value
        finally:
            if release.is_set():
                finished.set()
    monkeypatch.setattr(service, 'create_plan', plan)
    monkeypatch.setattr(service, 'VERIFY_BUDGET_S', 0.2)
    try:
        started = time.monotonic()
        result = service.get_hotspot()
        assert time.monotonic() - started < 1.5
        assert result['available'] and result['more'] == []
        assert routing.call_count <= 2
    finally:
        release.set()
        assert finished.wait(3)


def test_verification_deadline_without_main_returns_cached_false(showcase_replay, monkeypatch):
    config, routing, _ = showcase_replay
    release, finished = threading.Event(), threading.Event()
    config['block'] = release
    original = service.create_plan
    def plan(inputs):
        try:
            return original(inputs)
        finally:
            finished.set()
    monkeypatch.setattr(service, 'create_plan', plan)
    monkeypatch.setattr(service, 'VERIFY_BUDGET_S', 0.05)
    try:
        started = time.monotonic()
        result = service.get_hotspot()
        assert not result['available'] and time.monotonic() - started < 1.5
        assert routing.call_count <= 1
        assert cache.get(service.CACHE_KEY) == result
    finally:
        release.set()
        assert finished.wait(3)
    # A late plan may cache itself, but must not overwrite the negative hotspot.
    assert cache.get(service.CACHE_KEY) == result


def test_provider_error_tries_next_candidate(showcase_replay, monkeypatch):
    from planner.providers.base import ProviderError
    original = service.create_plan
    attempts = []
    def plan(inputs):
        attempts.append(inputs)
        if len(attempts) == 1:
            raise ProviderError('synthetic outage')
        return original(inputs)
    monkeypatch.setattr(service, 'create_plan', plan)
    result = service.get_hotspot()
    assert result['available'] and len(attempts) >= 2
    assert attempts[0]['origin'] != attempts[1]['origin']


@pytest.mark.parametrize('high,severe,blocked,qualifies', [(24.9, 0, 0, False), (15, 10, 0, True),
                                                       (0, 0, .1, True)])
def test_only_recommended_or_fastest_exposure_qualifies(high, severe, blocked, qualifies):
    def route(id, fastest, h, s, n):
        return {'id': id, 'is_fastest': fastest, 'label': id,
                'risk': {'miles_by_level': {'low': 100, 'moderate': 0, 'high': h, 'severe': s, 'no_travel': n}}}
    plan = {'recommendation': {'route_id': 'A'}, 'routes': [route('A', False, 0, 0, 0),
        route('B', True, high, severe, blocked), route('C', False, 100, 0, 100)]}
    evidence = service.verified_exposure(plan)
    assert (evidence is not None) is qualifies
    if qualifies:
        assert evidence['route_label'] == 'B'
        assert evidence['max_level'] == (4 if blocked else 3)
    plan['recommendation']['route_id'] = None
    assert (service.verified_exposure(plan) is not None) is qualifies
