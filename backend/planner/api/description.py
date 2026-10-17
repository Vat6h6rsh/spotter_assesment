API_DESCRIPTION = r"""
Plan truck trips across the US and Canada using cargo weight, forecast weather,
driving time and driver-selected rests. Units are miles, seconds, lb, mph and in/hr.
UTC timestamps end in `Z`; IANA time zones support local display. No authentication is required.

Every checkpoint includes `place` (road, town, state, distance_mi, direction; nullable
values) and an always-present `place_label`. Offline labels use the provider's road
and nearest US/Canada town: in town within 3 mi, distance and compass direction
within 60 mi, between route-order town neighbours each within 120 mi, otherwise
distance from the nearest town. Distances are straight-line; small settlements may
be absent from the bundled cities15000 dataset. Missing place data falls back to
`Mile N`. Place names: GeoNames (CC BY 4.0).

## Workflow
The optional **GET /api/weather/hotspot** welcome demonstration scans 30 freight
trips at 300 shared H3 res-5 forecast cells across the contiguous US, using the
current UTC hourly bin and the following 47 bins. It returns a real trip to autofill
when forecast risk reaches High for 43,000 lb cargo or a relevant active NWS warning
exists. Its independent weather maxima may occur at different hours; severity and
peak time describe the worst actual hourly combination. NWS alerts match by state,
not by route/polygon intersection. Nearby sample cities bracket the peak on the same
interstate, targeting 150–300 sample-path miles on each side with shorter legs near
ends/bends. Departure targets the peak at 55 mph, clamped to now..+72h and rounded
up to a whole origin-local hour (down at the upper bound; unreachable peaks leave
now with seconds). Ambiguous DST hours are skipped. The normal cached create_plan
pipeline must verify >=25 High-or-worse miles or any No Travel on the recommended
or fastest route. `suggested_trip.verified` records max_level, high_or_worse_mi and
route_label. At most three main candidates are attempted; main and extra verification
share a further 30-second deadline. Failed/late extras are dropped; no verified main
returns available:false. Cached 60 min
with singleflight, charged to the shared weather budget, limited to 20/min per IP.
`more` includes up to two additional High-or-worse trips, preferring distinct hazards,
then peak locations at least 500 straight-line miles from every selected peak.
The scan has a 20-second budget with 25-location batches, six weather workers and
15-second per-batch HTTP timeouts; NWS runs concurrently. At least 80% of unique
catalogue points must have a complete 48-hour window; missing points are excluded
from ranking. No notable weather or coverage below 80% returns HTTP 200 with
`available: false` and a reason; an NWS outage alone is nonfatal. Cached forecasts
remain usable when the daily budget is exhausted.

1. **GET /api/geocode** to choose origin and destination.
2. **POST /api/plans** for routes, checkpoints and a weather-based recommendation.
3. **GET /api/plans/{plan_id}/heatmap** separately to load the corridor overlay.

## Risk and load rules
Comparisons use `Decimal(str(round(x, 2)))`, with no other rounding before classification.
Wind `w` is `max(gust, sustained)` for `wind_measure=gust` (default), otherwise sustained.
Rain `r` is rain + showers; snow `s` is snowfall depth. All precipitation rates are in/hr.

| Level | Wind w (mph) | Rain r (in/hr) | Snow s (in/hr) |
| --- | --- | --- | --- |
| 0 Low | [0, 25) | r < 0.10 | s < 0.5 |
| 1 Moderate | [25, 35) | 0.10 ≤ r < 0.25 | 0.5 ≤ s < 1.0 |
| 2 High | [35, 45) | 0.25 ≤ r < 0.50 | 1.0 ≤ s < 2.0 |
| 3 Severe | [45, 55) | 0.50 ≤ r ≤ 1.00 | 2.0 ≤ s ≤ 3.0 |
| 4 No Travel | [55, ∞) | r > 1.00 | s > 3.0 |

Load rules use cargo lb and strict `>` comparisons; they only raise risk via `max(base, rule)`:
- w ≥ 55 → No Travel for any load.
- 45 ≤ w < 55 and cargo > 30,000 lb → No Travel.
- 35 ≤ w < 45 and cargo > 40,000 lb → Severe.

Checkpoint level is the maximum of load-adjusted wind, rain and snow. `drivers` names
all factors tied at that maximum at Moderate or above; `rule` explains the decision.
Missing required weather means `null` (**Unknown ≠ Low**); gust is required when using gust mode.
Wind uses the nearest forecast hour; rain/snow use the ceiling hour (preceding-hour totals).
ETAs beyond the fetched horizon are Unknown with `beyond_horizon=true`.
Severe/No Travel checkpoints include `clears_in_h`: the smallest whole-hour delay
1–48 from their final ETA with known risk <= High at the same cell, cargo and wind
measure. `clears_at_utc` is ETA plus that delay. Both are null for other levels or
when no qualifying sample exists within the cached horizon. Only the returned
offset-0 plan computes this; no extra provider calls. This is the first qualifying
sample, not a guarantee that the hazard stays clear or a new departure recommendation.

## Miles, rests and recommendation
Checkpoints are at mile 0, every spacing interval and the destination. Each owns the
road between midpoints to its neighbors (endpoints own half a segment), so owned miles
sum to route distance. `avg_risk` is the mile-weighted mean over known miles only (null
if none); `coverage` is known / total miles. Weather is sampled at H3 res-5 cell centers.

Eligible routes have zero No Travel miles. Successively keep routes within `spacing_mi/2`
of the minimum Severe miles, then within the same tolerance of minimum High miles,
then within 0.05 of minimum average risk. Pick lowest elapsed time, then lower provider
route index. Repeat to rank the remainder. If none are eligible, return `none_eligible`
and a null route_id; rank least exposure with No Travel miles first. Any route with
coverage < 0.95 makes an eligible recommendation `tentative`. Reasons and tradeoff explain
the choice. The departure advisor tries +3, +6, +12 and +24 hours using cached forecasts
and returns an option only when it strictly improves the current recommendation's sort keys.
Routes remain in provider ID order A/B/C; `rank` carries recommendation order.

Elapsed time includes rests. Default `auto` inserts 30 min after 8 hours driving and
10 hours off after 11 hours driving; the 10-hour rest resets both counters. The 14-hour
on-duty window is out of scope. `custom` repeats drive/rest intervals; `none` inserts none.
Drivers remain responsible for legal hours and truck restrictions.

## Caches, limits and providers
Identical normalized plan inputs reuse a result for **10 min**. Plans and heatmaps
are cached **1 hour**; a heatmap 404 means re-POST the plan. Routes cache **6 hours**
(endpoints rounded to 4 decimals, departure hour, 5,000 lb cargo bucket); geocoding
caches normalized query + limit for **7 days**; weather cells cache **60 min**.
Limits per IP: **30 plans/min**, **120 geocodes/min**; exceeding them returns 429.

Routing: **TomTom → OSRM** (TomTom requires a configured key). OSRM is car routing:
truck restrictions are not applied; the response includes a warning. Geocoding:
**TomTom → Open-Meteo geocoding → Photon**; keyless Open-Meteo searches place names,
then Photon handles empty results or failures. Weather uses Open-Meteo. Unavailable
weather remains Unknown. Above 70% of the daily forecast budget the heatmap uses H3 res 3;
at budget exhaustion unavailable cells are Unknown. The default budget is 9,000 locations/day.
Corridors otherwise use res 4, falling back to res 3 above 600 cells.

Heatmap warnings are sent in **`X-Weather-Warnings`**, a JSON array of `{code, message}`
objects, only when present; the header is CORS-exposed. Plan warnings are in the JSON body.
HTTP errors share `{error: {code, message, field}}`; `field` may be null.

## Decode the heatmap
`levels_b64` encodes unsigned bytes, length `hours * cells.length`, in **hour-major**
order. Values 0–4 use the risk table; **255 means Unknown**. `base_utc` is departure
rounded down to the hour; hour h is base_utc + h hours (49 hourly slices).

```js
const levels = Uint8Array.from(atob(heatmap.levels_b64), ch => ch.charCodeAt(0));
const byte = levels[h * heatmap.cells.length + c];
const level = byte === 255 ? null : byte;
const at = new Date(Date.parse(heatmap.base_utc) + h * 3600000);
```

Examples are abridged from the recorded Joliet–Denver plan; timestamps are historical.
Submit a current departure when trying requests. Both documentation UIs serve packaged assets locally.
"""
