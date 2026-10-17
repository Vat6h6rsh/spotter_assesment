from bisect import bisect_right
from dataclasses import dataclass, field
from datetime import datetime
from typing import Protocol

from planner.domain.geometry import Geometry, Point
from planner.domain.weather import WeatherSeries


@dataclass(frozen=True)
class Route:
    geometry: Geometry
    label: str
    # Half-open spans in geometry.cum_m coordinates; the final endpoint is included.
    roads: list[tuple[float, float, str]] = field(default_factory=list)

    def road_at(self, metres: float) -> str | None:
        # Miles -> metres round-trips can overshoot the destination by a few ulps.
        if abs(metres - self.geometry.cum_m[-1]) < 1e-6:
            metres = self.geometry.cum_m[-1]
        i = bisect_right(self.roads, metres, key=lambda span: span[0]) - 1
        if i < 0:
            return None
        start, end, label = self.roads[i]
        if start <= metres < end or (i == len(self.roads) - 1 and metres == end):
            return label or None
        return None


@dataclass(frozen=True)
class RoutingResult:
    routes: list[Route]
    provider: str
    truck_aware: bool


@dataclass(frozen=True)
class Place:
    id: str
    label: str
    lat: float
    lon: float
    tz: str


class Router(Protocol):
    def routes(self, origin: Point, destination: Point, departure: datetime, cargo_lb: float) -> RoutingResult: ...


class Geocoder(Protocol):
    def search(self, query: str, limit: int) -> list[Place]: ...


class WeatherProvider(Protocol):
    def fetch(self, locations: list[Point]) -> list[WeatherSeries]: ...


class ProviderError(Exception):
    """A provider could not supply usable data. Contains no upstream secrets."""
