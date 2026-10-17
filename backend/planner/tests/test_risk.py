from decimal import Decimal

import pytest

from planner.domain.risk import classify, decimal_value


@pytest.mark.parametrize("wind,expected", [
    (0, 0), (24.99, 0), (25, 1), (34.99, 1), (35, 2), (44.99, 2),
    (45, 3), (54.99, 3), (55, 4), (90, 4), (24.999, 1),
])
def test_wind_edges(wind, expected):
    assert classify(wind, wind, 0, 0, 0).level == expected


@pytest.mark.parametrize("rain,expected", [
    (0, 0), (0.09, 0), (0.0999, 1), (0.10, 1), (0.24, 1), (0.25, 2),
    (0.49, 2), (0.50, 3), (1.00, 3), (1.0001, 3), (1.01, 4),
])
def test_rain_edges_after_required_rounding(rain, expected):
    assert classify(0, 0, rain, 0, 0).level == expected


@pytest.mark.parametrize("snow,expected", [(0, 0), (0.49, 0), (0.5, 1), (0.99, 1), (1.0, 2), (1.99, 2), (2.0, 3), (3.0, 3), (3.01, 4)])
def test_snow_edges(snow, expected):
    assert classify(0, 0, 0, snow, 0).level == expected


@pytest.mark.parametrize("wind,cargo,expected,adjusted", [
    (45, 30000, 3, False), (45, 30001, 4, True), (54.99, 30001, 4, True),
    (35, 40000, 2, False), (35, 40001, 3, True), (44.99, 40001, 3, True),
    (35, 30000, 2, False), (35, 30001, 2, False), (45, 40000, 4, True),
    (45, 40001, 4, True), (55, 0, 4, False), (55, 80000, 4, False),
    (34.99, 80000, 1, False), (25, 80000, 1, False),
])
def test_strict_load_rules(wind, cargo, expected, adjusted):
    result = classify(wind, wind, 0, 0, cargo)
    assert result.level == expected
    assert result.load_adjusted is adjusted


@pytest.mark.parametrize("sustained,gust,measure,expected", [
    (20, 55, "gust", 4), (20, 55, "sustained", 0), (45, 20, "gust", 3),
    (45, 20, "sustained", 3), (20, None, "gust", None), (20, None, "sustained", 0),
])
def test_gust_vs_sustained(sustained, gust, measure, expected):
    assert classify(sustained, gust, 0, 0, 0, measure).level == expected


@pytest.mark.parametrize("values", [(None, 20, 0, 0), (20, None, 0, 0), (20, 20, None, 0), (20, 20, 0, None), (float('nan'), 20, 0, 0), (20, 20, -1, 0)])
def test_unknown_never_low(values):
    result = classify(*values, 0)
    assert result.level is None
    assert result.drivers == []


def test_tied_drivers_and_load_does_not_reduce_snow():
    result = classify(35, 35, 0.5, 2, 40001)
    assert result.level == 3
    assert result.drivers == ["wind", "rain", "snow"]
    assert "> 40,000" in result.rule
    assert classify(35, 35, 0, 3.01, 40001).level == 4
    assert decimal_value(0.0999) == Decimal("0.1")
