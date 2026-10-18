"""TomTom Maps Routing API v1 (not Orbis v3): verified 2026-10-15.

https://docs.tomtom.com/routing-api/documentation/tomtom-maps/v1/calculate-route
https://docs.tomtom.com/routing-api/documentation/tomtom-maps/v1/guidance-instructions
"""
from datetime import datetime

from django.conf import settings

from planner.domain.geometry import Geometry, Point, interpolate, prefix_distances
from .base import ProviderError, Route, RoutingResult
from .resilience import get_json
from .util import checkpoint_road, distinct_routes, road_label


class TomTomRouter:
    def routes(self, origin: Point, destination: Point, departure: datetime, cargo_lb: float,
               *, timeout: float | None = None, retry: bool = True) -> RoutingResult:
        locations = f"{origin[0]},{origin[1]}:{destination[0]},{destination[1]}"
        data = get_json("tomtom", f"https://api.tomtom.com/routing/1/calculateRoute/{locations}/json", {
            "key": settings.TOMTOM_API_KEY, "travelMode": "truck", "vehicleCommercial": "true",
            "vehicleWeight": round((cargo_lb + 35000) * 0.45359237), "vehicleHeight": 4.11,
            "vehicleLength": 22, "vehicleWidth": 2.6, "vehicleMaxSpeed": 105,
            "departAt": departure.isoformat().replace("+00:00", "Z"), # 2 alternatives = 3 routes; asking for 5 returned the same 3 but took ~2 s longer (measured).
            "maxAlternatives": 2,
            "alternativeType": "anyRoute", "instructionsType": "coded", "routeRepresentation": "polyline",
            "traffic": "true",
        }, timeout=timeout, retry=retry)
        try:
            routes = [self.normalise(raw, i) for i, raw in enumerate(data["routes"])]
            if not routes:
                raise ValueError("No route")
            return RoutingResult(distinct_routes(routes), "tomtom", True)
        except (KeyError, TypeError, ValueError, IndexError) as exc:
            raise ProviderError("TomTom returned no usable routes") from exc

    @staticmethod
    def normalise(raw: dict, index: int) -> Route:
        points: list[Point] = []
        for leg in raw["legs"]:
            part = [(p["latitude"], p["longitude"]) for p in leg["points"]]
            points.extend(part[1:] if points and part and part[0] == points[-1] else part)
        cum_m = prefix_distances(points)
        summary = raw["summary"]
        length = float(summary["lengthInMeters"])
        duration = float(summary["travelTimeInSeconds"])
        instructions = raw.get("guidance", {}).get("instructions", [])
        if not instructions:
            raise ValueError("Guidance timing knots are required")
        # Instruction offsets and times are cumulative from route start.
        knots: dict[float, float] = {0.0: 0.0, length: duration}
        geometry_offsets: dict[float, float] = {0.0: 0.0, cum_m[-1]: length}
        roads: list[tuple[str, float]] = []
        road_spans: list[tuple[float, float, str]] = []
        for i, instruction in enumerate(instructions):
            offset = float(instruction["routeOffsetInMeters"])
            if 0 < offset < length:
                knots[offset] = float(instruction["travelTimeInSeconds"])
                if "pointIndex" in instruction:
                    geometry_offsets[cum_m[instruction["pointIndex"]]] = offset
            end = instructions[i + 1]["routeOffsetInMeters"] if i + 1 < len(instructions) else length
            ref = ";".join(instruction.get("roadNumbers") or [])
            roads.append((ref, max(0, end - offset)))
            if end > offset:
                road_spans.append((offset, float(end), checkpoint_road(ref, instruction.get("street", ""))))
        offsets = sorted(knots)
        seconds = [knots[k] for k in offsets]
        # Map provider road offsets to the haversine prefix coordinate using
        # instruction point indices. This keeps every instruction's timing exact.
        geo_knots = sorted(geometry_offsets)
        road_knots = [geometry_offsets[m] for m in geo_knots]
        times = [interpolate(offsets, seconds, interpolate(geo_knots, road_knots, m)) for m in cum_m]
        spans = [(interpolate(road_knots, geo_knots, start), interpolate(road_knots, geo_knots, end), label)
                 for start, end, label in road_spans]
        return Route(Geometry(points, cum_m, times), road_label(roads, f"Route {chr(65 + index)}"), spans)
