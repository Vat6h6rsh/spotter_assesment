# Weather routing backend v0.5

From `backend/` on Windows:

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt   # prod deploys use requirements.txt
Copy-Item .env.example .env
.\.venv\Scripts\python.exe manage.py collectstatic --noinput
.\.venv\Scripts\python.exe manage.py check
.\.venv\Scripts\python.exe -m pytest -q
.\.venv\Scripts\python.exe manage.py runserver 8000
```

No migrations or database setup are required. Environment variables (see `.env.example`): `TOMTOM_API_KEY`, `OPEN_METEO_API_KEY` (optional), `DJANGO_SECRET_KEY`, `DEBUG`, `ALLOWED_HOSTS`, `CORS_ALLOWED_ORIGINS`, `REDIS_URL` (optional shared cache), `WEATHER_DAILY_BUDGET`, `PORT`. Blank optional `.env` entries retain their defaults. Set a stable `DJANGO_SECRET_KEY` for deployment; an absent key is generated randomly per process. `DEBUG` defaults to false. Vite at `http://localhost:5173` is allowed by default.

API documentation: open [Swagger UI](http://localhost:8000/api/docs/) at `/api/docs/` or [Redoc](http://localhost:8000/api/redoc/) at `/api/redoc/`. `/api/` redirects to Swagger UI; the OpenAPI 3 schema is at `/api/schema/` (JSON with `Accept: application/vnd.oai.openapi+json`, YAML by default). Both UIs use local drf-spectacular-sidecar assets; run `collectstatic` after installing/upgrading dependencies for production. Validate documentation with `.\.venv\Scripts\python.exe manage.py spectacular --validate --fail-on-warn --file NUL`. Documentation serializers are separate from runtime validation; fixture-backed drift tests check nested response fields.

Endpoints (no trailing slash): `GET /api/health`, `GET /api/geocode?q=Joliet&limit=5`, `GET /api/weather/hotspot`, `POST /api/plans`, `GET /api/plans/<plan_id>/heatmap`. JSON requests and responses are documented with examples at `/api/docs/`. HTTP errors have `{error: {code, message, field}}`. Clients should request `Accept-Encoding: gzip` and load the heatmap separately.

The optional welcome hotspot scans 30 trips / 300 unique sample points. It returns
the main showcase plus `more` (0–2 additional High-or-worse trips at 43,000 lb),
preferring distinct hazards and otherwise peak locations at least 500 straight-line
miles from all previous picks. The scan allows 20 seconds, with 25-location weather
batches, six workers and the existing 15-second per-batch HTTP timeout. NWS runs
concurrently. Coverage must be at least 80% of catalogue points with complete
48-hour forecasts; missing points never count as Low. Already-cached forecasts
remain usable after the daily budget is exhausted. An unavailable result also
covers calm weather without relevant warnings. Nearby catalogue cities on the same
interstate bracket the peak (target 150–300 sample-path miles each side; shorter
near ends/bends). Departure subtracts the approach at 55 mph from the peak hour,
clamps to now..+72h and rounds up in the origin zone; unreachable peaks leave now.
Every published main/extra trip is verified through the normal cached `create_plan`
pipeline: recommended or fastest must show >=25 High-or-worse miles or any No Travel.
`suggested_trip.verified` records max_level, high_or_worse_mi and route_label. Try at
most three main candidates; all main/extra verification shares a further 30-second
budget after the scan. Failed/unverified extras are omitted; no verified main gives
available:false. Both branches, including verification evidence, cache for one hour
under hotspot:v3. Plan-result caching remains 10 minutes, so a later replan may
reflect newer weather. In-flight provider work can finish caching after a deadline.

Warm the cache before the first welcome request with:

```powershell
.\.venv\Scripts\python.exe manage.py warm_hotspot
```

This makes live provider calls only on a result-cache miss and prints the JSON.
With shared Redis, run `python manage.py warm_hotspot` on boot or from a scheduled
job using the same `REDIS_URL`. A separate boot command cannot populate gunicorn's
process-local LocMem cache. For the default single-process LocMem deployment,
have a free external cron service GET `https://<backend-host>/api/weather/hotspot`
after boot and roughly hourly to warm the serving process itself. A free host may
sleep between requests; its platform wake-up time is separate from the scan budget.
Neither method bypasses the shared weather budget, cache TTL or endpoint throttle.

Every checkpoint includes nullable `clears_in_h` and `clears_at_utc`. For Severe
or No Travel, search integer delays 1–48 from its final ETA until the same cell,
cargo and wind measure classify at High or below. Unknown does not qualify; the
search stops at the cached horizon. Other levels and unsuccessful searches give
two nulls. Only offset 0 computes this, without extra API calls; it does not promise
that the weather stays clear. Recorded examples can be recomputed offline using
`python manage.py refresh_clearance_examples`.

TomTom is used when `TOMTOM_API_KEY` is set; failures fall back to OSRM with the warning **car routing: truck restrictions not applied**. Geocoding falls back through Open-Meteo geocoding then Photon and filters results to US/Canada. Open-Meteo needs no key; `OPEN_METEO_API_KEY` selects its commercial endpoint. No keys are checked into this package. Routing/search fields were verified against current official [TomTom Routing v1](https://docs.tomtom.com/routing-api/documentation/tomtom-maps/v1/calculate-route), [Guidance](https://docs.tomtom.com/routing-api/documentation/tomtom-maps/v1/guidance-instructions), and [Fuzzy Search](https://docs.tomtom.com/search-api/documentation/search-service/fuzzy-search) docs on 2026-10-15.

`python manage.py smoke_plan` runs one live Joliet → Denver plan and prints route labels, exposure, verdict, timing and payload size. `--record-fixtures` also records responses and attempts geocoding unless its recorded failure exists. The initial authorized calls are already complete; tests replay fixtures and never use the network. See [the captured smoke output](planner/tests/fixtures/smoke_summary.txt) and [fixture provenance](planner/tests/fixtures/README.md).

Checkpoint `place` and `place_label` fields are computed offline, with no extra API calls.
Roads come from TomTom instructions or OSRM steps, mapped to the checkpoint distance
coordinate and looked up by bisect. Place names: GeoNames (CC BY 4.0).
[GeoNames](https://www.geonames.org/) data is bundled by
[geonamescache](https://github.com/yaph/geonamescache) (MIT code); see the
[CC BY 4.0 license](https://creativecommons.org/licenses/by/4.0/).
The lazy, process-local H3 res-3 index includes 3,914 US/Canada places from the pinned
default cities15000 dataset. Canadian numeric admin codes are converted to postal
abbreviations. No lower-population dataset is loaded or downloaded separately.

`place` always contains nullable `road`, `town`, `state`, `distance_mi` (one decimal)
and `direction` (eight-point bearing from town to checkpoint). `place_label` prefixes
the road when available, then uses `in Town, ST` at ≤3 mi, `N mi DIR of Town, ST`
at ≤60 mi, or `between A and B, ST` when preceding/following route-order towns
are each ≤120 mi away. Otherwise it uses `N mi from Town, ST`; absent place data
falls back to `Mile N`. Thresholds use unrounded distances, and label miles round
to the nearest integer (half up). Distances are straight-line, not driving miles;
`in` is a proximity description, not a municipal-boundary test. Neighbour order
comes from town encounters in the checkpoint list, so checkpoint spacing limits
that context. Cross-state pairs include both abbreviations. For `between`, the
structured object still describes the single nearest town. Smaller rural towns
may be missing, so a distant known town is intentional rather than an invented name.

On 2026-10-16 the micro-benchmark measured 153.7 ms to build the index and 0.076 ms
mean lookup time. Only US/Canada JSON records are decoded from the package's
world file; a parity test checks every retained town against `get_cities()`.
H3 neighbours seed the search, then a spherical-cap bound checks other buckets
to retain exact nearest-town results at cell boundaries and in sparse regions.
The smoke command now prints five checkpoint descriptions across its live route.
The root contract and defence-note amendments are prepared in
[the backend handoff](docs/checkpoint-place-labels-handoff.md), since this brief
restricts edits to `backend/`.

Implementation choices where the spec leaves details open:

- US/Canada input bounding rectangle: latitude 18–84, longitude −180 to −50 (includes Hawaii/Alaska; a rectangle is not a country polygon).
- Nearest-hour ties at `:30` round forward. Rain/snow use the ceiling hour. Missing input stays Unknown; all-Unknown averages are `null`, and recommendations are tentative.
- A checkpoint exactly at a rest is the arrival before that rest; no roadside rest is inserted after reaching the destination. `auto` models only 8-hour breaks and 11-hour driving resets; the 14-hour on-duty window is excluded.
- DST gaps and ambiguous departure wall times return a field validation error. Times elsewhere in the response are UTC plus IANA zones.
- Near-duplicate routes use length-weighted 1 km samples with a 40 m shared-road tolerance. Display geometry uses 80 m Douglas–Peucker simplification. Progress uses exact checkpoint and rest knots; classification uses full geometry and provider timing.
- Weather budget counts location forecasts, not HTTP batches. Cells are cached for 60 minutes; exhausted or failed cells remain Unknown. Heatmap weather warnings use the CORS-exposed `X-Weather-Warnings` response header (a JSON array), preserving the specified response body fields.
- Cache TTLs: results 10 minutes, plans/heatmaps 1 hour, routes 6 hours, geocoding 7 days. Route keys round endpoints to four decimals and cargo into 5,000 lb buckets as specified. Truck classification always uses the exact entered cargo; the routing request uses the exact cargo plus 35,000 lb converted to kg.

Docker uses Python 3.13 and gunicorn: `docker build -t weather-backend .`, then `docker run --rm -p 8000:8000 --env-file .env weather-backend`. `PORT` controls the bind port. The default is one worker with four threads so LocMem budgets/plans stay in one process. Set `REDIS_URL` before adding workers. Deployment itself is out of scope.

Live verification on 2026-10-15 returned two distinct routes, 100% forecast coverage, recommended A, 4.332 s cold server time and 10,373 bytes gzipped at 25-mile spacing. Photon rejected its one permitted call with HTTP 403, so a successful live Photon fixture remains unavailable. TomTom is tested against documented shapes; live account verification awaits a key.
