"""Budgeted, cache-shared forecast scan for the welcome popup."""
from concurrent.futures import ThreadPoolExecutor, TimeoutError
from datetime import datetime, timezone
import time

import h3
from rest_framework.exceptions import ValidationError
from tzfpy import get_tz

from planner.api.serializers import PlanSerializer
from planner.domain.corridors import CORRIDORS, connected_points
from planner.domain.hotspot import CARGO_LB, WINDOW_HOURS, describe, hazard_for, next_departure, point_peak, select_more, showcase_segment
from planner.providers.base import ProviderError
from planner.providers.nws import RELEVANT_EVENTS, STATE_NAMES, active_alerts
from planner.providers.resilience import singleflight
from .weather_store import WeatherStore
from .plan_service import create_plan

CACHE_KEY = 'hotspot:v3'
CACHE_TTL = 3600
SCAN_BUDGET_S = 20.0
MIN_COVERAGE = 0.8
VERIFY_BUDGET_S = 30.0
MAX_MAIN_ATTEMPTS = 3


def verified_exposure(plan: dict) -> dict | None:
    """Only the recommended or fastest route can qualify a showcase."""
    recommended = plan['recommendation']['route_id']
    routes = sorted(plan['routes'], key=lambda route: route['id'] != recommended)
    for route in routes:
        if route['id'] != recommended and not route['is_fastest']:
            continue
        miles = route['risk']['miles_by_level']
        high = sum(miles[key] for key in ('high', 'severe', 'no_travel'))
        if high >= 25 or miles['no_travel'] > 0:
            level = max(level for level, key in enumerate(('low', 'moderate', 'high', 'severe', 'no_travel'))
                        if miles[key] > 0)
            return {'max_level': level, 'high_or_worse_mi': high, 'route_label': route['label']}
    return None


def unavailable(reason: str) -> dict:
    return {'available': False, 'reason': reason}


def build_hotspot() -> dict:
    now = datetime.now(timezone.utc)
    deadline = time.monotonic() + SCAN_BUDGET_S
    points = list(dict.fromkeys(point for corridor in CORRIDORS for point in corridor.points))
    cells = {point: h3.latlng_to_cell(point.lat, point.lon, 5) for point in points}
    # NWS runs alongside the two weather waves, sharing the same overall scan budget.
    pool = ThreadPoolExecutor(max_workers=1)
    alert_future = pool.submit(active_alerts)
    alerts_available = True
    try:
        forecasts, warnings = WeatherStore().get_many(list(cells.values()), time_budget_s=max(0, deadline - time.monotonic()))
        try:
            alerts = alert_future.result(timeout=max(0, deadline - time.monotonic()))
        except (ProviderError, TimeoutError):
            alerts, alerts_available = [], False
    finally:
        pool.shutdown(wait=False, cancel_futures=True)
    relevant = [alert for alert in alerts if alert['event'] in RELEVANT_EVENTS]
    states = {state for alert in relevant for state in alert['states']}
    peaks = {point: point_peak(point, forecasts.get(cell), now, point.state in states)
             for point, cell in cells.items()}
    known = sum(peak is not None for peak in peaks.values())
    if not points or known / len(points) < MIN_COVERAGE:
        if any(w['code'] == 'WEATHER_BUDGET' for w in warnings):
            return unavailable('Daily weather budget exhausted before 80% corridor forecast coverage was reached.')
        return unavailable('Forecast coverage below 80% for the 48-hour corridor scan; try again later.')
    # A corridor's score is its worst point: severity first, normalized exceedance second.
    # Catalogue order supplies deterministic ties.
    candidates = []
    for corridor in CORRIDORS:
        connected = connected_points(corridor, CORRIDORS)
        bracketed = [peaks[p] for p in corridor.points if peaks[p] is not None
                     and showcase_segment(connected, p) is not None]
        if bracketed:
            candidates.append((corridor, max(bracketed, key=lambda peak: peak.score)))
    if not candidates:
        return unavailable('No forecast peak could be bracketed by corridor sample cities; try again later.')
    candidates.sort(key=lambda pair: pair[1].score, reverse=True)
    corridor, peak = candidates[0]
    if peak.classification.level < 2 and not relevant:
        return unavailable('No High-or-worse trucking weather or relevant active NWS warnings found on the sampled corridors.')
    count = sum(alert['count'] for alert in relevant)

    def showcase(corridor, peak):
        segment = showcase_segment(connected_points(corridor, CORRIDORS), peak.point)
        if segment is None:
            return None
        origin, destination, approach_mi = segment
        def endpoint(point):
            return {'label': point.place + ', USA', 'lat': point.lat, 'lon': point.lon,
                    'tz': get_tz(point.lon, point.lat)}
        start, end = endpoint(origin), endpoint(destination)
        hazards = {RELEVANT_EVENTS[alert['event']] for alert in relevant if peak.point.state in alert['states']}
        hazard = hazard_for(peak, hazards)
        headline, summary, why = describe(peak, corridor.road, hazard, STATE_NAMES[peak.point.state], count, alerts_available)
        return {
            'hazard': hazard, 'headline': headline, 'summary': summary,
            'peak': {'place': peak.point.place, 'lat': peak.point.lat, 'lon': peak.point.lon,
                     'gust_mph': peak.gust, 'wind_mph': peak.wind, 'rain_in': peak.rain, 'snow_in': peak.snow,
                     'at_utc': peak.at.isoformat(timespec='seconds').replace('+00:00', 'Z'),
                     'level_for_cargo': peak.classification.level, 'cargo_lb': CARGO_LB},
            'suggested_trip': {'origin': start, 'destination': end,
                               'cargo_lb': CARGO_LB, 'departure_local': next_departure(now, start['tz'], peak.at, approach_mi),
                               'corridor': corridor.road, 'why': why},
        }

    verify_deadline = time.monotonic() + VERIFY_BUDGET_S
    # One worker keeps attempts sequential. A timed-out HTTP call may finish caching,
    # but cannot publish a late/unverified trip or start further provider work here.
    pool = ThreadPoolExecutor(max_workers=1)
    def verify(item):
        if item is None or time.monotonic() >= verify_deadline:
            return None
        trip = item['suggested_trip']
        serializer = PlanSerializer(data=trip)
        try:
            serializer.is_valid(raise_exception=True)
            future = pool.submit(create_plan, serializer.validated_data)
            plan = future.result(timeout=max(0, verify_deadline - time.monotonic()))
            evidence = verified_exposure(plan)
        except (ProviderError, ValidationError, TimeoutError):
            return None
        if evidence is None:
            return None
        trip['verified'] = evidence
        return item

    attempted = []
    main = None
    try:
        for corridor, peak in candidates[:MAX_MAIN_ATTEMPTS]:
            attempted.append(corridor)
            main = verify(showcase(corridor, peak))
            if main is not None or time.monotonic() >= verify_deadline:
                break
        if main is None:
            return unavailable('No showcase trip verified with at least 25 High-or-worse miles or any No Travel; try again later.')
        more = []
        remaining = [(c, p) for c, p in candidates if c not in attempted or c == corridor]
        for c, p in select_more(remaining, (corridor, peak)):
            if time.monotonic() >= verify_deadline:
                break
            extra = verify(showcase(c, p))
            if extra is not None:
                more.append(extra)
    finally:
        pool.shutdown(wait=False, cancel_futures=True)

    return {
        'available': True, 'generated_at': now.isoformat(timespec='seconds').replace('+00:00', 'Z'),
        'window_hours': WINDOW_HOURS, **main,
        'alerts': alerts,
        'more': more,
        'sources': {'forecast': 'Open-Meteo', 'alerts': 'NWS api.weather.gov'},
    }


def get_hotspot() -> dict:
    try:
        return singleflight(CACHE_KEY, CACHE_TTL, build_hotspot, wait_s=SCAN_BUDGET_S + VERIFY_BUDGET_S + 2)
    except ProviderError:
        return unavailable('Weather providers are temporarily unavailable; try again later.')
