"""Documentation-only serializers. Views never use these to transform responses."""
from rest_framework import serializers as s


class Place(s.Serializer):
    label = s.CharField(max_length=250, help_text="Display name; required, no default.")
    lat = s.FloatField(min_value=18, max_value=84, help_text="Latitude in degrees, 18–84; required, no default. US/Canada bounding rectangle.")
    lon = s.FloatField(min_value=-180, max_value=-50, help_text="Longitude in degrees, −180 to −50; required, no default. Rectangle is not a country polygon.")


class RestPolicy(s.Serializer):
    mode = s.ChoiceField(choices=("auto", "none", "custom"), help_text="Required within rest; omitted rest defaults to {mode: auto}. Auto: 30 min after 8 h driving, 10 h after 11 h; none: no rests; custom: repeating intervals. Excludes 14 h on-duty window.")
    drive_hours = s.FloatField(min_value=1, max_value=11, required=False, help_text="Required only for custom: drive 1–11 hours before each rest; no default. Ignored and removed for other modes.")
    rest_hours = s.FloatField(min_value=0.5, max_value=34, required=False, help_text="Required only for custom: rest 0.5–34 hours; no default. Ignored and removed for other modes.")


class PlanRequest(s.Serializer):
    origin = Place(help_text="Starting place; must differ from destination. Required, no default.")
    destination = Place(help_text="Ending place; must differ from origin. Required, no default.")
    departure_local = s.CharField(max_length=30, help_text="Required, no default. YYYY-MM-DDTHH:MM[:SS] wall time in the origin's time zone (resolved from coordinates), without offset. Inclusive now −1 h to +72 h; ambiguous/nonexistent DST times rejected.")
    cargo_lb = s.FloatField(min_value=0, max_value=80000, help_text="Cargo weight in lb, inclusive 0–80,000; required, no default. Classification uses exact cargo; truck routing adds 35,000 lb tractor/trailer weight.")
    spacing_mi = s.ChoiceField(choices=(10, 25, 50), default=25, help_text="Road-distance checkpoint interval in miles: 10, 25 or 50; default 25.")
    wind_measure = s.ChoiceField(choices=("gust", "sustained"), default="gust", help_text="Default gust classifies max(gust, sustained); sustained uses sustained only. Both wind values are returned.")
    weather_slowdown = s.BooleanField(default=True, help_text="Default true: slow each checkpoint's stretch using FHWA freeway speed reductions (light rain/snow -8%, heavy rain -10%, heavy snow -22%), iterated until ETAs settle. False: TomTom traffic time only.")
    rest = RestPolicy(default={"mode": "auto"}, help_text="Rest policy; default {mode: auto}. ETAs include rests.")


class PlanInputs(PlanRequest):
    spacing_mi = s.ChoiceField(choices=(10, 25, 50), help_text="Normalized checkpoint interval in miles, including default 25 when omitted from request.")
    wind_measure = s.ChoiceField(choices=("gust", "sustained"), help_text="Normalized wind measure, including default gust when omitted from request.")
    weather_slowdown = s.BooleanField(help_text="Normalized weather-slowdown flag (default true).")
    rest = RestPolicy(help_text="Normalized rest policy; auto/none include only mode, custom also includes both intervals.")
    departure_utc = s.DateTimeField(help_text="Resolved departure instant in UTC, ending in Z.")
    origin_tz = s.CharField(help_text="Origin IANA time zone resolved from its coordinates.")


class WeatherBudget(s.Serializer):
    used_today = s.IntegerField(help_text="Location forecasts consumed today (UTC), not HTTP batch count.")
    limit = s.IntegerField(help_text="Configured daily location forecast budget; default 9000.")


class Health(s.Serializer):
    status = s.ChoiceField(choices=("ok",), help_text="Service process status; does not probe upstream availability.")
    version = s.CharField(help_text="API version, currently 0.5.0.")
    routing = s.ChoiceField(choices=("tomtom", "osrm"), help_text="Configured primary router; an individual plan may use fallback.")
    weather = s.ChoiceField(choices=("open-meteo",), help_text="Weather forecast provider.")
    weather_budget = WeatherBudget(help_text="Today's weather location budget usage.")


class GeocodePlace(Place):
    id = s.CharField(help_text="Opaque provider-prefixed place identifier.")
    # Search results are country-filtered, unlike the request bounding rectangle.
    lat = s.FloatField(help_text="Matched latitude in degrees.")
    lon = s.FloatField(help_text="Matched longitude in degrees.")
    tz = s.CharField(help_text="Matched place's IANA time zone.")


class GeocodeResult(s.Serializer):
    results = GeocodePlace(many=True, help_text="US/Canada matches in provider relevance order; may be empty.")


class RoutingProvider(s.Serializer):
    name = s.ChoiceField(choices=("tomtom", "osrm"), help_text="Actual routing provider used for this plan.")
    truck_aware = s.BooleanField(help_text="True for TomTom truck routing; false for OSRM car routing without truck restrictions.")
    truck_pending = s.BooleanField(help_text="True while TomTom continues in the background; poll the plan's truck-route endpoint and re-POST identical inputs when ready.")
    fallback_reason = s.ChoiceField(choices=("no_key", "pending", "timeout", "error"), allow_null=True, help_text="Null for truck-aware routing; otherwise no_key, pending, timeout or error explains the OSRM fallback.")


class TruckRouteStatus(s.Serializer):
    status = s.ChoiceField(choices=("pending", "ready", "failed", "not_applicable"), help_text="Pending: local job running; ready: truck result cached, re-POST the same trip; failed: marker or no surviving job; not_applicable: plan already truck-aware or no key.")
    retry_after_s = s.IntegerField(allow_null=True, min_value=1, help_text="3 seconds while pending; null for every other status. No provider calls are made by this endpoint.")


class WeatherProvider(s.Serializer):
    name = s.ChoiceField(choices=("open-meteo",), help_text="Forecast provider name.")
    fetched_at = s.DateTimeField(help_text="Oldest successful cell fetch time in UTC; current time if no weather was available.")


class Providers(s.Serializer):
    routing = RoutingProvider(help_text="Routing source, truck-awareness, pending flag and fallback reason; all four keys are always present.")
    weather = WeatherProvider(help_text="Weather source and freshness.")


class Warning(s.Serializer):
    code = s.CharField(help_text="Machine-readable warning, e.g. CAR_ROUTING, FEWER_ROUTES, MISSING_WEATHER or WEATHER_BUDGET.")
    message = s.CharField(help_text="Human-readable degradation explanation.")


class DepartureAdvice(s.Serializer):
    offset_h = s.ChoiceField(choices=(3, 6, 12, 24), help_text="Suggested delay from requested departure in hours.")
    route_id = s.CharField(help_text="Route to use at the suggested departure.")
    summary = s.CharField(help_text="Explanation naming the first improved risk/time sort key.")


class Recommendation(s.Serializer):
    status = s.ChoiceField(choices=("recommended", "tentative", "none_eligible"), help_text="Tentative if any route coverage <95% and a route is eligible; none_eligible if every route has No Travel miles.")
    route_id = s.CharField(allow_null=True, help_text="Chosen route ID, or null when none are eligible.")
    reasons = s.ListField(child=s.CharField(help_text="One deciding comparison."), max_length=3, help_text="Up to three short reasons for the verdict.")
    tradeoff = s.CharField(help_text="Comparison with the fastest route, including elapsed time and relevant exposure.")
    departure_advice = DepartureAdvice(allow_null=True, help_text="Best strictly improving later departure from cached forecasts, otherwise null.")


class MilesByLevel(s.Serializer):
    low = s.FloatField(help_text="Owned miles at level 0 Low.")
    moderate = s.FloatField(help_text="Owned miles at level 1 Moderate.")
    high = s.FloatField(help_text="Owned miles at level 2 High.")
    severe = s.FloatField(help_text="Owned miles at level 3 Severe.")
    no_travel = s.FloatField(help_text="Owned miles at level 4 No Travel; any positive value makes route ineligible.")
    unknown = s.FloatField(help_text="Owned miles with unavailable required weather, never counted as Low.")


class Risk(s.Serializer):
    miles_by_level = MilesByLevel(help_text="Checkpoint-owned miles, totaling route length.")
    avg_risk = s.FloatField(allow_null=True, min_value=0, max_value=4, help_text="Mile-weighted mean over known miles only; null when all miles are Unknown.")
    coverage = s.FloatField(min_value=0, max_value=1, help_text="Known miles divided by route distance.")
    max_level = s.IntegerField(allow_null=True, min_value=0, max_value=4, help_text="Highest known checkpoint level, or null if all Unknown.")


class Rest(s.Serializer):
    at_mi = s.FloatField(help_text="Road distance from origin at the rest stop, miles.")
    start_utc = s.DateTimeField(help_text="Rest start instant in UTC.")
    duration_s = s.FloatField(help_text="Rest duration in seconds.")
    kind = s.ChoiceField(choices=("break30", "rest10h", "custom"), help_text="30-minute break, 10-hour rest or user-defined interval.")
    lat = s.FloatField(help_text="Rest marker latitude in degrees.")
    lon = s.FloatField(help_text="Rest marker longitude in degrees.")


class CheckpointPlace(s.Serializer):
    road = s.CharField(allow_null=True, help_text="Normalized provider road reference, else street name; null when unknown.")
    town = s.CharField(allow_null=True, help_text="Nearest US/Canada town in the offline GeoNames cities15000 dataset; null if unavailable.")
    state = s.CharField(allow_null=True, help_text="Town's US state or Canadian province/territory abbreviation; null if unavailable.")
    distance_mi = s.FloatField(allow_null=True, help_text="Straight-line distance from checkpoint to nearest town, miles rounded to one decimal; null if unavailable.")
    direction = s.ChoiceField(choices=("N", "NE", "E", "SE", "S", "SW", "W", "NW"), allow_null=True, help_text="Eight-point compass bearing from town to checkpoint; null if unavailable.")


class Checkpoint(s.Serializer):
    i = s.IntegerField(help_text="Zero-based checkpoint index along this route.")
    mi = s.FloatField(help_text="Road distance from origin in miles.")
    lat = s.FloatField(help_text="Checkpoint latitude on the route; weather samples its H3 res-5 cell center.")
    lon = s.FloatField(help_text="Checkpoint longitude on the route.")
    place = CheckpointPlace(help_text="Offline road and nearest-town context; all five keys are always present.")
    place_label = s.CharField(help_text="Road plus place description: in town at ≤3 mi, distance/direction at ≤60 mi, between route-order neighbours each ≤120 mi, otherwise distance from nearest town. Falls back to Mile N.")
    eta_utc = s.DateTimeField(help_text="Arrival instant including prior rests; at an exact rest location, arrival precedes that rest.")
    tz = s.CharField(help_text="Checkpoint IANA time zone.")
    elapsed_s = s.FloatField(help_text="Wall-clock seconds since departure including prior rests.")
    level = s.IntegerField(min_value=0, max_value=4, allow_null=True, help_text="Maximum adjusted wind/rain/snow level 0–4; null = Unknown.")
    clears_in_h = s.IntegerField(min_value=1, max_value=48, allow_null=True, help_text="For Severe/No Travel only: smallest whole-hour delay 1–48 from final ETA with known risk <= High in the same cell, cargo and wind measure; null if not found in cached forecast horizon or not Severe/No Travel.")
    clears_at_utc = s.DateTimeField(allow_null=True, help_text="ETA plus clears_in_h hours in UTC, preserving ETA minutes/seconds; null when clears_in_h is null. Does not promise sustained clearing or replan the route.")
    wind_mph = s.FloatField(allow_null=True, help_text="Sustained 10 m wind in mph at nearest forecast hour; null if unavailable.")
    gust_mph = s.FloatField(allow_null=True, help_text="10 m gust in mph at nearest forecast hour; null if unavailable.")
    rain_in = s.FloatField(allow_null=True, help_text="Rain + showers, in/hr, from ceiling forecast hour; null if unavailable.")
    snow_in = s.FloatField(allow_null=True, help_text="Snowfall depth in/hr from ceiling forecast hour; null if unavailable.")
    base_wind_level = s.IntegerField(min_value=0, max_value=4, allow_null=True, help_text="Wind class before cargo rule; null when required weather is unavailable.")
    load_adjusted = s.BooleanField(help_text="True when cargo rule increased the base wind class.")
    drivers = s.ListField(child=s.ChoiceField(choices=("wind", "rain", "snow"), help_text="Tied risk factor."), help_text="All factors tied at maximum, at Moderate or above; empty for Low/Unknown.")
    rule = s.CharField(help_text="Human-readable deciding rule or Unknown explanation.")
    forecast_hour_utc = s.DateTimeField(allow_null=True, help_text="Nearest wind forecast hour in UTC; null if unavailable. Precipitation uses ceiling hour separately.")
    beyond_horizon = s.BooleanField(help_text="True if ETA lies outside fetched forecast horizon.")
    speed_factor = s.FloatField(min_value=0, max_value=1, help_text="Fraction of normal speed applied to this checkpoint's owned stretch (1.0 = no weather slowdown).")
    slowdown = s.CharField(allow_null=True, help_text="Human label for the applied slowdown, e.g. \"Heavy snow −22%\"; null when none.")


class Route(s.Serializer):
    id = s.CharField(help_text="Provider-order identifier A, B or C; A is primary.")
    label = s.CharField(help_text="Main road names, or Route A/B/C when unavailable.")
    rank = s.IntegerField(min_value=1, help_text="One-based recommendation order; 1 is best or least exposure.")
    eligible = s.BooleanField(help_text="True exactly when No Travel miles are zero; Unknown does not guarantee safety.")
    is_fastest = s.BooleanField(help_text="True for lowest elapsed time, breaking ties by provider index.")
    polyline = s.CharField(help_text="Encoded polyline, precision 5, simplified for display.")
    bbox = s.ListField(child=s.FloatField(help_text="Bounding coordinate in degrees."), min_length=4, max_length=4, help_text="[west longitude, south latitude, east longitude, north latitude].")
    distance_mi = s.FloatField(help_text="Route road length in miles.")
    drive_s = s.FloatField(help_text="Driving seconds excluding rests: provider traffic time plus weather_delay_s.")
    weather_delay_s = s.FloatField(help_text="Extra driving seconds from weather slowdowns (0 when disabled or dry).")
    rest_s = s.FloatField(help_text="Total scheduled rest seconds.")
    total_s = s.FloatField(help_text="Elapsed trip seconds = drive_s + rest_s.")
    arrival_utc = s.DateTimeField(help_text="Destination arrival in UTC including rests.")
    arrival_tz = s.CharField(help_text="Destination IANA time zone.")
    risk = Risk(help_text="Mile-weighted exposure and weather coverage.")
    rests = Rest(many=True, help_text="Scheduled stops in route order; empty for none mode.")
    progress = s.ListField(child=s.ListField(child=s.FloatField(help_text="Seconds or miles according to position."), min_length=2, max_length=2, help_text="[elapsed_s, road_mi] knot."), help_text="Piecewise-linear [elapsed_s, mi] pairs including flat rest plateaus; interpolate to place the truck.")
    checkpoints = Checkpoint(many=True, help_text="Origin, spaced road-distance samples and destination, in route order.")


class PlanResponse(s.Serializer):
    plan_id = s.CharField(help_text="Opaque p_-prefixed identifier; cached plan lifetime is one hour.")
    created_at = s.DateTimeField(help_text="Plan creation instant in UTC; unchanged on cached re-submission.")
    inputs = PlanInputs(help_text="Validated, normalized request plus resolved UTC departure and origin time zone.")
    providers = Providers(help_text="Actual routing and weather sources.")
    warnings = Warning(many=True, help_text="Degradation warnings; may be empty.")
    recommendation = Recommendation(help_text="Risk-first route verdict and optional later departure advice.")
    routes = Route(many=True, help_text="Up to three distinct routes in provider ID order; use rank to sort by recommendation.")


class HeatmapResponse(s.Serializer):
    plan_id = s.CharField(help_text="Identifier of the cached plan.")
    res = s.ChoiceField(choices=(3, 4), help_text="H3 resolution: normally 4, reduced to 3 for corridor size or weather budget.")
    base_utc = s.DateTimeField(help_text="Departure rounded down to UTC hour, the time of slice zero.")
    hours = s.IntegerField(help_text="Number of hourly slices; currently 49 (offsets 0–48 h).")
    cells = s.ListField(child=s.CharField(help_text="H3 cell ID."), help_text="Ordered H3 cells shared by every hourly slice.")
    levels_b64 = s.CharField(help_text="Base64 unsigned bytes, hours*cells.length, hour-major index h*cells.length+c; 0–4 risk, 255 Unknown. See description for JS decoding.")
    fetched_at = s.DateTimeField(help_text="Oldest successful cell forecast fetch UTC time; current time if none available.")


class ErrorDetail(s.Serializer):
    code = s.CharField(help_text="Machine error code, e.g. VALIDATION_ERROR, PLAN_EXPIRED, THROTTLED, PROVIDER_UNAVAILABLE.")
    message = s.CharField(help_text="Human-readable explanation.")
    field = s.CharField(allow_null=True, help_text="Dotted invalid field path or null; DRF throttling may use detail.")


class Error(s.Serializer):
    error = ErrorDetail(help_text="Shared HTTP error envelope.")


class HotspotEndpoint(Place):
    tz = s.CharField(help_text="Endpoint's IANA time zone; departure_local uses the origin zone.")


class HotspotPeak(s.Serializer):
    place = s.CharField(help_text="Catalogue city and US state abbreviation, near the forecast cell.")
    lat = s.FloatField(help_text="Catalogue sample latitude; forecasts use the H3 res-5 cell centre.")
    lon = s.FloatField(help_text="Catalogue sample longitude.")
    gust_mph = s.FloatField(help_text="Maximum 10 m gust in the 48-hour window, mph.")
    wind_mph = s.FloatField(help_text="Maximum sustained 10 m wind in the window, mph.")
    rain_in = s.FloatField(help_text="Maximum hourly rain + showers in the window, in/hr.")
    snow_in = s.FloatField(help_text="Maximum hourly snowfall in the window, in/hr.")
    at_utc = s.DateTimeField(help_text="Worst actual forecast hour by severity then exceedance; independent maxima can occur at different hours.")
    level_for_cargo = s.IntegerField(min_value=0, max_value=4, allow_null=True, help_text="Worst actual hour classified with gust measure and cargo 43000 lb; only complete 48-hour points participate, with at least 80% catalogue coverage required.")
    cargo_lb = s.IntegerField(help_text="Classification cargo in lb, always 43000.")


class HotspotAlert(s.Serializer):
    event = s.CharField(help_text="NWS event name; Severe/Extreme Actual alerts in contiguous US states.")
    count = s.IntegerField(min_value=1, help_text="Number of distinct alert features for this event, not county count.")
    states = s.ListField(child=s.CharField(help_text="US state postal abbreviation from a land UGC code."), help_text="Sorted unique states; excludes marine zones, Alaska, Hawaii and territories.")


class HotspotVerified(s.Serializer):
    max_level = s.IntegerField(min_value=2, max_value=4, help_text="Highest level with positive owned miles on the qualifying recommended or fastest route.")
    high_or_worse_mi = s.FloatField(min_value=0, help_text="Sum of High + Severe + No Travel owned miles on that route; >=25 unless any No Travel miles qualify it.")
    route_label = s.CharField(help_text="Qualifying real plan route's provider-derived label.")


class HotspotTrip(s.Serializer):
    origin = HotspotEndpoint(help_text="Corridor sample city before the peak, including its time zone; target 150–300 sample-path miles, shorter near an end/bend.")
    destination = HotspotEndpoint(help_text="Corridor sample city after the peak, including its time zone; target 150–300 sample-path miles, shorter near an end/bend.")
    cargo_lb = s.IntegerField(help_text="Suggested cargo in lb, always 43000.")
    departure_local = s.CharField(help_text="Origin-local wall time: peak UTC minus sample-path approach at 55 mph, clamped to now..+72h and rounded up to a whole hour (down at the upper bound). Unreachable peaks depart now with second precision. Repeated DST hours are skipped. Real plan exposure is verified.")
    corridor = s.CharField(help_text="Interstate corridor name, e.g. I-10.")
    why = s.CharField(help_text="Plain-language explanation naming the corridor and hazard zone.")
    verified = HotspotVerified(help_text="Evidence from the cached create_plan pipeline with default gust, 25-mi spacing, auto rests and weather slowdown; recommended or fastest has >=25 High-or-worse miles or any No Travel. Cached with the hotspot for 60 min.")


class HotspotSources(s.Serializer):
    forecast = s.CharField(help_text="Forecast attribution: Open-Meteo.")
    alerts = s.CharField(help_text="Alert attribution: NWS api.weather.gov; an outage is disclosed in summary.")


class HotspotShowcase(s.Serializer):
    hazard = s.ChoiceField(choices=('wind', 'rain', 'snow', 'mixed'), help_text="Worst-hour risk driver; mixed for ties.")
    headline = s.CharField(help_text="Plain-language hazard, corridor and region.")
    summary = s.CharField(help_text="Peak value, location, cargo impact and relevant alert count.")
    peak = HotspotPeak(help_text="Worst complete sampled point and its independent 48-hour maxima.")
    suggested_trip = HotspotTrip(help_text="Additional distinct catalogue trip with forecast level >= High for 43000 lb.")


class HotspotAvailable(s.Serializer):
    available = s.BooleanField(help_text="True when a notable weather demonstration is available.")
    generated_at = s.DateTimeField(help_text="Scan generation UTC instant, ending in Z; result cached for 60 minutes.")
    window_hours = s.IntegerField(help_text="48 hourly bins, starting with the generation time's current UTC hour.")
    headline = s.CharField(help_text="Plain-language hazard, corridor and region; catalogue samples cannot prove a nationwide maximum.")
    summary = s.CharField(help_text="One sentence with peak value, location, cargo impact and nationwide relevant alert count (or NWS unavailable).")
    hazard = s.ChoiceField(choices=('wind', 'rain', 'snow', 'mixed'), help_text="Worst-hour risk driver, mixed for ties; alert hazard when forecasts are below High.")
    peak = HotspotPeak(help_text="Worst sampled point and its independent 48-hour weather maxima.")
    alerts = HotspotAlert(many=True, help_text="Severe/Extreme Actual NWS alerts grouped by event; empty if NWS fails.")
    suggested_trip = HotspotTrip(help_text="Verified corridor trip for the welcome popup to autofill; POST /api/plans reuses the normal plan cache.")
    sources = HotspotSources(help_text="Provider attribution.")
    more = HotspotShowcase(many=True, max_length=2, help_text="Up to two verified next-worst distinct trips rated >= High. Prefer new hazards; otherwise peaks >=500 straight-line miles apart. Main tries at most three candidates; all verification shares 30 seconds after the 20-second scan. Unverified/late extras are dropped. May be empty.")


class HotspotUnavailable(s.Serializer):
    available = s.BooleanField(help_text="False: the popup should remain hidden. This is an HTTP 200 response.")
    reason = s.CharField(help_text="No notable weather, exhausted weather budget, incomplete forecast scan, no qualifying verified trip or provider failure.")
