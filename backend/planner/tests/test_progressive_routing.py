"""Offline routing upgrades with event-controlled jobs; no provider timing sleeps."""
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
from threading import Barrier, Event, Lock, current_thread

import httpx
import pytest
from django.core.cache import cache, caches
from rest_framework.test import APIClient

from planner.api.schema import PlanResponse, TruckRouteStatus
from planner.api.serializers import PlanSerializer
from planner.api.views import TruckRouteThrottle, TruckRouteView
from planner.providers.base import ProviderError
from planner.services import plan_service as service
from .test_docs import assert_matches

TOMTOM_URL = "https://api.tomtom.com/routing/1/calculateRoute/"


def finish(future):
    """Wait for both the job and its registry-cleanup callback, including failures."""
    cleaned = Event()
    future.add_done_callback(lambda _: cleaned.set())
    future.result(timeout=5)
    assert cleaned.wait(5)


@pytest.fixture(autouse=True)
def progressive(settings, monkeypatch):
    settings.TOMTOM_API_KEY = "fixture-key"
    monkeypatch.setattr(service, "TRUCK_WAIT_S", 1.0)
    monkeypatch.setattr(service, "TRUCK_TIMEOUT_S", 0.02)
    yield
    with service._truck_jobs_lock:
        remaining = list(service._truck_jobs.values())
    for future in remaining:
        finish(future)
    assert service._truck_jobs == {}


@pytest.fixture
def inputs(plan_request):
    serializer = PlanSerializer(data=plan_request)
    serializer.is_valid(raise_exception=True)
    return serializer.validated_data


@pytest.fixture
def writes(monkeypatch):
    seen = []
    backend_class = type(caches["default"])
    original = backend_class.set

    def record(self, key, value, timeout=None, **kwargs):
        seen.append((key, timeout))
        return original(self, key, value, timeout, **kwargs)

    # Django's cache proxy resolves a different backend instance in each thread.
    monkeypatch.setattr(backend_class, "set", record)
    return seen


@pytest.fixture
def blocked_truck(offline, fixture_json, monkeypatch):
    started, release = Event(), Event()

    def respond(request):
        started.set()
        assert release.wait(5), "Test did not release TomTom"
        return httpx.Response(200, json=fixture_json("tomtom_shape.json"))

    mock = offline.get(url__startswith=TOMTOM_URL).mock(side_effect=respond)
    monkeypatch.setattr(service, "TRUCK_WAIT_S", 0.001)
    yield mock, started, release
    release.set()
    with service._truck_jobs_lock:
        remaining = list(service._truck_jobs.values())
    for future in remaining:
        finish(future)


def post(client, request):
    response = client.post("/api/plans", request, format="json")
    assert response.status_code == 200, response.content
    plan = response.json()
    assert_matches(PlanResponse, plan)
    return plan


def status(client, plan):
    response = client.get(f"/api/plans/{plan['plan_id']}/truck-route")
    assert response.status_code == 200, response.content
    result = response.json()
    assert_matches(TruckRouteStatus, result)
    return result


def test_fast_tomtom_returns_truck_plan_without_osrm(client, plan_request, replay, offline, fixture_json, writes):
    mock = offline.get(url__startswith=TOMTOM_URL).mock(
        return_value=httpx.Response(200, json=fixture_json("tomtom_shape.json")))
    plan = post(client, plan_request)
    assert plan["providers"]["routing"] == {
        "name": "tomtom", "truck_aware": True, "truck_pending": False, "fallback_reason": None}
    assert not any(w["code"] == "CAR_ROUTING" for w in plan["warnings"])
    assert replay["osrm"].call_count == 0 and mock.call_count == 1
    assert mock.calls[0].request.extensions["timeout"]["read"] == service.TRUCK_TIMEOUT_S
    assert status(client, plan) == {"status": "not_applicable", "retry_after_s": None}
    assert post(client, plan_request) == plan
    assert any(key.startswith("route:v2:") and ttl == service.TRUCK_RESULT_TTL for key, ttl in writes)
    assert any(key.startswith("plan-result:v3:") and ttl == 600 for key, ttl in writes)


def test_pending_then_ready_and_repost_bypasses_car_plan_cache(
        client, plan_request, replay, blocked_truck, writes):
    mock, started, release = blocked_truck
    plan = post(client, plan_request)
    assert started.wait(5)
    assert plan["providers"]["routing"] == {
        "name": "osrm", "truck_aware": False, "truck_pending": True, "fallback_reason": "pending"}
    assert {"code": "CAR_ROUTING", "message": "Truck route still loading; showing car routing meanwhile."} in plan["warnings"]
    entry = cache.get(f"plan:v1:{plan['plan_id']}")
    digest = entry["route_digest"]
    assert digest == service.route_digest(plan["inputs"])
    assert "route_digest" not in plan
    assert cache.get(f"route:v2:{digest}") is None
    assert cache.get(f"route-car:v1:{digest}").provider == "osrm"
    assert status(client, plan) == {"status": "pending", "retry_after_s": 3}
    assert post(client, plan_request) == plan
    assert any(key.startswith("plan-result:v3:") and ttl == 3 for key, ttl in writes)
    assert (f"route-car:v1:{digest}", service.CAR_FALLBACK_TTL) in writes
    with service._truck_jobs_lock:
        future = service._truck_jobs[digest]
    release.set()
    finish(future)
    assert digest not in service._truck_jobs
    assert status(client, plan) == {"status": "ready", "retry_after_s": None}
    upgraded = post(client, plan_request)
    assert upgraded["plan_id"] != plan["plan_id"]
    assert upgraded["providers"]["routing"] == {
        "name": "tomtom", "truck_aware": True, "truck_pending": False, "fallback_reason": None}
    assert mock.call_count == 1 and replay["osrm"].call_count == 1
    # Ready remains attached to the original car plan; its geometry is immutable.
    assert status(client, plan)["status"] == "ready"


@pytest.mark.parametrize("failure", ["timeout", "error"])
def test_failure_marker_short_cache_no_retry_and_no_second_job(
        failure, client, plan_request, inputs, replay, offline, writes):
    def fail(request):
        if failure == "timeout":
            raise httpx.ReadTimeout("fixture timeout", request=request)
        return httpx.Response(503)

    mock = offline.get(url__startswith=TOMTOM_URL).mock(side_effect=fail)
    plan = post(client, plan_request)
    assert plan["providers"]["routing"] == {
        "name": "osrm", "truck_aware": False, "truck_pending": False, "fallback_reason": failure}
    message = ("Truck routing timed out; car routing: truck restrictions not applied." if failure == "timeout" else
               "Truck routing unavailable; car routing: truck restrictions not applied.")
    assert {"code": "CAR_ROUTING", "message": message} in plan["warnings"]
    digest = service.route_digest(inputs)
    assert cache.get(f"route-truck-failed:v1:{digest}") == failure
    assert cache.get("circuit:tomtom:failures") == 1
    assert status(client, plan) == {"status": "failed", "retry_after_s": None}
    assert post(client, plan_request) == plan
    for key, ttl in writes:
        if key.startswith("plan-result:v3:"):
            assert 0 < ttl <= service.CAR_FALLBACK_TTL
    assert (f"route-truck-failed:v1:{digest}", service.TRUCK_FAILED_TTL) in writes
    # Bypass the plan-result cache to exercise the five-minute route-failure marker.
    different = dict(inputs, spacing_mi=10)
    assert service.get_routing(different).fallback_reason == failure
    assert mock.call_count == 1 and replay["osrm"].call_count == 1


@pytest.mark.parametrize("failure", ["timeout", "error"])
def test_pending_plan_is_bypassed_after_background_failure(
        failure, client, plan_request, inputs, replay, offline, monkeypatch):
    started, release = Event(), Event()

    def respond(request):
        started.set()
        assert release.wait(5)
        if failure == "timeout":
            raise httpx.ReadTimeout("fixture timeout", request=request)
        return httpx.Response(503)

    mock = offline.get(url__startswith=TOMTOM_URL).mock(side_effect=respond)
    monkeypatch.setattr(service, "TRUCK_WAIT_S", 0.001)
    try:
        pending = post(client, plan_request)
        assert started.wait(5) and pending["providers"]["routing"]["truck_pending"]
        with service._truck_jobs_lock:
            future = service._truck_jobs[service.route_digest(inputs)]
    finally:
        release.set()
    finish(future)
    assert status(client, pending) == {"status": "failed", "retry_after_s": None}
    failed = post(client, plan_request)
    assert failed["plan_id"] != pending["plan_id"]
    assert failed["providers"]["routing"]["fallback_reason"] == failure
    assert not failed["providers"]["routing"]["truck_pending"]
    assert mock.call_count == 1 and replay["osrm"].call_count == 1


def test_two_concurrent_requests_share_one_truck_job(inputs, replay, blocked_truck):
    mock, started, release = blocked_truck
    together = Barrier(2)

    def route():
        together.wait(timeout=5)
        return service.get_routing(inputs)

    with ThreadPoolExecutor(max_workers=2) as pool:
        first, second = pool.submit(route), pool.submit(route)
        assert started.wait(5)
        results = [first.result(timeout=5), second.result(timeout=5)]
    assert all(result.truck_pending and result.fallback_reason == "pending" for result in results)
    assert len(service._truck_jobs) == 1
    with service._truck_jobs_lock:
        future = service._truck_jobs[service.route_digest(inputs)]
    release.set()
    finish(future)
    assert mock.call_count == 1 and replay["osrm"].call_count == 1


def test_concurrent_identical_pending_plans_share_singleflight(
        monkeypatch, plan_request, replay, blocked_truck):
    mock, started, release = blocked_truck
    original = service.build_plan
    entered, build_release = Event(), Event()
    calls = []

    def build(inputs):
        calls.append(True)
        entered.set()
        assert build_release.wait(5)
        return original(inputs)

    monkeypatch.setattr(service, "build_plan", build)
    together = Barrier(2)

    def request():
        together.wait(timeout=5)
        return post(APIClient(), plan_request)

    with ThreadPoolExecutor(max_workers=2) as pool:
        first, second = pool.submit(request), pool.submit(request)
        try:
            assert entered.wait(5)
        finally:
            build_release.set()
        results = [first.result(timeout=5), second.result(timeout=5)]
    assert results[0] == results[1]
    assert started.wait(5)
    with service._truck_jobs_lock:
        future = next(iter(service._truck_jobs.values()))
    release.set()
    finish(future)
    assert len(calls) == 1 and mock.call_count == 1


def test_executor_limits_two_active_jobs_and_retains_queued_job(
        inputs, replay, offline, fixture_json, monkeypatch):
    two_started, release = Event(), Event()
    mutex = Lock()
    active = peak = 0
    threads = []

    def respond(request):
        nonlocal active, peak
        with mutex:
            active += 1
            peak = max(peak, active)
            threads.append(current_thread().name)
            if active == 2:
                two_started.set()
        try:
            assert release.wait(5)
            return httpx.Response(200, json=fixture_json("tomtom_shape.json"))
        finally:
            with mutex:
                active -= 1

    mock = offline.get(url__startswith=TOMTOM_URL).mock(side_effect=respond)
    monkeypatch.setattr(service, "TRUCK_WAIT_S", 0.001)
    try:
        results = [service.get_routing(dict(inputs, cargo_lb=cargo)) for cargo in (0, 5000, 10000)]
        assert all(result.truck_pending for result in results)
        assert two_started.wait(5)
        with service._truck_jobs_lock:
            futures = list(service._truck_jobs.values())
        assert len(futures) == 3
        assert sum(future.running() for future in futures) == 2
    finally:
        release.set()
    for future in futures:
        finish(future)
    assert peak == 2 and mock.call_count == 3
    assert all(name.startswith("truck-route") for name in threads)


def test_no_key_uses_osrm_and_status_not_applicable(client, plan_request, replay, settings, writes):
    settings.TOMTOM_API_KEY = ""
    plan = post(client, plan_request)
    assert plan["providers"]["routing"] == {
        "name": "osrm", "truck_aware": False, "truck_pending": False, "fallback_reason": "no_key"}
    assert {"code": "CAR_ROUTING", "message": "car routing: truck restrictions not applied"} in plan["warnings"]
    assert status(client, plan) == {"status": "not_applicable", "retry_after_s": None}
    assert service._truck_jobs == {}
    assert any(key.startswith("plan-result:v3:") and ttl == 600 for key, ttl in writes)


def test_unknown_plan_matches_heatmap_expiry_error(client):
    response = client.get("/api/plans/p_unknown/truck-route")
    assert response.status_code == 404
    assert response.json() == client.get("/api/plans/p_unknown/heatmap").json() == {
        "error": {"code": "PLAN_EXPIRED", "message": "Plan expired; submit it again.", "field": None}}


def test_status_is_scoped_and_throttled_60_per_ip(client):
    assert TruckRouteView.throttle_scope == "truck_route"
    assert TruckRouteView.throttle_classes == [TruckRouteThrottle]
    assert TruckRouteThrottle.THROTTLE_RATES["truck_route"] == "60/min"
    for _ in range(60):
        assert client.get("/api/plans/p_unknown/truck-route").status_code == 404
    response = client.get("/api/plans/p_unknown/truck-route")
    assert response.status_code == 429 and response.json()["error"]["code"] == "THROTTLED"
    assert client.get("/api/plans/p_unknown/truck-route", REMOTE_ADDR="192.0.2.1").status_code == 404


def test_status_after_restart_or_expiry_never_calls_providers(client, inputs):
    # Offline HTTP guard has no registered providers in this test.
    cache.set("plan:v1:p_restarted", {"result": {"providers": {"routing": {
        "name": "osrm", "truck_aware": False, "truck_pending": True, "fallback_reason": "pending"}}},
        "route_digest": service.route_digest(inputs)}, 3600)
    assert status(client, {"plan_id": "p_restarted"}) == {"status": "failed", "retry_after_s": None}
    cache.delete("plan:v1:p_restarted")
    assert client.get("/api/plans/p_restarted/truck-route").status_code == 404


def test_open_breaker_falls_back_immediately_without_job(client, plan_request, replay):
    cache.set("circuit:tomtom:open", True, 60)
    plan = post(client, plan_request)
    assert plan["providers"]["routing"]["fallback_reason"] == "error"
    assert status(client, plan)["status"] == "failed"
    assert service._truck_jobs == {}


def test_tomtom_job_failures_still_open_circuit(inputs, offline, replay):
    mock = offline.get(url__startswith=TOMTOM_URL).mock(return_value=httpx.Response(503))
    for index in range(6):
        varied = dict(inputs, cargo_lb=index * 5000)
        assert service.get_routing(varied).fallback_reason == "error"
    assert mock.call_count == 5  # Sixth digest is rejected by the open breaker.
    assert cache.get("circuit:tomtom:open") is True


def test_legacy_osrm_route_cache_does_not_hide_upgrade(inputs, offline, replay, fixture_json):
    legacy = service.OSRMRouter().routes((41.525, -88.081), (39.739, -104.99),
                                        service.datetime.fromisoformat(inputs["departure_utc"]), 42000)
    digest = service.route_digest(inputs)
    cache.set(f"route:v2:{digest}", legacy, 21600)
    mock = offline.get(url__startswith=TOMTOM_URL).mock(
        return_value=httpx.Response(200, json=fixture_json("tomtom_shape.json")))
    assert service.get_routing(inputs).truck_aware
    assert cache.get(f"route:v2:{digest}").provider == "tomtom"
    assert mock.call_count == 1


def test_legacy_plan_result_cache_does_not_hide_upgrade(
        client, plan_request, inputs, offline, replay, fixture_json):
    digest = hashlib.sha256(json.dumps(inputs, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    cache.set(f"plan-result:v3:{digest}", {"providers": {"routing": {"name": "osrm", "truck_aware": False}}}, 600)
    mock = offline.get(url__startswith=TOMTOM_URL).mock(
        return_value=httpx.Response(200, json=fixture_json("tomtom_shape.json")))
    plan = post(client, plan_request)
    assert plan["providers"]["routing"]["truck_aware"]
    assert mock.call_count == 1 and replay["osrm"].call_count == 0


def test_route_digest_unchanged(inputs):
    coordinates = [round(p[k], 4) for p in (inputs["origin"], inputs["destination"]) for k in ("lat", "lon")]
    signature = [coordinates, service.datetime.fromisoformat(inputs["departure_utc"]).strftime("%Y-%m-%dT%H"), 9, True]
    assert service.route_digest(inputs) == hashlib.sha256(json.dumps(signature).encode()).hexdigest()


def test_both_routers_fail_keeps_http_503(client, plan_request, offline):
    offline.get(url__startswith=TOMTOM_URL).mock(return_value=httpx.Response(503))
    offline.get(url__startswith="https://router.project-osrm.org").mock(return_value=httpx.Response(403))
    response = client.post("/api/plans", plan_request, format="json")
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "PROVIDER_UNAVAILABLE"


def test_pending_with_osrm_failure_does_not_cancel_truck_job(inputs, offline, blocked_truck):
    mock, started, release = blocked_truck
    offline.get(url__startswith="https://router.project-osrm.org").mock(return_value=httpx.Response(403))
    with pytest.raises(ProviderError):
        service.get_routing(inputs)
    assert started.wait(5)
    digest = service.route_digest(inputs)
    with service._truck_jobs_lock:
        future = service._truck_jobs[digest]
    assert not future.cancelled() and not future.done()
    release.set()
    finish(future)
    assert service.get_routing(inputs).truck_aware and mock.call_count == 1
