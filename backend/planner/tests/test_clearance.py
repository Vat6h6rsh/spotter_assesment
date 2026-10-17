from datetime import datetime, timedelta, timezone

import h3
import pytest

from planner.domain.geometry import Geometry, M_PER_MI
from planner.domain.weather import WeatherSeries, clearance, sample
from planner.providers.base import Route, RoutingResult
from planner.services import plan_service

START = datetime(2026, 10, 17, tzinfo=timezone.utc)


def forecast(length=60):
    return WeatherSeries(START, [10.] * length, [50.] * length, [0.] * length, [0.] * length, START)


def test_clears_at_plus_one_and_keeps_eta_minutes():
    data = forecast()
    data.gust[1] = 34
    eta = START + timedelta(minutes=20, seconds=15)
    assert clearance(data, eta, 4, 43000, 'gust') == (1, eta + timedelta(hours=1))


def test_never_clears_checks_at_most_48_samples(monkeypatch):
    from planner.domain import weather
    seen = []
    def counted(data, at):
        seen.append(at)
        return sample(data, at)
    monkeypatch.setattr(weather, 'sample', counted)
    data = forecast()
    data.gust[49] = 0  # Outside the allowed +48 window.
    assert clearance(data, START, 4, 43000, 'gust') == (None, None)
    assert seen == [START + timedelta(hours=h) for h in range(1, 49)]


def test_includes_plus_48_boundary():
    data = forecast()
    data.gust[48] = 0
    assert clearance(data, START, 4, 43000, 'gust') == (48, START + timedelta(hours=48))


def test_horizon_end_and_precipitation_ceiling():
    data = forecast(length=3)
    data.gust[2] = 0
    assert clearance(data, START, 4, 43000, 'gust') == (2, START + timedelta(hours=2))
    # Wind at +2:20 rounds to the final hour, but ceiling precipitation is beyond it.
    assert clearance(data, START + timedelta(minutes=20), 4, 43000, 'gust') == (None, None)


@pytest.mark.parametrize('level', [None, 0, 1, 2])
def test_non_severe_does_not_sample(level, monkeypatch):
    monkeypatch.setattr('planner.domain.weather.sample', lambda *args: pytest.fail('unneeded sample'))
    assert clearance(forecast(), START, level, 43000, 'gust') == (None, None)


def test_unknown_future_is_not_clear_and_uses_same_cargo_and_measure():
    data = forecast()
    data.gust[1], data.gust[2], data.gust[3] = None, 40, 34
    assert clearance(data, START, 4, 43000, 'gust')[0] == 3
    assert clearance(data, START, 4, 40000, 'gust')[0] == 2
    assert clearance(data, START, 4, 43000, 'sustained')[0] == 1


def test_other_hazard_must_also_clear():
    data = forecast()
    data.gust[1:] = [0.] * 59
    data.rain[1:3] = [0.6, 0.6]
    assert clearance(data, START, 4, 43000, 'gust')[0] == 3


def test_plan_uses_final_slowed_eta_and_never_searches_advisor_offsets(monkeypatch):
    geometry = Geometry([(40., -100.), (40., -99.)], [0., 100 * M_PER_MI], [0., 7200.])
    monkeypatch.setattr(plan_service, 'get_routing', lambda inputs: RoutingResult([Route(geometry, 'Test')], 'osrm', False))
    data = forecast()
    data.rain[:] = [0.6] * len(data.rain)
    data.gust[10:], data.rain[10:] = [0.] * 50, [0.] * 50
    fetches = []
    def get_many(self, cells):
        fetches.append(cells)
        return {cell: data for cell in cells}, []
    monkeypatch.setattr(plan_service.WeatherStore, 'get_many', get_many)
    searched = []
    def counted(series, eta, level, cargo, measure):
        searched.append(eta)
        return clearance(series, eta, level, cargo, measure)
    monkeypatch.setattr(plan_service, 'clearance', counted)
    result = plan_service.build_plan({
        'origin': {'label': 'Start', 'lat': 40., 'lon': -100.},
        'destination': {'label': 'End', 'lat': 40., 'lon': -99.},
        'departure_utc': START.isoformat(), 'cargo_lb': 43000, 'spacing_mi': 50,
        'wind_measure': 'gust', 'weather_slowdown': True, 'rest': {'mode': 'none'},
    })
    checkpoints = result['routes'][0]['checkpoints']
    assert len(fetches) == 1 and len(searched) == len(checkpoints)
    assert result['routes'][0]['weather_delay_s'] > 0
    assert searched == [datetime.fromisoformat(cp['eta_utc']) for cp in checkpoints]
    for cp in checkpoints:
        eta = datetime.fromisoformat(cp['eta_utc'])
        cell = h3.latlng_to_cell(cp['lat'], cp['lon'], 5)
        assert cell in fetches[0]
        hours, at = clearance(data, eta, cp['level'], 43000, 'gust')
        assert cp['clears_in_h'] == hours
        assert datetime.fromisoformat(cp['clears_at_utc']) == at
