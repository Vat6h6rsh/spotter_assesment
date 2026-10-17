"""Keyless place-name geocoder (cities and towns, not street addresses). Returns IANA time zones."""
from tzfpy import get_tz

from .base import Place, ProviderError
from .resilience import get_json

URL = "https://geocoding-api.open-meteo.com/v1/search"
REGIONS = {
    "Alabama": "AL", "Alaska": "AK", "Arizona": "AZ", "Arkansas": "AR", "California": "CA", "Colorado": "CO",
    "Connecticut": "CT", "Delaware": "DE", "District of Columbia": "DC", "Florida": "FL", "Georgia": "GA",
    "Hawaii": "HI", "Idaho": "ID", "Illinois": "IL", "Indiana": "IN", "Iowa": "IA", "Kansas": "KS",
    "Kentucky": "KY", "Louisiana": "LA", "Maine": "ME", "Maryland": "MD", "Massachusetts": "MA",
    "Michigan": "MI", "Minnesota": "MN", "Mississippi": "MS", "Missouri": "MO", "Montana": "MT",
    "Nebraska": "NE", "Nevada": "NV", "New Hampshire": "NH", "New Jersey": "NJ", "New Mexico": "NM",
    "New York": "NY", "North Carolina": "NC", "North Dakota": "ND", "Ohio": "OH", "Oklahoma": "OK",
    "Oregon": "OR", "Pennsylvania": "PA", "Rhode Island": "RI", "South Carolina": "SC", "South Dakota": "SD",
    "Tennessee": "TN", "Texas": "TX", "Utah": "UT", "Vermont": "VT", "Virginia": "VA", "Washington": "WA",
    "West Virginia": "WV", "Wisconsin": "WI", "Wyoming": "WY", "Alberta": "AB", "British Columbia": "BC",
    "Manitoba": "MB", "New Brunswick": "NB", "Newfoundland and Labrador": "NL", "Nova Scotia": "NS",
    "Ontario": "ON", "Prince Edward Island": "PE", "Quebec": "QC", "Saskatchewan": "SK",
}
COUNTRIES = {"US": "USA", "CA": "Canada"}


class OpenMeteoGeocoder:
    def search(self, query: str, limit: int) -> list[Place]:
        name, _, qualifier = (part.strip() for part in query.partition(","))
        data = get_json("openmeteo-geocode", URL, {"name": name, "count": 20, "language": "en", "format": "json"})
        try:
            rows = [r for r in data.get("results", []) if r.get("country_code") in COUNTRIES]
            q = qualifier.casefold()

            def matches(row: dict) -> bool:
                region = row.get("admin1", "")
                return not q or region.casefold().startswith(q) or REGIONS.get(region, "").casefold() == q

            # Qualifier matches first, then larger places (a typeahead favours the city people mean).
            rows.sort(key=lambda r: (not matches(r), -(r.get("population") or 0)))
            places = []
            for r in rows[:limit]:
                region = r.get("admin1", "")
                label = ", ".join(p for p in (r["name"], REGIONS.get(region, region), COUNTRIES[r["country_code"]]) if p)
                places.append(Place(f"openmeteo:{r['id']}", label, float(r["latitude"]), float(r["longitude"]),
                                    r.get("timezone") or get_tz(float(r["longitude"]), float(r["latitude"]))))
            return places
        except (KeyError, TypeError, ValueError) as exc:
            raise ProviderError("Open-Meteo geocoding returned an invalid response") from exc
