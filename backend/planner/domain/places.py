"""Offline checkpoint descriptions. Distances are straight-line, not driving miles.

Place names: GeoNames (CC BY 4.0), bundled by geonamescache (MIT).
The default cities15000 dataset omits many small rural settlements.
"""
from bisect import bisect_left, bisect_right
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from importlib.resources import files
import json
from math import asin, atan2, cos, degrees, floor, radians, sin
import re
from threading import Lock

import h3

from .geometry import EARTH_M, M_PER_MI, Point, haversine

# GeoNames uses numeric Canadian admin1code values, unlike US postal codes.
CA_PROVINCES = {
    "01": "AB", "02": "BC", "03": "MB", "04": "NB", "05": "NL",
    "07": "NS", "08": "ON", "09": "PE", "10": "QC", "11": "SK",
    "12": "YT", "13": "NT", "14": "NU",
}
COMPASS = ("N", "NE", "E", "SE", "S", "SW", "W", "NW")


def _bundled_cities() -> Iterable[dict]:
    """Decode only US/CA records from the pinned package's 16 MB world file.

    get_cities() decodes every country's alternate names (~300 ms on this machine).
    The pinned dataset has geonameid first in each city object. Locate those object
    boundaries, select country fields, then let the standard JSON decoder parse
    whole records (including escaped names). A parity test protects this format.
    No derived dataset, runtime download or additional dependency is needed.
    """
    data = files("geonamescache").joinpath("data/cities15000.json").read_text(encoding="utf-8")
    starts = [match.start() for match in re.finditer(r'\{\s*"geonameid"\s*:', data)]
    decoder = json.JSONDecoder()
    for match in re.finditer(r'"countrycode"\s*:\s*"(?:US|CA)"', data):
        start = starts[bisect_right(starts, match.start()) - 1]
        city, _ = decoder.raw_decode(data, start)
        yield city


@dataclass(frozen=True)
class Town:
    id: str
    name: str
    state: str
    lat: float
    lon: float

    @property
    def point(self) -> Point:
        return self.lat, self.lon


class PlaceIndex:
    """H3 res-3 buckets with an exact spherical-cap completion of nearest search."""

    def __init__(self, towns: Iterable[Town] | None = None):
        if towns is None:
            towns = (Town(str(c["geonameid"]), c["name"],
                          CA_PROVINCES.get(c["admin1code"], c["admin1code"])
                          if c["countrycode"] == "CA" else c["admin1code"],
                          c["latitude"], c["longitude"])
                     for c in _bundled_cities())
        self.buckets: dict[str, list[Town]] = {}
        rows = []
        for town in towns:
            cell = h3.latlng_to_cell(town.lat, town.lon, 3)
            self.buckets.setdefault(cell, []).append(town)
            rows.append((town, cell))
        self._rows = sorted(rows, key=lambda row: (row[0].lat, row[0].id))
        self._latitudes = [town.lat for town, _ in self._rows]

    def nearest(self, point: Point) -> tuple[Town, float] | None:
        if not self._rows:
            return None
        cells = set(h3.grid_disk(h3.latlng_to_cell(*point, 3), 1))
        best: Town | None = None
        best_m = float("inf")

        def consider(town: Town) -> None:
            nonlocal best, best_m
            distance = haversine(point, town.point)
            if distance < best_m or (distance == best_m and (best is None or town.id < best.id)):
                best, best_m = town, distance

        for cell in cells:
            for town in self.buckets.get(cell, ()):
                consider(town)
        if best is None:
            # Sparse Alaska/Canada: obtain a finite search radius without expanding
            # thousands of empty H3 cells. The cap check below still proves nearest.
            seed = min(bisect_left(self._latitudes, point[0]), len(self._rows) - 1)
            consider(self._rows[seed][0])
        radius = best_m / EARTH_M
        lat_delta = degrees(radius) + 1e-9
        lon_delta = (180 if abs(point[0]) + lat_delta >= 90 else
                     degrees(asin(min(1, sin(radius) / cos(radians(point[0]))))) + 1e-9)
        start = bisect_left(self._latitudes, point[0] - lat_delta)
        end = bisect_right(self._latitudes, point[0] + lat_delta)
        for town, cell in self._rows[start:end]:
            if cell not in cells and abs((town.lon - point[1] + 180) % 360 - 180) <= lon_delta:
                consider(town)
        return best, best_m / M_PER_MI


_index: PlaceIndex | None = None
_index_lock = Lock()


def get_place_index() -> PlaceIndex:
    global _index
    if _index is None:
        with _index_lock:
            if _index is None:
                _index = PlaceIndex()
    return _index


def compass_direction(town: Point, checkpoint: Point) -> str:
    """Initial bearing from town to checkpoint, rounded to an eight-point compass."""
    lat1, lat2 = radians(town[0]), radians(checkpoint[0])
    delta = radians(checkpoint[1] - town[1])
    bearing = degrees(atan2(sin(delta) * cos(lat2),
                            cos(lat1) * sin(lat2) - sin(lat1) * cos(lat2) * cos(delta))) % 360
    return COMPASS[floor((bearing + 22.5) / 45) % 8]


def describe_place(point: Point, mile: float, road: str | None, match: tuple[Town, float] | None,
                   neighbours: tuple[Town, Town] | None = None) -> dict:
    place = {"road": road or None, "town": None, "state": None, "distance_mi": None, "direction": None}
    rest = f"Mile {floor(mile + 0.5)}"
    if match is not None:
        town, distance = match
        direction = compass_direction(town.point, point)
        place.update(town=town.name, state=town.state or None,
                     distance_mi=round(distance, 1), direction=direction)
        location = f"{town.name}, {town.state}" if town.state else town.name
        if distance <= 3:
            rest = f"in {location}"
        elif distance <= 60:
            rest = f"{floor(distance + 0.5)} mi {direction} of {location}"
        elif (neighbours is not None and neighbours[0].id != neighbours[1].id
              and all(haversine(point, t.point) / M_PER_MI <= 120 for t in neighbours)):
            a, b = neighbours
            pair = (f"{a.name} and {b.name}, {a.state}" if a.state == b.state and a.state else
                    f"{a.name}, {a.state} and {b.name}, {b.state}")
            rest = f"between {pair}"
        else:
            rest = f"{floor(distance + 0.5)} mi from {location}"
    return {"place": place, "place_label": f"{road} · {rest}" if road else rest}


def checkpoint_places(checkpoints: Sequence[dict], roads: Sequence[str | None],
                      index: PlaceIndex | None = None) -> list[dict]:
    """Use ordered checkpoints to locate town encounters, including repeated visits.

    Each consecutive run of the same nearest town anchors at its closest checkpoint.
    The preceding/following encounters give route order, not compass-based guesses.
    These are sampled route neighbours, not a claim that the route enters town limits.
    """
    index = index if index is not None else get_place_index()
    points = [(cp["lat"], cp["lon"]) for cp in checkpoints]
    matches = [index.nearest(point) for point in points]
    anchors: list[tuple[int, Town]] = []
    for i, match in enumerate(matches):
        if match is None:
            continue
        town, distance = match
        if i and matches[i - 1] is not None and matches[i - 1][0].id == town.id:
            if distance < matches[anchors[-1][0]][1]:
                anchors[-1] = i, town
        else:
            anchors.append((i, town))
    positions = [i for i, _ in anchors]
    result = []
    for i, (cp, road, point, match) in enumerate(zip(checkpoints, roads, points, matches)):
        before = bisect_left(positions, i) - 1
        after = bisect_right(positions, i)
        neighbours = (anchors[before][1], anchors[after][1]) if before >= 0 and after < len(anchors) else None
        result.append(describe_place(point, cp["mi"], road, match, neighbours))
    return result
