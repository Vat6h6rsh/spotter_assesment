"""Driving-time schedules. The 14-hour on-duty window is intentionally out of scope."""
from dataclasses import dataclass
from typing import Literal

from .geometry import Geometry, M_PER_MI, interpolate

RestMode = Literal["auto", "custom", "none"]
RestKind = Literal["break30", "rest10h", "custom"]


@dataclass(frozen=True)
class RestPolicy:
    mode: RestMode = "auto"
    drive_hours: float = 8
    rest_hours: float = 0.5


@dataclass(frozen=True)
class Rest:
    drive_s: float
    elapsed_s: float
    duration_s: float
    at_mi: float
    kind: RestKind


def schedule(geometry: Geometry, policy: RestPolicy) -> list[Rest]:
    total = geometry.cum_drive_s[-1]
    result: list[Rest] = []
    driving = continuous = since_rest = elapsed_rests = 0.0
    kind: RestKind
    while policy.mode != "none":
        if policy.mode == "custom":
            step = policy.drive_hours * 3600
            duration, kind = policy.rest_hours * 3600, "custom"
        else:
            step = min(28800 - continuous, 39600 - since_rest)
            duration, kind = (36000, "rest10h") if since_rest + step >= 39600 else (1800, "break30")
        if step <= 0:
            raise ValueError("Rest driving interval must be positive")
        if driving + step >= total:
            break  # Arriving exactly at a break threshold requires no roadside rest.
        driving += step
        continuous += step
        since_rest += step
        result.append(Rest(driving, driving + elapsed_rests, duration,
                           interpolate(geometry.cum_drive_s, geometry.cum_m, driving) / M_PER_MI, kind))
        elapsed_rests += duration
        continuous = 0
        if kind == "rest10h":
            since_rest = 0
    return result


def elapsed_at(drive_s: float, rests: list[Rest]) -> float:
    """Checkpoint at a rest location represents arrival, before taking that rest."""
    return drive_s + sum(rest.duration_s for rest in rests if rest.drive_s < drive_s)


def progress_knots(geometry: Geometry, rests: list[Rest]) -> list[list[float]]:
    # Preserve segment speed changes as well as every rest plateau.
    result: list[list[float]] = []
    events: dict[float, float] = dict(zip(geometry.cum_drive_s, (m / M_PER_MI for m in geometry.cum_m)))
    events.update({rest.drive_s: rest.at_mi for rest in rests})
    rest_map = {rest.drive_s: rest for rest in rests}
    offset = 0.0
    for driving, mi in sorted(events.items()):
        result.append([driving + offset, mi])
        if driving in rest_map:
            offset += rest_map[driving].duration_s
            result.append([driving + offset, mi])
    return result
