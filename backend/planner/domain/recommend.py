from dataclasses import dataclass

from .checkpoints import RiskSummary


@dataclass(frozen=True)
class RouteScore:
    id: str
    index: int
    total_s: float
    risk: RiskSummary


@dataclass(frozen=True)
class Recommendation:
    status: str
    route_id: str | None
    reasons: list[str]
    tradeoff: str
    order: list[str]


def pick(candidates: list[RouteScore], spacing: int, blocked: bool = False) -> RouteScore:
    remaining = candidates[:]
    if blocked:
        minimum = min(r.risk.miles_by_level["no_travel"] for r in remaining)
        remaining = [r for r in remaining if r.risk.miles_by_level["no_travel"] == minimum]
    for key in ("severe", "high"):
        minimum = min(r.risk.miles_by_level[key] for r in remaining)
        remaining = [r for r in remaining if r.risk.miles_by_level[key] <= minimum + spacing / 2]
    minimum_avg = min(r.risk.avg_risk if r.risk.avg_risk is not None else float("inf") for r in remaining)
    remaining = [r for r in remaining if (r.risk.avg_risk if r.risk.avg_risk is not None else float("inf")) <= minimum_avg + 0.05]
    return min(remaining, key=lambda r: (r.total_s, r.index))


def recommend(routes: list[RouteScore], spacing: int) -> Recommendation:
    if not routes:
        raise ValueError("At least one route is required")
    remaining = routes[:]
    order: list[RouteScore] = []
    while remaining:
        eligible = [r for r in remaining if r.risk.miles_by_level["no_travel"] == 0]
        chosen = pick(eligible or remaining, spacing, not eligible)
        order.append(chosen)
        remaining.remove(chosen)
    chosen = order[0]
    eligible = any(r.risk.miles_by_level["no_travel"] == 0 for r in routes)
    status = ("tentative" if any(r.risk.coverage < 0.95 for r in routes) else "recommended") if eligible else "none_eligible"
    fastest = min(routes, key=lambda r: (r.total_s, r.index))
    delay = round((chosen.total_s - fastest.total_s) / 60)
    reasons: list[str] = []
    for key, name in (("no_travel", "No Travel"), ("severe", "Severe"), ("high", "High")):
        other = max(routes, key=lambda r: r.risk.miles_by_level[key])
        value = chosen.risk.miles_by_level[key]
        if other.risk.miles_by_level[key] > value:
            reasons.append(f"{value:g} {name} mi vs {other.risk.miles_by_level[key]:g} on {other.id}")
    if not reasons:
        reasons.append("Lowest average risk within tolerance; elapsed time breaks ties")
    reasons = reasons[:2] + [f"+{delay} min vs fastest" if delay else "Fastest elapsed time"]
    prefix = "Least exposure; all routes contain No Travel miles. " if not eligible else ""
    differences = [(name, fastest.risk.miles_by_level[key] - chosen.risk.miles_by_level[key])
                   for key, name in (("no_travel", "No Travel"), ("severe", "Severe"), ("high", "High"))]
    improvement = next(((name, miles) for name, miles in differences if miles > 0), None)
    if delay and improvement:
        name, miles = improvement
        tradeoff = f"Avoids {miles:g} {name} miles for {delay} more minutes than the fastest route {fastest.id}."
    else:
        tradeoff = f"{delay} more minutes than the fastest route {fastest.id}." if delay else f"Also the fastest route ({fastest.id})."
    tradeoff = prefix + tradeoff
    return Recommendation(status, chosen.id if eligible else None, reasons[:3], tradeoff, [r.id for r in order])
