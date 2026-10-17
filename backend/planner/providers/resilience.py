"""Bounded requests, cache-backed circuit breaker, and shared cache locks."""
import json
import random
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Callable, Iterator, TypeVar
from uuid import uuid4

import httpx
from django.core.cache import cache

from .base import ProviderError

# Public providers (Photon, OSRM, Open-Meteo) require an identifying User-Agent.
USER_AGENT = "spotter-weather-route/0.5 (+https://github.com/; take-home assessment)"
_client = httpx.Client(timeout=httpx.Timeout(6.0, connect=2.0), limits=httpx.Limits(max_connections=12, max_keepalive_connections=8),
                       headers={"User-Agent": USER_AGENT})
_record_dir: Path | None = None
T = TypeVar("T")


def set_record_directory(directory: Path | None) -> None:
    global _record_dir
    _record_dir = directory


@contextmanager
def cache_lock(key: str, ttl: int = 30) -> Iterator[bool]:
    token = uuid4().hex
    acquired = cache.add(key, token, timeout=ttl)
    try:
        yield acquired
    finally:
        if acquired and cache.get(key) == token:
            cache.delete(key)


def singleflight(key: str, ttl: int, compute: Callable[[], T], wait_s: float = 15) -> T:
    deadline = time.monotonic() + wait_s
    while True:
        value = cache.get(key)
        if value is not None:
            return value
        with cache_lock(f"lock:{key}", max(30, int(wait_s) + 5)) as acquired:
            if acquired:
                value = cache.get(key)
                if value is None:
                    value = compute()
                    cache.set(key, value, ttl)
                return value
        if time.monotonic() >= deadline:
            raise ProviderError("Request already in progress; please retry shortly")
        time.sleep(0.025)


def get_json(provider: str, url: str, params: dict[str, str | int | float], timeout: float | None = None) -> dict | list:
    if cache.get(f"circuit:{provider}:open"):
        raise ProviderError(f"{provider} temporarily unavailable")
    last_error: Exception | None = None
    for attempt in range(2):
        try:
            response = _client.get(url, params=params, **({"timeout": httpx.Timeout(timeout, connect=2.0)} if timeout else {}))
            response.raise_for_status()
            data = response.json()
            if not isinstance(data, (dict, list)):
                raise ValueError("Invalid JSON shape")
            cache.delete(f"circuit:{provider}:failures")
            if _record_dir is not None:
                _record_dir.mkdir(parents=True, exist_ok=True)
                # Only response bodies and non-secret location parameters are recorded.
                (_record_dir / f"{provider}.json").write_text(json.dumps(data, separators=(",", ":")), encoding="utf-8")
                if provider == "openmeteo":
                    safe = {k: v for k, v in params.items() if k != "apikey"}
                    (_record_dir / "openmeteo_request.json").write_text(json.dumps(safe), encoding="utf-8")
            return data
        except (httpx.HTTPError, ValueError) as exc:
            last_error = exc
            retryable = not isinstance(exc, httpx.HTTPStatusError) or exc.response.status_code in {408, 429} or exc.response.status_code >= 500
            if not retryable or attempt == 1:
                break
            time.sleep(random.uniform(0.05, 0.15))
    cache.add(f"circuit:{provider}:failures", 0, 300)
    try:
        failures = cache.incr(f"circuit:{provider}:failures")
    except ValueError:
        failures = 1
        cache.set(f"circuit:{provider}:failures", failures, 300)
    if failures >= 5:
        cache.set(f"circuit:{provider}:open", True, 60)
        cache.delete(f"circuit:{provider}:failures")
    raise ProviderError(f"{provider} request failed") from last_error
