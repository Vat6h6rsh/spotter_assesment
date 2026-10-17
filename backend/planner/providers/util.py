from collections import defaultdict
import re

from planner.domain.geometry import shared_fraction
from .base import Route


def normalise_road(name: str) -> str:
    name = name.strip()
    if name.casefold() in {"unknown", "unnamed", "unnamed road", "no name"}:
        return ""
    return re.sub(r"\b(I|US|SR|ON|QC|AB|BC)\s+(\d)", r"\1-\2", name)


def checkpoint_road(ref: str, street: str = "") -> str:
    return road_label([(ref or "", 1)], "") or normalise_road(street or "")


def road_label(roads: list[tuple[str, float]], fallback: str) -> str:
    totals: dict[str, float] = defaultdict(float)
    for names, distance in roads:
        for name in names.split(";"):
            name = normalise_road(name)
            # Road numbers, not arbitrarily long street names.
            if re.search(r"\d", name):
                totals[name] += distance
    selected = sorted(totals, key=lambda name: (-totals[name], name))[:2]
    return " / ".join(selected) if selected else fallback


def distinct_routes(routes: list[Route]) -> list[Route]:
    result: list[Route] = []
    for route in routes:
        if all(shared_fraction(route.geometry, existing.geometry) < 0.85 for existing in result):
            result.append(route)
            if len(result) == 3:
                break
    return result
