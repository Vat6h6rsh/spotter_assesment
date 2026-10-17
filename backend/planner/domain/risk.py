"""The assessment thresholds. Classification never performs unit conversions."""
from dataclasses import dataclass
from decimal import Decimal
from math import isfinite
from typing import Literal

WindMeasure = Literal["gust", "sustained"]
LEVEL_NAMES: tuple[str, ...] = ("Low", "Moderate", "High", "Severe", "No Travel")


def decimal_value(value: float) -> Decimal:
    return Decimal(str(round(value, 2)))


def wind_level(value: Decimal) -> int:
    return sum(value >= edge for edge in map(Decimal, ("25", "35", "45", "55")))


def rain_level(value: Decimal) -> int:
    if value > Decimal("1.00"):
        return 4
    return sum(value >= edge for edge in map(Decimal, ("0.10", "0.25", "0.50")))


def snow_level(value: Decimal) -> int:
    if value > Decimal("3.00"):
        return 4
    return sum(value >= edge for edge in map(Decimal, ("0.5", "1.0", "2.0")))


@dataclass(frozen=True)
class Classification:
    level: int | None
    base_wind_level: int | None
    load_adjusted: bool
    drivers: list[str]
    rule: str


def classify(
    sustained: float | None, gust: float | None, rain: float | None,
    snow: float | None, cargo_lb: float, measure: WindMeasure = "gust",
) -> Classification:
    required = (sustained, rain, snow, gust) if measure == "gust" else (sustained, rain, snow)
    if any(v is None or not isfinite(v) or v < 0 for v in required):
        return Classification(None, None, False, [], "Weather unavailable: risk Unknown")
    assert sustained is not None and rain is not None and snow is not None
    w = decimal_value(max(sustained, gust if gust is not None else sustained) if measure == "gust" else sustained)
    base = wind_level(w)
    adjusted = base
    cargo = decimal_value(cargo_lb)
    wind_rule = f"Wind {w} mph → {LEVEL_NAMES[base]}"
    if Decimal("45") <= w < Decimal("55") and cargo > Decimal("30000"):
        adjusted = max(base, 4)
        wind_rule = "Wind 45–54 mph and cargo > 30,000 lb → No Travel"
    elif Decimal("35") <= w < Decimal("45") and cargo > Decimal("40000"):
        adjusted = max(base, 3)
        wind_rule = "Wind 35–44 mph and cargo > 40,000 lb → Severe"
    factors = {"wind": adjusted, "rain": rain_level(decimal_value(rain)), "snow": snow_level(decimal_value(snow))}
    level = max(factors.values())
    drivers = [name for name, severity in factors.items() if severity == level and level >= 1]
    rules = {
        "wind": wind_rule,
        "rain": f"Rain {decimal_value(rain)} in/hr → {LEVEL_NAMES[level]}",
        "snow": f"Snow {decimal_value(snow)} in/hr → {LEVEL_NAMES[level]}",
    }
    return Classification(level, base, adjusted > base, drivers,
                          "; ".join(rules[d] for d in drivers) if drivers else "All conditions Low")
