Live recordings from 2026-10-15:

- `osrm.json`: one OSRM request, Joliet → Denver, full geometry/annotations/steps.
- `openmeteo.json` and `openmeteo_request.json`: one GET for 82 res-5 cell centres, eight days, mph/inches/GMT.
- `smoke_plan.json` and `smoke_summary.txt`: the real resulting plan and timings.
- `photon_live_error.json`: the single Photon call returned HTTP 403. There is no successful live Photon fixture.

`photon_shape.json`, `tomtom_shape.json`, and `geocode_tomtom_shape.json` are **synthetic documented-shape fixtures**, not live recordings. No TomTom account key was available. TomTom fields and units were checked on 2026-10-15 against the official [Routing v1](https://docs.tomtom.com/routing-api/documentation/tomtom-maps/v1/calculate-route), [Guidance](https://docs.tomtom.com/routing-api/documentation/tomtom-maps/v1/guidance-instructions), and [Fuzzy Search](https://docs.tomtom.com/search-api/documentation/search-service/fuzzy-search) documentation.

Offline API replay moves recorded hourly timestamps to the test day's UTC midnight. Values remain unchanged. Tests never call external services; respx rejects every unregistered request.

`nws_alerts_shape.json` is a synthetic NWS GeoJSON shape fixture, not a live recording.
It covers multi-state land UGC codes, duplicate alert IDs, excluded marine/territory codes,
unrelated events and Test/Moderate alerts. NWS format/User-Agent reference:
[official API documentation](https://www.weather.gov/documentation/services-web-api).
Hotspot weather replay builds synthetic hourly Open-Meteo-shaped arrays in `test_hotspot.py`.

2026-10-16 offline enrichment: every checkpoint in `smoke_plan.json` now includes
`place` and `place_label`, computed by `checkpoint_places` using its recorded
coordinates, the normalized roads from `osrm.json`, and geonamescache 3.0.2's
default cities15000 US/Canada data. `planner/api/plan_example.json` is the same
enriched plan with only the first three checkpoints per route. No historical
weather or timings were re-fetched or changed. A reproducibility test recomputes
all place fields from these sources. Place names: GeoNames (CC BY 4.0).

2026-10-17 offline enrichment: `smoke_plan.json` and the abridged documentation
example now also include `clears_in_h` and `clears_at_utc`, recomputed by
`python manage.py refresh_clearance_examples` using the exact H3 cells in
`openmeteo_request.json`, the saved `openmeteo.json` series, recorded final ETAs,
cargo and wind measure. Nine recorded checkpoints are Severe/No Travel. Existing
weather, timings and classifications remain historical. A reproducibility test
recomputes both new fields at every recorded checkpoint. `hotspot_example.json`
illustrates synthetic 2026-10-17 wind/rain/snow showcases and NWS responses,
not a live report. The verified-showcase follow-up recomputes catalogue endpoints
and peak-aligned departures offline; its `verified` mileage is explicitly synthetic
example evidence, not measured routing output. `test_hotspot_verification.py` creates
synthetic TomTom/Open-Meteo HTTP shapes via respx to exercise the real plan pipeline,
its budget, route cache, exposure thresholds, fallback and deadlines.
