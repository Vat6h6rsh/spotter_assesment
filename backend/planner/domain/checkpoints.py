from dataclasses import dataclass
from math import fsum
from collections.abc import Sequence

LEVEL_KEYS: tuple[str, ...] = ("low", "moderate", "high", "severe", "no_travel", "unknown")


def checkpoint_miles(distance_mi: float, spacing_mi: int) -> list[float]:
    if distance_mi <= 0 or spacing_mi <= 0:
        raise ValueError("Distance and spacing must be positive")
    result = [float(i * spacing_mi) for i in range(int(distance_mi // spacing_mi) + 1)]
    if result[-1] < distance_mi:
        result.append(distance_mi)
    return result


def owned_miles(miles: Sequence[float]) -> list[float]:
    edges = [0.0, *((a + b) / 2 for a, b in zip(miles, miles[1:])), miles[-1]]
    return [b - a for a, b in zip(edges, edges[1:])]


@dataclass(frozen=True)
class RiskSummary:
    miles_by_level: dict[str, float]
    avg_risk: float | None
    coverage: float
    max_level: int | None


def summarise(miles: Sequence[float], levels: Sequence[int | None]) -> RiskSummary:
    if len(miles) != len(levels):
        raise ValueError("Each checkpoint needs a level")
    owned = owned_miles(miles)
    buckets = {name: fsum(m for m, level in zip(owned, levels) if (5 if level is None else level) == i)
               for i, name in enumerate(LEVEL_KEYS)}
    known = fsum(buckets[name] for name in LEVEL_KEYS[:5])
    avg = fsum(i * buckets[name] for i, name in enumerate(LEVEL_KEYS[:5])) / known if known else None
    return RiskSummary(buckets, avg, known / miles[-1], max((v for v in levels if v is not None), default=None))
