"""Pure ranking and copy for a sampled 48-hour freight-weather demonstration."""
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from .corridors import Corridor, SamplePoint
from .geometry import M_PER_MI, haversine
from .risk import Classification, classify
from .weather import WeatherSeries

CARGO_LB = 43000
WINDOW_HOURS = 48
ALERT_BOOST = 0.15


@dataclass(frozen=True)
class PointPeak:
    point: SamplePoint
    at: datetime
    classification: Classification
    # Independent 48-hour maxima, not a fabricated concurrent weather observation.
    wind: float
    gust: float
    rain: float
    snow: float
    badness: float

    @property
    def score(self) -> tuple[int, float]:
        assert self.classification.level is not None
        return self.classification.level, self.badness


def badness(wind: float, gust: float, rain: float, snow: float) -> float:
    """Normalized exceedance over the classifier's High thresholds (before cargo)."""
    return (max(0.0, max(wind, gust) / 35 - 1)
            + max(0.0, rain / 0.25 - 1) + max(0.0, snow / 1.0 - 1))


def point_peak(point: SamplePoint, series: WeatherSeries | None, now: datetime,
               alert: bool = False) -> PointPeak | None:
    if series is None:
        return None
    # Include the current hourly bin, exclude past bins and the +48h boundary.
    start = now.astimezone(timezone.utc).replace(minute=0, second=0, microsecond=0)
    end = start + timedelta(hours=WINDOW_HOURS)
    rows = []
    for i, values in enumerate(zip(series.wind, series.gust, series.rain, series.snow)):
        at = series.start + timedelta(hours=i)
        if not start <= at < end:
            continue
        classification = classify(*values, CARGO_LB, 'gust')
        if classification.level is not None:
            rows.append((classification.level, badness(*values), at, classification, values))
    # Only complete 48-hour points participate; the service checks catalogue coverage.
    if len(rows) != WINDOW_HOURS:
        return None
    _, metric, at, classification, _ = max(rows, key=lambda row: row[:2])
    maxima = [max(row[4][i] for row in rows) for i in range(4)]
    return PointPeak(point, at, classification, *maxima, metric + (ALERT_BOOST if alert else 0))


def select_more(candidates: list[tuple[Corridor, PointPeak]],
                main: tuple[Corridor, PointPeak]) -> list[tuple[Corridor, PointPeak]]:
    """Prefer new hazards, then peaks >=500 straight-line miles from every selected peak."""
    ranked = sorted(candidates, key=lambda pair: pair[1].score, reverse=True)
    selected = [main]
    for _ in range(2):
        remaining = [(c, p) for c, p in ranked
                     if p.classification.level >= 2 and all(c != chosen for chosen, _ in selected)]
        hazards = {hazard_for(p, set()) for _, p in selected}
        diverse = [(c, p) for c, p in remaining if hazard_for(p, set()) not in hazards]
        regional = [(c, p) for c, p in remaining if all(
            haversine((p.point.lat, p.point.lon), (other.point.lat, other.point.lon)) / M_PER_MI >= 500
            for _, other in selected)]
        choices = diverse or regional
        if not choices:
            break
        selected.append(choices[0])
    return selected[1:]


def showcase_segment(points: tuple[SamplePoint, ...], peak: SamplePoint
                     ) -> tuple[SamplePoint, SamplePoint, float] | None:
    """Bracket the peak on its interstate, preferring a straight 150–300 mi approach/exit.

    Summed sample chords approximate road distance. Near an interstate end or bend,
    a shorter leg is preferable to endpoints that invite a cross-country shortcut.
    The real planner, not this geometric heuristic, decides whether to publish it.
    """
    index = points.index(peak)
    miles = [0.0]
    for a, b in zip(points, points[1:]):
        miles.append(miles[-1] + haversine((a.lat, a.lon), (b.lat, b.lon)) / M_PER_MI)
    before = [i for i in range(index) if 0 < miles[index] - miles[i] <= 300]
    after = [j for j in range(index + 1, len(points)) if 0 < miles[j] - miles[index] <= 300]
    if not before or not after:
        return None

    def score(pair):
        i, j = pair
        direct = haversine((points[i].lat, points[i].lon), (points[j].lat, points[j].lon)) / M_PER_MI
        detour = (miles[j] - miles[i]) / max(direct, 0.001)
        # Triangle excess detects bends (notably Miami -> Naples -> north Florida).
        # Prefer spans within 15% of their endpoint chord before distance targets.
        approach, exit = miles[index] - miles[i], miles[j] - miles[index]
        return (detour > 1.15, abs(approach - 225) + abs(exit - 225), detour)

    i, j = min(((i, j) for i in before for j in after), key=score)
    return points[i], points[j], miles[index] - miles[i]


def next_departure(now: datetime, tz: str, peak_at: datetime | None = None,
                   approach_mi: float = 0) -> str:
    now = now.astimezone(timezone.utc)
    target = (peak_at - timedelta(hours=approach_mi / 55)) if peak_at else now
    upper = now + timedelta(hours=72)
    zone = ZoneInfo(tz)
    # An unreachable peak means "leave now": the start of the current hour keeps the whole-hour contract
    # (YYYY-MM-DDTHH:00) and is accepted by POST /api/plans, which allows departures from now - 1 h.
    if peak_at is not None and target <= now:
        departure = now.replace(minute=0, second=0, microsecond=0)
    else:
        departure = min(max(target, now), upper)
        rounded = departure.replace(minute=0, second=0, microsecond=0)
        departure = rounded + timedelta(hours=departure != rounded)
        if departure > upper:
            departure = upper.replace(minute=0, second=0, microsecond=0)
    local = departure.astimezone(zone)
    # The plan contract has no fold field and rejects repeated wall times in autumn.
    # Select the first whole hour it can accept (at most two repeated hours skipped).
    original = departure
    while local.replace(fold=0).utcoffset() != local.replace(fold=1).utcoffset():
        departure += timedelta(hours=1)
        local = departure.astimezone(zone)
    if departure > upper:
        departure = original
        local = departure.astimezone(zone)
        while local.replace(fold=0).utcoffset() != local.replace(fold=1).utcoffset() or departure > upper:
            departure -= timedelta(hours=1)
            local = departure.astimezone(zone)
    return local.replace(tzinfo=None).isoformat(timespec='minutes')


def hazard_for(peak: PointPeak, alert_hazards: set[str]) -> str:
    drivers = peak.classification.drivers
    if peak.classification.level < 2 and alert_hazards:
        return next(iter(alert_hazards)) if len(alert_hazards) == 1 else 'mixed'
    if len(drivers) > 1:
        return 'mixed'
    if drivers:
        return drivers[0]
    return max(('wind', 'rain', 'snow'), key=lambda h: {
        'wind': max(peak.wind, peak.gust) / 35, 'rain': peak.rain / 0.25, 'snow': peak.snow,
    }[h])


def describe(peak: PointPeak, road: str, hazard: str, region: str,
             alert_count: int, alerts_available: bool) -> tuple[str, str, str]:
    words = {'wind': ('High winds', 'high-wind'), 'rain': ('Heavy rain', 'heavy-rain'),
             'snow': ('Heavy snow', 'snow and ice'), 'mixed': ('Hazardous weather', 'bad-weather')}
    title, zone = words[hazard]
    city = peak.point.place.rsplit(', ', 1)[0]
    headline = f'{title} on {road} near {city}, {region}'
    if peak.classification.level < 2 and alert_count:
        headline = f'Active weather warnings on {road} near {city}, {region}'
    wind_value = (f'Forecast sustained winds up to {peak.wind:.0f} mph' if peak.wind > peak.gust
                  else f'Forecast gusts up to {peak.gust:.0f} mph')
    values = {'wind': wind_value,
              'rain': f'Forecast rain up to {peak.rain:.2f} in/hr',
              'snow': f'Forecast snow up to {peak.snow:.2f} in/hr',
              'mixed': f'Forecast gusts up to {peak.gust:.0f} mph, rain {peak.rain:.2f} in/hr and snow {peak.snow:.2f} in/hr'}
    impact = (', enough to stop loaded trucks' if peak.classification.level == 4 else
              ', rated ' + ('Low', 'Moderate', 'High', 'Severe')[peak.classification.level] + ' for 43,000 lb cargo')
    alerts = (f'{alert_count} relevant NWS alert' + ('' if alert_count == 1 else 's') + ' active'
              if alerts_available else 'NWS alerts unavailable')
    summary = f'{values[hazard]} near {peak.point.place}{impact}; {alerts}.'
    why = f'{road} crosses the {zone} zone near {peak.point.place}.'
    if peak.classification.level < 2 and alert_count:
        why = f'{road} passes near {peak.point.place}, in a state with an active trucking-weather warning.'
    return headline, summary, why
