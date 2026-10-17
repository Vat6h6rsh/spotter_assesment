from dataclasses import asdict
from hashlib import sha256

from django.conf import settings

from planner.providers.base import ProviderError
from planner.providers.geocode_openmeteo import OpenMeteoGeocoder
from planner.providers.geocode_photon import PhotonGeocoder
from planner.providers.geocode_tomtom import TomTomGeocoder
from planner.providers.resilience import singleflight


def geocode(query: str, limit: int) -> dict:
    normalised = " ".join(query.split()).casefold()
    key = f"geo:v2:{sha256(normalised.encode()).hexdigest()}:{limit}"

    def compute() -> dict:
        if settings.TOMTOM_API_KEY:
            try:
                return {"results": [asdict(p) for p in TomTomGeocoder().search(normalised, limit)]}
            except ProviderError:
                pass
        # Keyless chain: Open-Meteo (fast, place names) then Photon (addresses, but rate-limited and flaky).
        try:
            places = OpenMeteoGeocoder().search(normalised, limit)
            if places:
                return {"results": [asdict(p) for p in places]}
        except ProviderError:
            pass
        return {"results": [asdict(p) for p in PhotonGeocoder().search(normalised, limit)]}

    return singleflight(key, 7 * 86400, compute)
