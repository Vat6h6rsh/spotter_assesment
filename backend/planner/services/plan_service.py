from dataclasses import asdict
from datetime import datetime, timedelta, timezone
import hashlib
import json
from uuid import uuid4

import h3
from django.conf import settings
from django.core.cache import cache
from tzfpy import get_tz

from planner.domain.advisor import DepartureOption, best_departure
from planner.domain.checkpoints import checkpoint_miles, summarise
from planner.domain.eta import RestPolicy, elapsed_at, progress_knots, schedule
from planner.domain.geometry import M_PER_MI, encode_polyline, simplify
from planner.domain.places import checkpoint_places
from planner.domain.recommend import RouteScore, recommend
from planner.domain.risk import classify
from planner.domain.weather import clearance, sample
from planner.domain.weather_delay import NONE as NO_SLOWDOWN, adjusted_geometry, slowdown
from planner.providers.base import ProviderError, RoutingResult
from planner.providers.osrm import OSRMRouter
from planner.providers.resilience import singleflight
from planner.providers.tomtom import TomTomRouter
from .weather_store import WeatherStore


def iso(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def advice_gain(current: RouteScore, better: RouteScore) -> str:
    """Name the first sort key on which the later departure actually improves."""
    for key, name in (("no_travel", "No Travel"), ("severe", "Severe"), ("high", "High")):
        now, later = current.risk.miles_by_level[key], better.risk.miles_by_level[key]
        if later < now:
            return f"{name} miles {now:.0f} → {later:.0f}"
    if (better.risk.avg_risk or 0) < (current.risk.avg_risk or 0):
        return f"average risk {current.risk.avg_risk:.2f} → {better.risk.avg_risk:.2f}"
    return f"{round((current.total_s - better.total_s) / 60)} min faster"


def get_routing(inputs: dict) -> RoutingResult:
    origin, destination = inputs["origin"], inputs["destination"]
    departure = datetime.fromisoformat(inputs["departure_utc"])
    import math
    bucket = math.ceil(inputs["cargo_lb"] / 5000)
    coordinates = [round(p[k], 4) for p in (origin, destination) for k in ("lat", "lon")]
    signature = [coordinates, departure.strftime("%Y-%m-%dT%H"), bucket, bool(settings.TOMTOM_API_KEY)]
    digest = hashlib.sha256(json.dumps(signature).encode()).hexdigest()

    def compute() -> RoutingResult:
        start, end = (origin["lat"], origin["lon"]), (destination["lat"], destination["lon"])
        if settings.TOMTOM_API_KEY:
            try:
                return TomTomRouter().routes(start, end, departure, inputs["cargo_lb"])
            except ProviderError:
                pass
        return OSRMRouter().routes(start, end, departure, inputs["cargo_lb"])

    return singleflight(f"route:v2:{digest}", 21600, compute)


def create_plan(inputs: dict) -> dict:
    digest = hashlib.sha256(json.dumps(inputs, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    result = singleflight(f"plan-result:v3:{digest}", 600, lambda: build_plan(inputs), wait_s=30)
    return result


def build_plan(inputs: dict) -> dict:
    routing = get_routing(inputs)
    if not routing.routes:
        raise ProviderError("No distinct routes found")
    warnings: list[dict[str, str]] = []
    if not routing.truck_aware:
        warnings.append({"code": "CAR_ROUTING", "message": "car routing: truck restrictions not applied"})
    if len(routing.routes) < 3:
        warnings.append({"code": "FEWER_ROUTES", "message": f"Only {len(routing.routes)} distinct routes were found."})
    departure = datetime.fromisoformat(inputs["departure_utc"])
    policy = RestPolicy(**inputs["rest"])
    use_slowdown = inputs.get("weather_slowdown", True)
    prepared: list[dict] = []
    cells: list[str] = []
    for index, route in enumerate(routing.routes):
        geometry = route.geometry
        miles = checkpoint_miles(geometry.cum_m[-1] / M_PER_MI, inputs["spacing_mi"])
        checkpoints: list[dict] = []
        for i, mi in enumerate(miles):
            (lat, lon), _ = geometry.at_m(mi * M_PER_MI)
            cell = h3.latlng_to_cell(lat, lon, 5)
            cells.append(cell)
            checkpoints.append({"i": i, "mi": mi, "lat": round(lat, 6), "lon": round(lon, 6),
                                "tz": get_tz(lon, lat), "_cell": cell})
        places = checkpoint_places(checkpoints, [route.road_at(mi * M_PER_MI) for mi in miles])
        for cp, place in zip(checkpoints, places):
            cp.update(place)
        prepared.append({"id": chr(65 + index), "route": route, "miles": miles, "checkpoints": checkpoints})
    # Checkpoint locations do not depend on time, so one weather fetch serves every timing pass and offset.
    weather, weather_warnings = WeatherStore().get_many(cells)
    warnings.extend(weather_warnings)
    fetched_at = min((series.fetched_at for series in weather.values() if series is not None), default=datetime.now(timezone.utc))

    def timing(item: dict, offset_h: int) -> dict:
        """ETA -> weather -> slowdown -> ETA ... until the slowdowns stop changing (max 3 passes, no API calls)."""
        base = item["route"].geometry
        start = departure + timedelta(hours=offset_h)
        built = [NO_SLOWDOWN] * len(item["miles"])  # the slowdowns that built the current geometry
        for attempt in range(4):
            geometry = adjusted_geometry(base, item["miles"], [b.factor for b in built])
            rests = schedule(geometry, policy)
            elapsed = [elapsed_at(geometry.at_m(mi * M_PER_MI)[1], rests) for mi in item["miles"]]
            samples = [sample(weather[cp["_cell"]], start + timedelta(seconds=e))
                       for cp, e in zip(item["checkpoints"], elapsed)]
            if not use_slowdown or attempt == 3:
                break  # attempt 3 only re-times with the last slowdowns, so labels always match the clock
            proposed = [slowdown(v.rain, v.snow) for v in samples]
            if [p.factor for p in proposed] == [b.factor for b in built]:
                break
            built = proposed
        state = {"geometry": geometry, "rests": rests, "elapsed": elapsed, "samples": samples, "slowdowns": built}
        state["total_s"] = geometry.cum_drive_s[-1] + sum(r.duration_s for r in rests)
        state["weather_delay_s"] = geometry.cum_drive_s[-1] - base.cum_drive_s[-1]
        return state

    def evaluate(offset_h: int) -> tuple[list[dict], list[RouteScore]]:
        evaluated: list[dict] = []
        scores: list[RouteScore] = []
        for index, item in enumerate(prepared):
            state = timing(item, offset_h)
            checkpoints = []
            for cp, elapsed, value, slow in zip(item["checkpoints"], state["elapsed"], state["samples"], state["slowdowns"]):
                eta = departure + timedelta(seconds=elapsed, hours=offset_h)
                classification = classify(value.wind, value.gust, value.rain, value.snow, inputs["cargo_lb"], inputs["wind_measure"])
                clears_h, clears_at = (clearance(weather[cp["_cell"]], eta, classification.level,
                                                 inputs["cargo_lb"], inputs["wind_measure"])
                                       if offset_h == 0 else (None, None))
                public_cp = {k: v for k, v in cp.items() if not k.startswith("_")}
                public_cp.update(asdict(classification))
                public_cp.update({"elapsed_s": elapsed, "eta_utc": iso(eta), "wind_mph": value.wind, "gust_mph": value.gust,
                                  "rain_in": value.rain, "snow_in": value.snow,
                                  "speed_factor": slow.factor, "slowdown": slow.reason,
                                  "clears_in_h": clears_h, "clears_at_utc": iso(clears_at) if clears_at else None,
                                  "forecast_hour_utc": iso(value.forecast_hour) if value.forecast_hour else None,
                                  "beyond_horizon": value.beyond_horizon})
                checkpoints.append(public_cp)
            summary = summarise([cp["mi"] for cp in checkpoints], [cp["level"] for cp in checkpoints])
            scores.append(RouteScore(item["id"], index, state["total_s"], summary))
            evaluated.append({"checkpoints": checkpoints, "risk": asdict(summary), "_state": state})
        return evaluated, scores

    evaluated, scores = evaluate(0)
    verdict = recommend(scores, inputs["spacing_mi"])
    current = next(score for score in scores if score.id == verdict.order[0])
    options = []
    for offset in (3, 6, 12, 24):
        _, shifted = evaluate(offset)
        shifted_verdict = recommend(shifted, inputs["spacing_mi"])
        choice = next(score for score in shifted if score.id == shifted_verdict.order[0])
        options.append(DepartureOption(offset, choice))
    advice = best_departure(current, options)
    recommendation = {k: v for k, v in asdict(verdict).items() if k != "order"}
    recommendation["departure_advice"] = ({"offset_h": advice.offset_h, "route_id": advice.route.id,
        "summary": f"Leave {advice.offset_h} h later on {advice.route.id}: {advice_gain(current, advice.route)}"} if advice else None)
    if any(score.risk.coverage < 0.95 for score in scores):
        warnings.append({"code": "MISSING_WEATHER", "message": "Recommendation may change with missing forecast data."})
    routes = []
    fastest = min(scores, key=lambda score: (score.total_s, score.index)).id
    destination = inputs["destination"]
    arrival_tz = get_tz(destination["lon"], destination["lat"])
    for item, data, score in zip(prepared, evaluated, scores):
        state = data.pop("_state")
        geometry = state["geometry"]  # weather-slowed clock over the provider's road geometry
        # Progress is for display; checkpoint/rest knots preserve the exact ETA
        # and rest plateaus while avoiding tens of thousands of geometry knots.
        checkpoint_geometry = type(geometry)(
            [(cp["lat"], cp["lon"]) for cp in item["checkpoints"]],
            [mi * M_PER_MI for mi in item["miles"]],
            [geometry.at_m(mi * M_PER_MI)[1] for mi in item["miles"]])
        rests = []
        for rest in state["rests"]:
            (lat, lon), _ = geometry.at_m(rest.at_mi * M_PER_MI)
            rests.append({"at_mi": rest.at_mi, "start_utc": iso(departure + timedelta(seconds=rest.elapsed_s)),
                          "duration_s": rest.duration_s, "kind": rest.kind, "lat": round(lat, 6), "lon": round(lon, 6)})
        lats, lons = [p[0] for p in geometry.points], [p[1] for p in geometry.points]
        routes.append({"id": item["id"], "label": item["route"].label, "rank": verdict.order.index(item["id"]) + 1,
                       "eligible": score.risk.miles_by_level["no_travel"] == 0, "is_fastest": item["id"] == fastest,
                       "polyline": encode_polyline(simplify(geometry.points)), "bbox": [min(lons), min(lats), max(lons), max(lats)],
                       "distance_mi": geometry.cum_m[-1] / M_PER_MI, "drive_s": geometry.cum_drive_s[-1],
                       "weather_delay_s": state["weather_delay_s"],
                       "rest_s": sum(r.duration_s for r in state["rests"]), "total_s": state["total_s"],
                       "arrival_utc": iso(departure + timedelta(seconds=state["total_s"])), "arrival_tz": arrival_tz,
                       "rests": rests, "progress": progress_knots(checkpoint_geometry, state["rests"]), **data})
    plan_id = f"p_{uuid4().hex}"
    result = {"plan_id": plan_id, "created_at": iso(datetime.now(timezone.utc)), "inputs": inputs,
              "providers": {"routing": {"name": routing.provider, "truck_aware": routing.truck_aware},
                            "weather": {"name": "open-meteo", "fetched_at": iso(fetched_at)}},
              "warnings": warnings, "recommendation": recommendation, "routes": routes}
    cache.set(f"plan:v1:{plan_id}", {"result": result, "points": [route.geometry.points for route in routing.routes]}, 3600)
    return result
