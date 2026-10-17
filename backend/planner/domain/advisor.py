from dataclasses import dataclass

from .recommend import RouteScore


@dataclass(frozen=True)
class DepartureOption:
    offset_h: int
    route: RouteScore


def sort_keys(route: RouteScore) -> tuple[float, float, float, float, float]:
    risk = route.risk
    return (risk.miles_by_level["no_travel"], risk.miles_by_level["severe"], risk.miles_by_level["high"],
            risk.avg_risk if risk.avg_risk is not None else float("inf"), route.total_s)


def best_departure(current: RouteScore, options: list[DepartureOption]) -> DepartureOption | None:
    # Do not suggest a later departure by hiding hazards behind missing forecast data.
    improving = [o for o in options if o.route.risk.coverage >= max(0.95, current.risk.coverage)
                 and sort_keys(o.route) < sort_keys(current)]
    return min(improving, key=lambda o: (sort_keys(o.route), o.offset_h, o.route.index), default=None)
