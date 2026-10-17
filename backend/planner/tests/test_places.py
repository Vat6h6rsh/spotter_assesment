"""Offline place descriptions, route context, exact nearest search and cost guard."""
from concurrent.futures import ThreadPoolExecutor
from math import degrees
import random
from time import perf_counter

from geonamescache import GeonamesCache
import pytest

from planner.domain.geometry import EARTH_M, M_PER_MI, Geometry, haversine
from planner.domain.places import (CA_PROVINCES, PlaceIndex, Town, checkpoint_places,
                                   compass_direction, describe_place)
from planner.providers.base import Route
from planner.providers.osrm import OSRMRouter
from planner.providers.tomtom import TomTomRouter

TOWN = Town("a", "Kearney", "NE", 40.7, -99.08)


@pytest.mark.parametrize("distance,expected", [
    (0, "in Kearney, NE"), (2.9999, "in Kearney, NE"), (3, "in Kearney, NE"),
    (3.0001, "3 mi N of Kearney, NE"), (59.9999, "60 mi N of Kearney, NE"),
    (60, "60 mi N of Kearney, NE"), (60.0001, "60 mi from Kearney, NE"),
    (120, "120 mi from Kearney, NE"), (121.5, "122 mi from Kearney, NE"),
])
def test_label_thresholds_use_unrounded_distance(distance, expected):
    result = describe_place((40.8, -99.08), 425, "I-80 W", (TOWN, distance))
    assert result["place_label"] == f"I-80 W · {expected}"
    assert result["place"] == {"road": "I-80 W", "town": "Kearney", "state": "NE",
                               "distance_mi": round(distance, 1), "direction": "N"}


@pytest.mark.parametrize("point,expected", [
    ((1, 0), "N"), ((1, 1), "NE"), ((0, 1), "E"), ((-1, 1), "SE"),
    ((-1, 0), "S"), ((-1, -1), "SW"), ((0, -1), "W"), ((1, -1), "NW"),
    ((0.001, 0.00001), "N"), ((0.001, -0.00001), "N"),
])
def test_compass_from_town_to_checkpoint(point, expected):
    assert compass_direction((0, 0), point) == expected


@pytest.mark.parametrize("reverse", [False, True])
def test_between_uses_route_order_neighbours(reverse):
    a, b = Town("a", "West", "TX", 0, 0), Town("b", "East", "TX", 0, 2.9)
    longitudes = [0, 1, 1.45, 1.9, 2.9]
    if reverse:
        longitudes.reverse()
    checkpoints = [{"lat": 0, "lon": lon, "mi": i * 50} for i, lon in enumerate(longitudes)]
    labels = checkpoint_places(checkpoints, [None] * 5, PlaceIndex([a, b]))
    pair = "East and West" if reverse else "West and East"
    assert labels[2]["place_label"] == f"between {pair}, TX"
    assert "between" not in labels[1]["place_label"]  # other town >120 mi
    assert labels[0]["place_label"].startswith("in ")


@pytest.mark.parametrize("miles,between", [(119.9999, True), (120, True), (120.0001, False)])
def test_between_limit_is_inclusive(miles, between):
    # Along a meridian the spherical haversine distance is exactly controllable.
    lat = degrees(miles * M_PER_MI / EARTH_M)
    a, b = Town("a", "South", "TX", -lat, 0), Town("b", "North", "OK", lat, 0)
    result = describe_place((0, 0), 100, None, (a, miles), (a, b))
    assert ("between" in result["place_label"]) == between
    if between:
        assert result["place_label"] == "between South, TX and North, OK"


def test_repeated_town_visits_and_no_false_between_same_town():
    a, b = Town("a", "A", "TX", 0, 0), Town("b", "B", "TX", 0, 2.9)
    cps = [{"lat": 0, "lon": lon, "mi": i * 100} for i, lon in enumerate([0, 1.45, 2.9, 1.45, 0])]
    results = checkpoint_places(cps, [None] * 5, PlaceIndex([a, b]))
    assert results[1]["place_label"] == "between A and B, TX"
    assert results[3]["place_label"] == "between B and A, TX"
    assert "between" not in describe_place((0, 1.45), 100, None, (a, 100), (a, a))["place_label"]


def test_no_roads_no_towns_and_mile_fallback():
    cps = [{"lat": 40.7, "lon": -99.08, "mi": 425.5}]
    assert checkpoint_places(cps, [None], PlaceIndex([TOWN]))[0]["place_label"] == "in Kearney, NE"
    result = checkpoint_places(cps, [None], PlaceIndex([]))[0]
    assert result == {"place_label": "Mile 426", "place": dict.fromkeys(
        ("road", "town", "state", "distance_mi", "direction"))}
    assert checkpoint_places(cps, ["I-80"], PlaceIndex([]))[0]["place_label"] == "I-80 · Mile 426"


def test_road_lookup_half_open_boundaries_gaps_and_destination():
    geometry = Geometry([(0, 0), (0, 1)], [0, 300], [0, 30])
    route = Route(geometry, "Route A", [(0, 100, "I-80 W"), (100, 200, "US-287 N"), (250, 300, "")])
    assert route.road_at(-1) is None
    assert route.road_at(99.999) == "I-80 W"
    assert route.road_at(100) == "US-287 N"
    assert route.road_at(200) is None
    assert route.road_at(275) is None
    assert route.road_at(301) is None
    assert Route(geometry, "A", [(0, 300, "I-80")]).road_at(300) == "I-80"
    assert Route(geometry, "A", [(0, 300, "I-80")]).road_at(300 + 1e-10) == "I-80"
    assert Route(geometry, "A").road_at(100) is None


def test_tomtom_roads_mapped_to_geometry_and_street_fallback(fixture_json):
    raw = fixture_json("tomtom_shape.json")["routes"][0]
    raw["guidance"]["instructions"][0]["roadNumbers"] = ["I 80 W"]
    middle = raw["guidance"]["instructions"][1]
    middle.pop("roadNumbers")
    middle["street"] = "Main Street"
    route = TomTomRouter.normalise(raw, 0)
    boundary = route.geometry.cum_m[1]
    assert route.road_at(boundary - 0.001) == "I-80 W"
    assert route.road_at(boundary) == "Main Street"
    assert route.road_at(route.geometry.cum_m[-1]) == "Main Street"
    for instruction in raw["guidance"]["instructions"]:
        instruction.pop("roadNumbers", None)
        instruction.pop("street", None)
    assert TomTomRouter.normalise(raw, 0).road_at(boundary) is None


def test_osrm_ref_name_fallback_and_missing_steps(fixture_json):
    raw = fixture_json("osrm.json")["routes"][0]
    leg = raw["legs"][0]
    total = sum(leg["annotation"]["distance"])
    leg["steps"] = [{"ref": "US 287 N", "name": "Other", "distance": total / 2},
                    {"name": "Main Street", "distance": total / 2}]
    route = OSRMRouter.normalise(raw, 0)
    boundary = route.roads[1][0]
    assert route.road_at(boundary - 0.001) == "US-287 N"
    assert route.road_at(boundary) == "Main Street"
    assert route.road_at(route.geometry.cum_m[-1]) == "Main Street"
    del leg["steps"]
    assert OSRMRouter.normalise(raw, 0).roads == []


def test_osrm_step_rounding_still_labels_destination(fixture_json):
    route = OSRMRouter.normalise(fixture_json("osrm.json")["routes"][1], 0)
    assert route.roads[-1][1] == route.geometry.cum_m[-1]
    assert route.road_at(route.geometry.cum_m[-1]) == route.roads[-1][2]


def test_osrm_missing_first_leg_does_not_shift_second_leg_roads(fixture_json):
    from planner.domain.geometry import encode_polyline
    raw = fixture_json("osrm.json")["routes"][0]
    # Two segments and two legs, with no steps on the first leg.
    raw["geometry"] = encode_polyline([(40, -100), (40, -99.99), (40, -99.98)])
    raw["legs"] = [
        {"annotation": {"distance": [1000], "duration": [10]}},
        {"annotation": {"distance": [1000], "duration": [10]},
         "steps": [{"ref": "I 80 W", "distance": 999.9}]},
    ]
    route = OSRMRouter.normalise(raw, 0)
    assert route.road_at(route.geometry.cum_m[1] - 1) is None
    assert route.road_at(route.geometry.cum_m[1]) == "I-80 W"
    # Dropped duplicate overview points use the proportional distance mapping.
    raw["geometry"] = encode_polyline([(40, -100), (40, -99.98)])
    route = OSRMRouter.normalise(raw, 0)
    assert route.road_at(route.geometry.cum_m[-1] / 2 - 1) is None
    assert route.road_at(route.geometry.cum_m[-1] / 2) == "I-80 W"


def test_bundled_index_matches_package_loader_and_canadian_abbreviations():
    index = PlaceIndex()
    expected = {str(c["geonameid"]): c for c in GeonamesCache().get_cities().values()
                if c["countrycode"] in {"US", "CA"}}
    actual = {town.id: town for town, _ in index._rows}
    assert actual.keys() == expected.keys()
    for key, town in actual.items():
        city = expected[key]
        assert (town.name, town.lat, town.lon) == (city["name"], city["latitude"], city["longitude"])
        assert town.state == (CA_PROVINCES[city["admin1code"]] if city["countrycode"] == "CA" else city["admin1code"])
    assert index.nearest((50.45, -104.6))[0].state == "SK"
    assert index.nearest((60.72, -135.05))[0].state == "YT"


def test_nearest_matches_brute_force_including_sparse_cells_and_dateline():
    index = PlaceIndex()
    rng = random.Random(421)
    points = [(rng.uniform(18, 84), rng.uniform(-180, -50)) for _ in range(80)]
    points += [(0, 0), (52, 179.9), (64, -135), (89, 0)]
    towns = [town for town, _ in index._rows]
    for point in points:
        nearest = min(towns, key=lambda t: (haversine(point, t.point), t.id))
        town, distance = index.nearest(point)
        assert town == nearest
        assert distance == pytest.approx(haversine(point, town.point) / M_PER_MI)


def test_lazy_singleton_is_built_once_across_threads(monkeypatch):
    import planner.domain.places as places
    index = PlaceIndex([])
    calls = []
    def build():
        calls.append(True)
        return index
    monkeypatch.setattr(places, "_index", None)
    monkeypatch.setattr(places, "PlaceIndex", build)
    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(lambda _: places.get_place_index(), range(12)))
    assert len(calls) == 1
    assert all(result is index for result in results)


def test_offline_place_microbenchmark():
    started = perf_counter()
    index = PlaceIndex()
    build_s = perf_counter() - started
    points = [(41.525, -88.081), (39.739, -104.990), (50.45, -104.6), (64, -135)] * 250
    started = perf_counter()
    for point in points:
        assert index.nearest(point) is not None
    lookup_s = (perf_counter() - started) / len(points)
    print(f"PlaceIndex build {build_s * 1000:.1f} ms; lookup mean {lookup_s * 1000:.3f} ms")
    # Targets: <300 ms build and well under 1 ms/lookup. Allow loaded CI hosts 3x/2x headroom.
    assert build_s < 0.9
    assert lookup_s < 0.002
