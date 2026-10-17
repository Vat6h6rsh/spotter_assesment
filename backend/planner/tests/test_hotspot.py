"""Offline weather/alert replay and contract coverage for the welcome demo."""
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from datetime import datetime, timedelta, timezone
from importlib.resources import files
from io import StringIO
import json
import threading
import time

from django.core.cache import cache
from django.core.management import call_command
import h3
import httpx
import pytest
from tzfpy import get_tz

from planner.domain.corridors import CORRIDORS, SamplePoint
from planner.domain.geometry import haversine, M_PER_MI
from planner.domain.hotspot import ALERT_BOOST, describe, hazard_for, next_departure, point_peak, select_more
from planner.domain.weather import WeatherSeries
from planner.providers.base import ProviderError
from planner.providers.nws import active_alerts, parse_alerts, STATE_NAMES
from planner.providers.resilience import USER_AGENT
from planner.services import hotspot_service as service
from planner.services.weather_store import budget_key, budget_usage

NOW = datetime(2026, 10, 17, 5, 30, tzinfo=timezone.utc)
POINT = SamplePoint('El Paso, TX', 31.76, -106.49)


@pytest.fixture(autouse=True)
def qualifying_plan(monkeypatch):
    # Scan orchestration tests isolate verification; test_hotspot_verification
    # exercises the full serializer -> routing -> weather -> classification path.
    monkeypatch.setattr(service, 'create_plan', lambda inputs: {
        'recommendation': {'route_id': 'A'}, 'routes': [{
            'id': 'A', 'label': 'I-10', 'is_fastest': True,
            'risk': {'miles_by_level': {'low': 0, 'moderate': 0, 'high': 25, 'severe': 0, 'no_travel': 0}}}]})


def series(wind=10, gust=10, rain=0, snow=0, start=NOW.replace(minute=0), length=48):
    return WeatherSeries(start, [wind] * length, [gust] * length, [rain] * length, [snow] * length, start)


@pytest.fixture
def scan(offline, fixture_json, monkeypatch):
    # Two genuine catalogue trips, sharing the same production batching path.
    trips = tuple(c for c in CORRIDORS if
                  (c.road == 'I-10' and c.origin.label.startswith('Phoenix')) or
                  (c.road == 'I-80' and c.origin.label.startswith('Salt Lake City')))
    monkeypatch.setattr(service, 'CORRIDORS', trips)
    target = next(p for c in trips for p in c.points if p.place == 'El Paso, TX')
    target_cell = h3.latlng_to_cell(target.lat, target.lon, 5)
    config = {'gust': 50.3, 'wind': 23.2, 'rain': 0.0, 'showers': 0.0, 'snow': 0.0,
              'all_points': False, 'delay': 0}
    midnight = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    peak_index = datetime.now(timezone.utc).hour + 5

    def weather(request):
        time.sleep(config['delay'])
        assert request.headers['User-Agent'] == USER_AGENT
        assert request.extensions['timeout']['read'] == 15.0
        assert request.url.params['hourly'] == 'wind_speed_10m,wind_gusts_10m,rain,showers,snowfall'
        latitudes = request.url.params['latitude'].split(',')
        longitudes = request.url.params['longitude'].split(',')
        assert len(latitudes) <= 25
        records = []
        for lat, lon in zip(latitudes, longitudes):
            cell = h3.latlng_to_cell(float(lat), float(lon), 5)
            hit = cell == target_cell or config['all_points']
            arrays = {'time': [(midnight + timedelta(hours=i)).strftime('%Y-%m-%dT%H:%M') for i in range(192)]}
            for name, key, base in [('wind_speed_10m', 'wind', 5), ('wind_gusts_10m', 'gust', 10),
                                    ('rain', 'rain', 0), ('showers', 'showers', 0), ('snowfall', 'snow', 0)]:
                arrays[name] = [base] * 192
                if hit:
                    arrays[name][peak_index] = config[key]
            records.append({'hourly': arrays})
        return httpx.Response(200, json=records if len(records) > 1 else records[0])

    weather_route = offline.get('https://api.open-meteo.com/v1/forecast').mock(side_effect=weather)
    alerts_route = offline.get('https://api.weather.gov/alerts/active').mock(
        return_value=httpx.Response(200, json=fixture_json('nws_alerts_shape.json')))
    return config, weather_route, alerts_route


def test_catalogue_coverage_coordinates_and_spacing():
    assert 20 <= len(CORRIDORS) <= 30
    points = {p for c in CORRIDORS for p in c.points}
    assert 200 <= len(points) <= 300
    assert {p.state for p in points} == set(STATE_NAMES) - {'DC'}
    assert {'I-5', 'I-10', 'I-15', 'I-20', 'I-25', 'I-35', 'I-40', 'I-55', 'I-65',
            'I-70', 'I-75', 'I-80', 'I-81', 'I-90', 'I-94', 'I-95'} <= {c.road for c in CORRIDORS}
    cities = json.loads(files('geonamescache').joinpath('data/cities500.json').read_text(encoding='utf-8'))
    coordinates = {(round(c['latitude'], 5), round(c['longitude'], 5)) for c in cities.values() if c['countrycode'] == 'US'}
    for p in points:
        assert 24 <= p.lat <= 49.1 and -125 <= p.lon <= -66
        assert (p.lat, p.lon) in coordinates or p.place == 'Gorman, CA'
    gaps = []
    for c in CORRIDORS:
        for endpoint, sample in ((c.origin, c.points[0]), (c.destination, c.points[-1])):
            assert endpoint.label == sample.place + ', USA'
            assert (endpoint.lat, endpoint.lon) == (sample.lat, sample.lon)
            assert endpoint.tz == get_tz(endpoint.lon, endpoint.lat)
        gaps += [haversine((a.lat, a.lon), (b.lat, b.lon)) / M_PER_MI for a, b in zip(c.points, c.points[1:])]
    assert max(gaps) < 180


def test_severity_ranks_before_continuous_exceedance_and_alerts():
    severe_wind = point_peak(POINT, series(gust=40), NOW)
    high_snow = point_peak(POINT, series(snow=1.99), NOW, alert=True)
    severe_rain = point_peak(POINT, series(rain=0.9), NOW)
    assert severe_wind.score > high_snow.score
    assert severe_rain.score > severe_wind.score
    boosted = point_peak(POINT, series(gust=40), NOW, alert=True)
    assert boosted.badness == pytest.approx(severe_wind.badness + ALERT_BOOST)
    assert boosted.score > severe_wind.score
    assert point_peak(POINT, series(gust=45), NOW).score > severe_rain.score


def test_window_maxima_and_classification_use_actual_hours():
    data = series()
    data.gust[5], data.rain[6], data.snow[7] = 40, 0.9, 1.9
    data.wind[8] = 22
    peak = point_peak(POINT, data, NOW)
    assert (peak.wind, peak.gust, peak.rain, peak.snow) == (22, 40, 0.9, 1.9)
    assert peak.classification.level == 3
    assert peak.classification.drivers == ['rain']
    assert peak.at == data.start + timedelta(hours=6)
    # This independent hour has larger normalized rain than the combined maxima's wind.
    assert hazard_for(peak, set()) == 'rain'


def test_window_excludes_past_and_plus_48_boundary():
    data = series(start=NOW.replace(minute=0) - timedelta(hours=1), length=50)
    data.gust[0] = data.gust[49] = 100
    assert point_peak(POINT, data, NOW).gust == 10
    data.gust[48] = 45
    assert point_peak(POINT, data, NOW).classification.level == 4


@pytest.mark.parametrize('data', [None, series(length=47), series(gust=None)])
def test_unknown_or_incomplete_window_is_unavailable(data):
    assert point_peak(POINT, data, NOW) is None


@pytest.mark.parametrize('hazard,conditions,title,value', [
    ('wind', {'gust': 50}, 'High winds', '50 mph'),
    ('rain', {'rain': 0.5}, 'Heavy rain', '0.50 in/hr'),
    ('snow', {'snow': 2}, 'Heavy snow', '2.00 in/hr'),
    ('mixed', {'gust': 40, 'snow': 2}, 'Hazardous weather', '40 mph'),
])
def test_headline_summary_and_why(hazard, conditions, title, value):
    peak = point_peak(POINT, series(**conditions), NOW)
    assert hazard_for(peak, set()) == hazard
    headline, summary, why = describe(peak, 'I-10', hazard, 'Texas', 15, True)
    assert headline == f'{title} on I-10 near El Paso, Texas'
    assert value in summary and 'near El Paso, TX' in summary
    assert summary.endswith('; 15 relevant NWS alerts active.')
    assert 'I-10' in why and 'zone near El Paso, TX' in why
    if peak.classification.level == 4:
        assert 'enough to stop loaded trucks' in summary


def test_alert_parse_groups_dedupes_and_maps_land_ugc(fixture_json):
    alerts = parse_alerts(fixture_json('nws_alerts_shape.json'))
    assert alerts == [
        {'event': 'Blizzard Warning', 'count': 1, 'states': ['CO', 'WY']},
        {'event': 'Flash Flood Warning', 'count': 1, 'states': ['LA', 'MS']},
        {'event': 'High Wind Warning', 'count': 2, 'states': ['AZ', 'NM', 'TX']},
        {'event': 'Red Flag Warning', 'count': 1, 'states': ['TX']},
    ]


def test_nws_request_headers_filters_and_own_circuit(scan):
    _, weather, alerts = scan
    active_alerts()
    request = alerts.calls[0].request
    assert request.headers['User-Agent'] == USER_AGENT
    assert dict(request.url.params) == {'status': 'actual', 'severity': 'Severe,Extreme'}
    cache.set('circuit:nws:open', True, 60)
    with pytest.raises(ProviderError):
        active_alerts()
    assert alerts.call_count == 1
    assert service.get_hotspot()['available']
    assert weather.called


def test_api_shape_cache_shared_cells_and_peak(scan, client):
    _, weather, alerts = scan
    response = client.get('/api/weather/hotspot')
    assert response.status_code == 200
    data = response.json()
    assert set(data) == {'available', 'generated_at', 'window_hours', 'headline', 'summary', 'hazard',
                         'peak', 'alerts', 'suggested_trip', 'sources', 'more'}
    assert data['more'] == []
    assert data['available'] and data['window_hours'] == 48 and data['hazard'] == 'wind'
    assert set(data['peak']) == {'place', 'lat', 'lon', 'gust_mph', 'wind_mph', 'rain_in', 'snow_in',
                                'at_utc', 'level_for_cargo', 'cargo_lb'}
    assert data['peak']['place'] == 'El Paso, TX'
    assert data['peak']['gust_mph'] == 50.3
    assert data['peak']['level_for_cargo'] == 4
    trip = data['suggested_trip']
    assert set(trip) == {'origin', 'destination', 'cargo_lb', 'departure_local', 'corridor', 'why', 'verified'}
    assert trip['origin']['label'] == 'Willcox, AZ, USA'
    assert trip['destination']['label'] == 'Fort Stockton, TX, USA'
    assert trip['verified'] == {'max_level': 2, 'high_or_worse_mi': 25, 'route_label': 'I-10'}
    for endpoint in ('origin', 'destination'):
        assert set(trip[endpoint]) == {'label', 'lat', 'lon', 'tz'}
    assert trip['cargo_lb'] == data['peak']['cargo_lb'] == 43000
    from planner.domain.hotspot import showcase_segment
    c = next(c for c in service.CORRIDORS if c.road == 'I-10')
    p = next(p for p in c.points if p.place == data['peak']['place'])
    _, _, approach = showcase_segment(c.points, p)
    # generated_at omits microseconds; this peak is reachable, so hour rounding is stable.
    assert trip['departure_local'] == next_departure(datetime.fromisoformat(data['generated_at']), trip['origin']['tz'],
                                                   datetime.fromisoformat(data['peak']['at_utc']), approach)
    assert '4 relevant NWS alerts active' in data['summary']
    assert data['sources'] == {'forecast': 'Open-Meteo', 'alerts': 'NWS api.weather.gov'}
    calls = weather.call_count
    assert client.get('/api/weather/hotspot').json() == data
    assert weather.call_count == calls and alerts.call_count == 1
    # Deleting just the result re-scans cached cells without consuming more budget.
    used = budget_usage()['used_today']
    cache.delete(service.CACHE_KEY)
    assert service.get_hotspot()['available']
    assert weather.call_count == calls and budget_usage()['used_today'] == used
    assert all(cache.get('wx:v1:' + h3.latlng_to_cell(p.lat, p.lon, 5)) is not None
               for c in service.CORRIDORS for p in c.points)


@pytest.mark.parametrize('nws_response', [httpx.Response(403), httpx.Response(200, json={}), httpx.Response(200, text='not json')])
def test_alert_failure_is_nonfatal(scan, nws_response):
    scan[2].mock(return_value=nws_response)
    data = service.get_hotspot()
    assert data['available'] and data['alerts'] == []
    assert data['summary'].endswith('; NWS alerts unavailable.')


def test_forecast_failure_suppresses_popup(scan):
    scan[1].mock(return_value=httpx.Response(403))
    assert service.get_hotspot() == {'available': False, 'reason': 'Forecast coverage below 80% for the 48-hour corridor scan; try again later.'}


def test_failed_scan_is_cached_briefly(scan, monkeypatch):
    ttls = []
    monkeypatch.setattr(service.cache, 'touch', lambda key, ttl: ttls.append((key, ttl)) or True)
    scan[1].mock(return_value=httpx.Response(403))
    assert service.get_hotspot()['reason'] == service.COVERAGE_REASON
    assert ttls == [(service.CACHE_KEY, service.FAILURE_TTL)] and service.FAILURE_TTL < service.CACHE_TTL


def test_nothing_notable_keeps_the_full_cache_ttl(scan, monkeypatch):
    touched = []
    monkeypatch.setattr(service.cache, 'touch', lambda *args: touched.append(args) or True)
    scan[0]['gust'] = 20
    scan[2].mock(return_value=httpx.Response(200, json={'features': []}))
    result = service.get_hotspot()
    assert result['available'] is False and result['reason'] not in service.TRANSIENT_REASONS
    assert touched == []


def test_nothing_notable_is_cached_false(scan, client):
    scan[0]['gust'] = 20
    scan[2].mock(return_value=httpx.Response(200, json={'features': []}))
    result = client.get('/api/weather/hotspot')
    assert result.status_code == 200 and set(result.json()) == {'available', 'reason'}
    assert result.json()['available'] is False
    calls = scan[1].call_count
    assert client.get('/api/weather/hotspot').json() == result.json()
    assert scan[1].call_count == calls


def test_relevant_alert_alone_can_make_demo_available(scan):
    scan[0]['gust'] = 20
    data = service.get_hotspot()
    assert data['available'] and data['peak']['level_for_cargo'] == 0
    assert data['peak']['place'].endswith((', TX', ', AZ', ', NM', ', WY'))
    assert data['headline'].startswith('Active weather warnings')
    assert 'active trucking-weather warning' in data['suggested_trip']['why']


def test_unrelated_alert_does_not_trigger_popup(scan):
    scan[0]['gust'] = 20
    scan[2].mock(return_value=httpx.Response(200, json={'features': [
        {'properties': {'status': 'Actual', 'severity': 'Severe', 'event': 'Red Flag Warning',
                        'geocode': {'UGC': ['TXZ418']}}}]}))
    assert service.get_hotspot()['available'] is False


def test_rain_includes_showers_and_high_threshold_is_enough(scan):
    scan[0].update(gust=10, rain=0.1, showers=0.15)
    scan[2].mock(return_value=httpx.Response(200, json={'features': []}))
    data = service.get_hotspot()
    assert data['available'] and data['hazard'] == 'rain'
    assert data['peak']['level_for_cargo'] == 2 and data['peak']['rain_in'] == 0.25


@pytest.mark.parametrize('remaining', [0, 1])
def test_exhausted_or_insufficient_budget(scan, settings, remaining):
    settings.WEATHER_DAILY_BUDGET = remaining
    result = service.get_hotspot()
    assert not result['available'] and 'budget exhausted' in result['reason']
    assert budget_usage()['used_today'] <= remaining
    if remaining == 0:
        assert not scan[1].called


def test_singleflight_whole_scan_across_threads(scan):
    scan[0]['delay'] = 0.05
    barrier = threading.Barrier(4)
    def get(_):
        barrier.wait()
        return service.get_hotspot()
    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(get, range(4)))
    assert all(result == results[0] for result in results)
    assert results[0]['available'] and scan[2].call_count == 1
    points = {h3.latlng_to_cell(p.lat, p.lon, 5) for c in service.CORRIDORS for p in c.points}
    assert scan[1].call_count == (len(points) + 24) // 25


def test_result_cache_lasts_60_minutes(scan, monkeypatch):
    clock = time.time()
    monkeypatch.setattr('django.core.cache.backends.base.time.time', lambda: clock)
    result = service.get_hotspot()
    clock += 3599
    assert cache.get(service.CACHE_KEY) == result
    clock += 2
    assert cache.get(service.CACHE_KEY) is None


@pytest.mark.parametrize('at,tz,expected', [
    ('2026-10-17T05:30:45+00:00', 'America/Phoenix', '2026-10-16T23:00'),
    ('2026-10-17T05:00:00+00:00', 'America/Chicago', '2026-10-17T00:00'),
    ('2027-03-14T06:30:00+00:00', 'America/New_York', '2027-03-14T03:00'),
    ('2026-11-01T04:30:00+00:00', 'America/New_York', '2026-11-01T02:00'),
    ('2026-12-31T23:59:00+00:00', 'America/Chicago', '2026-12-31T18:00'),
])
def test_next_whole_origin_local_hour(at, tz, expected):
    assert next_departure(datetime.fromisoformat(at), tz) == expected


def test_hotspot_throttle_is_20_per_minute_per_ip(scan, client):
    for _ in range(20):
        assert client.get('/api/weather/hotspot').status_code == 200
    assert client.get('/api/weather/hotspot').status_code == 429
    assert client.get('/api/weather/hotspot', REMOTE_ADDR='192.0.2.2').status_code == 200


def test_provider_error_singleflight_returns_http_200(client, monkeypatch):
    monkeypatch.setattr(service, 'singleflight', lambda *a, **kw: (_ for _ in ()).throw(ProviderError('busy')))
    response = client.get('/api/weather/hotspot')
    assert response.status_code == 200 and response.json()['available'] is False


def candidate(name, lon, **conditions):
    point = SamplePoint(name + ', TX', 32., lon)
    corridor = replace(CORRIDORS[0], road=name, points=(point,))
    return corridor, point_peak(point, series(**conditions), NOW)


def test_more_prefers_distinct_hazards_before_worse_same_hazard():
    main = candidate('main', -110, rain=3)
    repeat = candidate('repeat', -90, rain=2)
    wind = candidate('wind', -109, gust=50)
    snow = candidate('snow', -108, snow=2)
    assert select_more([main, repeat, wind, snow], main) == [wind, snow]


def test_more_falls_back_to_distant_regions_and_never_repeats_corridors():
    main = candidate('main', -120, gust=60)
    near = candidate('near', -119, gust=59)
    distant = candidate('distant', -105, gust=58)
    nearby_distant = candidate('nearby distant', -104, gust=57)
    farther = candidate('farther', -85, gust=56)
    choices = [main, main, near, distant, distant, nearby_distant, farther]
    assert select_more(choices, main) == [distant, farther]


def test_more_keeps_ranking_and_prefers_new_hazard_after_first_extra():
    main = candidate('main', -120, rain=3)
    wind = candidate('wind', -110, gust=60)
    another_wind = candidate('another wind', -90, gust=59)
    snow = candidate('snow', -109, snow=1)  # Exactly High; preferred despite lower severity.
    assert select_more([main, another_wind, snow, wind], main) == [wind, snow]


def test_more_empty_for_sub_high_or_nearby_same_hazard():
    main = candidate('main', -110, gust=50)
    near = candidate('near', -109, gust=45)
    low = candidate('low', -85, rain=0.1)
    assert select_more([main, near, low], main) == []
    assert select_more([main], main) == []


@pytest.mark.parametrize('known,available', [(80, True), (79, False), (100, True)])
@pytest.mark.parametrize('budget_warning', [False, True])
def test_80_percent_complete_point_coverage_is_inclusive(monkeypatch, known, available, budget_warning):
    points = tuple(SamplePoint(f'Point {i}, TX', 32., -120 + i * 0.3) for i in range(100))
    monkeypatch.setattr(service, 'CORRIDORS', (replace(CORRIDORS[0], points=points),))
    data = series(gust=50, start=datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0))
    def get_many(self, cells, *, time_budget_s):
        assert 19 <= time_budget_s <= 20
        warnings = [{'code': 'WEATHER_BUDGET'}] if budget_warning else []
        return {cell: data if i < known else None for i, cell in enumerate(cells)}, warnings
    monkeypatch.setattr(service.WeatherStore, 'get_many', get_many)
    monkeypatch.setattr(service, 'active_alerts', lambda: [])
    result = service.build_hotspot()
    assert result['available'] is available
    if not available:
        assert '80%' in result['reason']


def test_full_weather_cache_still_usable_after_budget_exhaustion(scan, settings):
    first = service.get_hotspot()
    settings.WEATHER_DAILY_BUDGET = 0
    cache.delete(service.CACHE_KEY)
    assert service.get_hotspot()['available']
    assert first['peak'] == service.get_hotspot()['peak']


def test_slow_nws_shares_scan_deadline_and_is_nonfatal(monkeypatch):
    release, finished = threading.Event(), threading.Event()
    data = series(gust=50, start=datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0))
    def get_many(self, cells, *, time_budget_s):
        return {cell: data for cell in cells}, []
    def alerts():
        release.wait(2)
        finished.set()
        return []
    monkeypatch.setattr(service, 'SCAN_BUDGET_S', 0.05)
    monkeypatch.setattr(service.WeatherStore, 'get_many', get_many)
    monkeypatch.setattr(service, 'active_alerts', alerts)
    try:
        started = time.monotonic()
        result = service.build_hotspot()
        assert time.monotonic() - started < 1
        assert result['available'] and result['alerts'] == []
        assert result['summary'].endswith('NWS alerts unavailable.')
    finally:
        release.set()
        assert finished.wait(2)


def test_warm_hotspot_populates_same_endpoint_cache(scan, client):
    output = StringIO()
    call_command('warm_hotspot', stdout=output)
    warmed = json.loads(output.getvalue())
    assert warmed['available'] and cache.get(service.CACHE_KEY) == warmed
    calls = scan[1].call_count
    assert client.get('/api/weather/hotspot').json() == warmed
    assert scan[1].call_count == calls
