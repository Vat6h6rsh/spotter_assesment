from tzfpy import get_tz

from .base import Place, ProviderError
from .resilience import get_json


class PhotonGeocoder:
    def search(self, query: str, limit: int) -> list[Place]:
        data = get_json("photon", "https://photon.komoot.io/api", {"q": query, "limit": max(20, limit), "lang": "en"})
        try:
            results: list[Place] = []
            for feature in data["features"]:
                p = feature["properties"]
                if p.get("countrycode", "").upper() not in {"US", "CA"}:
                    continue
                lon, lat = feature["geometry"]["coordinates"][:2]
                parts = dict.fromkeys(str(p[k]) for k in ("name", "city", "state", "country") if p.get(k))
                results.append(Place(f"photon:{p.get('osm_type', '')}:{p.get('osm_id', '')}", ", ".join(parts), lat, lon, get_tz(lon, lat)))
            return results[:limit]
        except (KeyError, TypeError, ValueError) as exc:
            raise ProviderError("Photon returned an invalid response") from exc
