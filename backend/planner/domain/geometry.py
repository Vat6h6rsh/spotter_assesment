"""Road geometry in (latitude, longitude) order; distances in metres."""
from bisect import bisect_right
from dataclasses import dataclass
from math import asin, cos, floor, isfinite, radians, sin, sqrt
from collections.abc import Sequence

Point = tuple[float, float]
M_PER_MI = 1609.344
EARTH_M = 6371008.8


def haversine(a: Point, b: Point) -> float:
    lat1, lat2 = radians(a[0]), radians(b[0])
    h = sin((lat2 - lat1) / 2) ** 2 + cos(lat1) * cos(lat2) * sin(radians(b[1] - a[1]) / 2) ** 2
    return 2 * EARTH_M * asin(min(1.0, sqrt(h)))


def prefix_distances(points: Sequence[Point]) -> list[float]:
    result = [0.0]
    for a, b in zip(points, points[1:]):
        result.append(result[-1] + haversine(a, b))
    return result


def interpolate(xs: Sequence[float], ys: Sequence[float], x: float) -> float:
    if x <= xs[0]:
        return ys[0]
    if x >= xs[-1]:
        return ys[-1]
    i = bisect_right(xs, x) - 1
    ratio = (x - xs[i]) / (xs[i + 1] - xs[i])
    return ys[i] + ratio * (ys[i + 1] - ys[i])


@dataclass(frozen=True)
class Geometry:
    points: list[Point]
    cum_m: list[float]
    cum_drive_s: list[float]

    def __post_init__(self) -> None:
        if len(self.points) < 2 or len(self.points) != len(self.cum_m) or len(self.points) != len(self.cum_drive_s):
            raise ValueError("Geometry arrays must have the same length (at least two)")
        if any(not isfinite(v) for values in (self.cum_m, self.cum_drive_s) for v in values):
            raise ValueError("Geometry distances and times must be finite")
        if any(not (-90 <= lat <= 90 and -180 <= lon <= 180) for lat, lon in self.points):
            raise ValueError("Invalid geometry coordinates")
        if self.cum_m[0] != 0 or self.cum_drive_s[0] != 0 or self.cum_m[-1] <= 0:
            raise ValueError("Geometry must start at zero and have positive distance")
        if any(b < a for values in (self.cum_m, self.cum_drive_s) for a, b in zip(values, values[1:])):
            raise ValueError("Geometry prefix arrays must be monotone")

    def at_m(self, metres: float) -> tuple[Point, float]:
        i = max(0, min(len(self.points) - 2, bisect_right(self.cum_m, metres) - 1))
        width = self.cum_m[i + 1] - self.cum_m[i]
        f = max(0.0, min(1.0, (metres - self.cum_m[i]) / width)) if width else 0.0
        a, b = self.points[i], self.points[i + 1]
        return ((a[0] + f * (b[0] - a[0]), a[1] + f * (b[1] - a[1])),
                interpolate(self.cum_m, self.cum_drive_s, metres))


def point_segment_m(p: Point, a: Point, b: Point) -> float:
    scale = cos(radians(p[0]))
    ax, ay = radians(a[1] - p[1]) * scale * EARTH_M, radians(a[0] - p[0]) * EARTH_M
    bx, by = radians(b[1] - p[1]) * scale * EARTH_M, radians(b[0] - p[0]) * EARTH_M
    dx, dy = bx - ax, by - ay
    f = max(0.0, min(1.0, -(ax * dx + ay * dy) / (dx * dx + dy * dy))) if dx or dy else 0.0
    return sqrt((ax + f * dx) ** 2 + (ay + f * dy) ** 2)


def simplify(points: Sequence[Point], tolerance_m: float = 80) -> list[Point]:
    keep = {0, len(points) - 1}
    stack = [(0, len(points) - 1)]
    while stack:
        start, end = stack.pop()
        if end <= start + 1:
            continue
        distance, index = max((point_segment_m(points[i], points[start], points[end]), i) for i in range(start + 1, end))
        if distance > tolerance_m:
            keep.add(index)
            stack.extend(((start, index), (index, end)))
    return [points[i] for i in sorted(keep)]


def encode_polyline(points: Sequence[Point]) -> str:
    output: list[str] = []
    previous = [0, 0]
    for point in points:
        for axis, value in enumerate(point):
            current = floor(value * 1e5 + 0.5)
            delta = current - previous[axis]
            previous[axis] = current
            encoded = ~(delta << 1) if delta < 0 else delta << 1
            while encoded >= 0x20:
                output.append(chr((0x20 | (encoded & 0x1f)) + 63))
                encoded >>= 5
            output.append(chr(encoded + 63))
    return "".join(output)


def decode_polyline(encoded: str) -> list[Point]:
    coordinates = [0, 0]
    index = 0
    points: list[Point] = []
    while index < len(encoded):
        for axis in range(2):
            result = shift = 0
            while True:
                value = ord(encoded[index]) - 63
                index += 1
                result |= (value & 0x1f) << shift
                shift += 5
                if value < 0x20:
                    break
            coordinates[axis] += ~(result >> 1) if result & 1 else result >> 1
        points.append((coordinates[0] / 1e5, coordinates[1] / 1e5))
    return points


def densify(points: Sequence[Point], max_step_m: float = 10000) -> list[Point]:
    from math import ceil
    result = [points[0]]
    for a, b in zip(points, points[1:]):
        steps = max(1, ceil(haversine(a, b) / max_step_m))
        result.extend((a[0] + (b[0] - a[0]) * i / steps, a[1] + (b[1] - a[1]) * i / steps) for i in range(1, steps + 1))
    return result


def shared_fraction(candidate: Geometry, reference: Geometry) -> float:
    """Length-weighted 1 km samples within 40 m of reference segments (enough to spot an 85% overlap)."""
    from math import ceil
    grid: dict[tuple[int, int], list[tuple[Point, Point]]] = {}
    dense = densify(reference.points, 1000)
    for a, b in zip(dense, dense[1:]):
        for x in range(floor(min(a[0], b[0]) * 50) - 1, floor(max(a[0], b[0]) * 50) + 2):
            for y in range(floor(min(a[1], b[1]) * 50) - 1, floor(max(a[1], b[1]) * 50) + 2):
                grid.setdefault((x, y), []).append((a, b))
    count = max(1, ceil(candidate.cum_m[-1] / 1000))
    shared = 0
    for i in range(count):
        p, _ = candidate.at_m(candidate.cum_m[-1] * (i + 0.5) / count)
        shared += any(point_segment_m(p, a, b) <= 40 for a, b in grid.get((floor(p[0] * 50), floor(p[1] * 50)), []))
    return shared / count
