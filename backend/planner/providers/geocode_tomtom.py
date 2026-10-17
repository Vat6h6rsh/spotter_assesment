"""Predictive address/place search, not the category-query autocomplete endpoint.

https://docs.tomtom.com/search-api/documentation/search-service/fuzzy-search
"""
from urllib.parse import quote

from django.conf import settings
from tzfpy import get_tz

from .base import Place, ProviderError
from .resilience import get_json


class TomTomGeocoder:
    def search(self, query: str, limit: int) -> list[Place]:
        data = get_json("geocode_tomtom", f"https://api.tomtom.com/search/2/search/{quote(query, safe='')}.json", {
            "key": settings.TOMTOM_API_KEY, "countrySet": "US,CA", "limit": limit, "typeahead": "true",
        })
        try:
            results: list[Place] = []
            for item in data["results"]:
                address, position = item["address"], item["position"]
                if address.get("countryCode") not in {"US", "CA"}:
                    continue
                lat, lon = position["lat"], position["lon"]
                results.append(Place(str(item["id"]), address["freeformAddress"], lat, lon, get_tz(lon, lat)))
            return results[:limit]
        except (KeyError, TypeError, ValueError) as exc:
            raise ProviderError("TomTom search returned an invalid response") from exc
