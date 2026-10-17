"""Weather-adjusted drive time.

TomTom's travel times include traffic but not weather. We slow each checkpoint's owned stretch of road using FHWA's
published freeway average-speed reductions, at the midpoint of each range:
  light rain or snow 3-13% -> 8%, heavy rain 3-16% -> 10%, heavy snow 5-40% -> 22%.
Source: https://ops.fhwa.dot.gov/weather/roadimpact.htm (older studies; indicative, labelled as an estimate in the UI).
Wind has no FHWA speed figure, so it is deliberately not modelled.
"""
from bisect import bisect_right
from collections.abc import Sequence
from dataclasses import dataclass

from .geometry import Geometry, M_PER_MI, interpolate

# Precipitation below this rate is treated as dry (forecast noise, drizzle traces).
TRACE_IN_HR = 0.02
HEAVY_RAIN_IN_HR = 0.25   # the assessment's High threshold for rain
HEAVY_SNOW_IN_HR = 1.0    # the assessment's High threshold for snow


@dataclass(frozen=True)
class Slowdown:
    factor: float          # fraction of normal speed (1.0 = no slowdown)
    reason: str | None     # human label, e.g. "Heavy snow -22%"


NONE = Slowdown(1.0, None)


def slowdown(rain_in: float | None, snow_in: float | None) -> Slowdown:
    """Worst applicable slowdown for one checkpoint. Unknown weather -> no adjustment (coverage already flags it)."""
    options = [NONE]
    if snow_in is not None:
        if snow_in >= HEAVY_SNOW_IN_HR:
            options.append(Slowdown(0.78, "Heavy snow −22%"))
        elif snow_in >= TRACE_IN_HR:
            options.append(Slowdown(0.92, "Light snow −8%"))
    if rain_in is not None:
        if rain_in >= HEAVY_RAIN_IN_HR:
            options.append(Slowdown(0.90, "Heavy rain −10%"))
        elif rain_in >= TRACE_IN_HR:
            options.append(Slowdown(0.92, "Light rain −8%"))
    return min(options, key=lambda s: s.factor)


def owned_edges_m(checkpoint_mi: Sequence[float]) -> list[float]:
    """Boundaries (metres) of each checkpoint's owned stretch: midpoints between neighbours, plus both ends."""
    mids = [(a + b) / 2 for a, b in zip(checkpoint_mi, checkpoint_mi[1:])]
    return [0.0, *(m * M_PER_MI for m in mids), checkpoint_mi[-1] * M_PER_MI]


def adjusted_geometry(geometry: Geometry, checkpoint_mi: Sequence[float], factors: Sequence[float]) -> Geometry:
    """Same road, slower clock: each owned stretch's drive time is divided by its speed factor.

    Built on the same prefix arrays, so position/ETA lookups stay O(log n) and rests are scheduled on real
    (weather-slowed) driving time.
    """
    if len(factors) != len(checkpoint_mi):
        raise ValueError("One factor per checkpoint is required")
    if all(f == 1.0 for f in factors):
        return geometry
    if any(not 0 < f <= 1 for f in factors):
        raise ValueError("Speed factors must be in (0, 1]")
    edges = owned_edges_m(checkpoint_mi)
    edges[-1] = geometry.cum_m[-1]  # guard float drift between miles and metres
    base_at_edge = [interpolate(geometry.cum_m, geometry.cum_drive_s, e) for e in edges]
    adjusted_at_edge = [0.0]
    for j, factor in enumerate(factors):
        adjusted_at_edge.append(adjusted_at_edge[-1] + (base_at_edge[j + 1] - base_at_edge[j]) / factor)
    times = []
    for m, base in zip(geometry.cum_m, geometry.cum_drive_s):
        j = min(len(factors) - 1, max(0, bisect_right(edges, m) - 1))
        times.append(adjusted_at_edge[j] + (base - base_at_edge[j]) / factors[j])
    # Enforce monotonicity against float noise at stretch boundaries.
    for i in range(1, len(times)):
        times[i] = max(times[i], times[i - 1])
    return Geometry(geometry.points, geometry.cum_m, times)
