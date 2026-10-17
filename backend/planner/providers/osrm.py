from datetime import datetime

from planner.domain.geometry import Geometry, Point, decode_polyline, interpolate, prefix_distances
from .base import ProviderError, Route, RoutingResult
from .resilience import get_json
from .util import checkpoint_road, distinct_routes, road_label


class OSRMRouter:
    def routes(self, origin: Point, destination: Point, departure: datetime, cargo_lb: float) -> RoutingResult:
        coordinates = f"{origin[1]},{origin[0]};{destination[1]},{destination[0]}"
        data = get_json("osrm", f"https://router.project-osrm.org/route/v1/driving/{coordinates}", {
            "alternatives": 3, "overview": "full", "geometries": "polyline",
            "annotations": "distance,duration", "steps": "true",
        })
        try:
            if data.get("code") != "Ok":
                raise ValueError("No route")
            routes = [self.normalise(raw, i) for i, raw in enumerate(data["routes"])]
            return RoutingResult(distinct_routes(routes), "osrm", False)
        except (KeyError, TypeError, ValueError, IndexError, AttributeError) as exc:
            raise ProviderError("OSRM returned no usable routes") from exc

    @staticmethod
    def normalise(raw: dict, index: int) -> Route:
        points = decode_polyline(raw["geometry"])
        cum_m = prefix_distances(points)
        distances = [0.0]
        seconds = [0.0]
        roads: list[tuple[str, float]] = []
        road_spans: list[tuple[float, float, str]] = []
        for leg in raw["legs"]:
            annotation = leg["annotation"]
            leg_start = distances[-1]
            if len(annotation["distance"]) != len(annotation["duration"]):
                raise ValueError("Mismatched annotation arrays")
            for distance, duration in zip(annotation["distance"], annotation["duration"]):
                distances.append(distances[-1] + distance)
                seconds.append(seconds[-1] + duration)
            steps = leg.get("steps") or []
            lengths = [max(0, float(step.get("distance") or 0)) for step in steps]
            step_total = sum(lengths)
            road_offset = leg_start
            step_offset = 0.0
            for step, distance in zip(steps, lengths):
                ref = step.get("ref") or ""
                roads.append((ref, distance))
                if distance > 0:
                    step_offset += distance
                    # Steps/annotations round independently (the recording differs
                    # by up to 0.33 m). Align each complete leg to its annotation end.
                    end = leg_start + step_offset / step_total * (distances[-1] - leg_start)
                    road_spans.append((road_offset, end,
                                       checkpoint_road(ref, step.get("name", ""))))
                    road_offset = end
        if len(distances) == len(points):
            times = seconds
        else:
            # OSRM may omit duplicate coordinates from overview geometry. Preserve
            # annotated speed changes via interpolation in annotation-distance space.
            times = [interpolate(distances, seconds, m * distances[-1] / cum_m[-1]) for m in cum_m]
        spans = [(interpolate(distances, cum_m, start), interpolate(distances, cum_m, end), label)
                 if len(distances) == len(points) else
                 (start * cum_m[-1] / distances[-1], end * cum_m[-1] / distances[-1], label)
                 for start, end, label in road_spans]
        return Route(Geometry(points, cum_m, times), road_label(roads, f"Route {chr(65 + index)}"), spans)
