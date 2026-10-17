from datetime import datetime, timedelta, timezone
from math import fsum

import pytest

from planner.domain.advisor import DepartureOption, best_departure
from planner.domain.checkpoints import RiskSummary, checkpoint_miles, owned_miles, summarise
from planner.domain.eta import RestPolicy, elapsed_at, progress_knots, schedule
from planner.domain.geometry import Geometry, M_PER_MI, decode_polyline, encode_polyline, haversine, interpolate, prefix_distances, shared_fraction, simplify
from planner.domain.recommend import RouteScore, recommend
from planner.domain.weather import WeatherSeries, sample


def geometry(hours):
    return Geometry([(40, -90), (40, -80)], [0, 600 * M_PER_MI], [0, hours * 3600])


@pytest.mark.parametrize("length,spacing", [(1, 25), (25, 25), (50, 25), (1012.4, 10), (1012.4, 25), (1012.4, 50), (1000, 10)])
def test_midpoint_mile_attribution(length, spacing):
    miles = checkpoint_miles(length, spacing)
    assert miles[0] == 0 and miles[-1] == length
    assert len(set(miles)) == len(miles)
    owned = owned_miles(miles)
    assert fsum(owned) == pytest.approx(length)
    summary = summarise(miles, [i % 6 if i % 6 < 5 else None for i in range(len(miles))])
    assert fsum(summary.miles_by_level.values()) == pytest.approx(length)


def test_known_miles_weighted_average_and_unknown():
    result = summarise([0, 25, 50], [0, 4, None])
    assert result.miles_by_level == {"low": 12.5, "moderate": 0, "high": 0, "severe": 0, "no_travel": 25, "unknown": 12.5}
    assert result.avg_risk == pytest.approx(100 / 37.5)
    assert result.coverage == 0.75
    unknown = summarise([0, 1], [None, None])
    assert unknown.avg_risk is None and unknown.max_level is None and unknown.coverage == 0


@pytest.mark.parametrize("hours,kinds,drive_times", [
    (7.9, [], []), (8, [], []), (8.01, ["break30"], [8]),
    (11, ["break30"], [8]), (11.01, ["break30", "rest10h"], [8, 11]),
    (19.01, ["break30", "rest10h", "break30"], [8, 11, 19]),
    (22.01, ["break30", "rest10h", "break30", "rest10h"], [8, 11, 19, 22]),
])
def test_auto_rests_at_8_and_11_hours(hours, kinds, drive_times):
    rests = schedule(geometry(hours), RestPolicy())
    assert [r.kind for r in rests] == kinds
    assert [r.drive_s / 3600 for r in rests] == drive_times
    for r in rests:
        assert r.at_mi == pytest.approx(600 * r.drive_s / (hours * 3600))
    knots = progress_knots(geometry(hours), rests)
    assert knots[-1][0] == hours * 3600 + sum(r.duration_s for r in rests)
    for rest in rests:
        assert [rest.elapsed_s, rest.at_mi] in knots
        assert [rest.elapsed_s + rest.duration_s, rest.at_mi] in knots
        assert elapsed_at(rest.drive_s, rests) == rest.elapsed_s


@pytest.mark.parametrize("mode,drive,rest,count", [("none", 8, 0.5, 0), ("custom", 3, 1, 3), ("custom", 11, 34, 0), ("custom", 1, 0.5, 9)])
def test_other_rest_modes(mode, drive, rest, count):
    rests = schedule(geometry(10), RestPolicy(mode, drive, rest))
    assert len(rests) == count
    assert all(r.duration_s == rest * 3600 for r in rests)


@pytest.mark.parametrize("metres,point,seconds", [(-5, (0, 0), 0), (0, (0, 0), 0), (50, (0, 0.5), 5), (100, (0, 1), 10), (200, (0.5, 1), 30), (300, (1, 1), 50), (400, (1, 1), 50)])
def test_geometry_bisect_interpolation(metres, point, seconds):
    route = Geometry([(0, 0), (0, 1), (1, 1)], [0, 100, 300], [0, 10, 50])
    p, t = route.at_m(metres)
    assert p == pytest.approx(point)
    assert t == seconds


def test_geometry_duplicate_points_and_polyline():
    g = Geometry([(0, 0), (0, 0), (0, 1)], [0, 0, 100], [0, 0, 10])
    assert g.at_m(50) == ((0, 0.5), 5)
    points = [(38.5, -120.2), (40.7, -120.95), (43.252, -126.453)]
    assert encode_polyline(points) == "_p~iF~ps|U_ulLnnqC_mqNvxq`@"
    assert decode_polyline(encode_polyline(points)) == points
    assert haversine((0, 0), (0, 1)) == pytest.approx(111195, rel=0.001)
    assert prefix_distances([(0, 0), (0, 1), (0, 2)])[-1] == pytest.approx(222390, rel=0.001)
    assert simplify([(0, 0), (0, 1), (0, 2)]) == [(0, 0), (0, 2)]
    assert interpolate([0, 0, 10], [0, 0, 20], 5) == 10


def score(id, severe=0, high=0, avg=0, total=100, nt=0, coverage=1):
    return RouteScore(id, ord(id) - 65, total, RiskSummary(
        {"low": 100-severe-high-nt, "moderate": 0, "high": high, "severe": severe, "no_travel": nt, "unknown": 0}, avg, coverage, 4 if nt else 3))


@pytest.mark.parametrize("routes,spacing,pick,status,order", [
    ([score("A", severe=0, total=200), score("B", severe=12.5, total=100)], 25, "B", "recommended", ["B", "A"]),
    ([score("A", severe=0, total=200), score("B", severe=12.5001, total=100)], 25, "A", "recommended", ["A", "B"]),
    ([score("A", high=0, total=200), score("B", high=12.5001, total=100)], 25, "A", "recommended", ["A", "B"]),
    ([score("A", avg=1, total=200), score("B", avg=1.05, total=100)], 25, "B", "recommended", ["B", "A"]),
    ([score("A", avg=1, total=200), score("B", avg=1.0501, total=100)], 25, "A", "recommended", ["A", "B"]),
    ([score("A"), score("B")], 25, "A", "recommended", ["A", "B"]),
    ([score("A", nt=0.01), score("B", severe=99)], 25, "B", "recommended", ["B", "A"]),
    ([score("A", nt=10), score("B", nt=5)], 25, None, "none_eligible", ["B", "A"]),
    ([score("A", nt=5, severe=20), score("B", nt=5, severe=0)], 25, None, "none_eligible", ["B", "A"]),
    ([score("A", coverage=0.9499), score("B")], 25, "A", "tentative", ["A", "B"]),
    ([score("A", coverage=0.95), score("B")], 25, "A", "recommended", ["A", "B"]),
    ([score("A", severe=0, high=30), score("B", severe=12, high=0), score("C", severe=24, high=0)], 25, "B", "recommended", ["B", "A", "C"]),
    ([score("A", severe=0, total=200), score("B", severe=6, total=100)], 10, "A", "recommended", ["A", "B"]),
])
def test_successive_filter_comparator(routes, spacing, pick, status, order):
    result = recommend(routes, spacing)
    assert (result.route_id, result.status, result.order) == (pick, status, order)
    assert 1 <= len(result.reasons) <= 3
    assert result.tradeoff


def test_all_unknown_is_tentative_not_low():
    risk = summarise([0, 100], [None, None])
    result = recommend([RouteScore("A", 0, 100, risk)], 25)
    assert result.status == "tentative"
    assert risk.avg_risk is None


@pytest.mark.parametrize("offset,severe,coverage,expected", [(3, 10, 1, None), (6, 0, 1, 6), (12, 0, 0.5, None)])
def test_advisor_requires_strict_improvement_and_coverage(offset, severe, coverage, expected):
    result = best_departure(score("A", severe=10), [DepartureOption(offset, score("B", severe=severe, coverage=coverage))])
    assert (result.offset_h if result else None) == expected


@pytest.mark.parametrize("minutes,wind,rain,beyond", [(0, 0, 0, False), (29, 0, 1, False), (30, 1, 1, False), (60, 1, 1, False), (61, 1, 2, False), (120, 2, 2, False), (121, None, None, True), (-1, None, None, True)])
def test_weather_nearest_wind_ceiling_precip_and_horizon(minutes, wind, rain, beyond):
    start = datetime(2026, 10, 15, tzinfo=timezone.utc)
    series = WeatherSeries(start, [0, 1, 2], [10, 11, 12], [0, 1, 2], [0, 1, 2], start)
    value = sample(series, start + timedelta(minutes=minutes))
    assert value.wind == wind and value.rain == rain and value.beyond_horizon == beyond


def test_shared_length_filters_duplicate_geometry():
    a = Geometry([(40, -90), (40, -89)], [0, 85000], [0, 3600])
    b = Geometry([(40, -90), (40.5, -89.5), (40, -89)], [0, 50000, 100000], [0, 2000, 4000])
    assert shared_fraction(a, a) == 1
    assert shared_fraction(b, a) < 0.85


@pytest.mark.parametrize("values", [([0, float('nan')], [0, 10]), ([0, 100], [0, float('inf')]), ([0, -100], [0, 10]), ([0, 100], [1, 10]), ([0, 100], [0, -1])])
def test_geometry_rejects_invalid_prefix_arrays(values):
    metres, seconds = values
    with pytest.raises(ValueError):
        Geometry([(40, -90), (40, -80)], metres, seconds)
