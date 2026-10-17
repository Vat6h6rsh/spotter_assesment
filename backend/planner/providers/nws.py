"""Active Severe/Extreme NWS alerts, grouped using land UGC state prefixes."""
import re

from .base import ProviderError
from .resilience import get_json

# Includes DC; marine prefixes (AM/AN/GM/...) and territories cannot boost a trip.
STATE_NAMES = dict(zip(
    'AL AZ AR CA CO CT DE DC FL GA ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY'.split(),
    ('Alabama|Arizona|Arkansas|California|Colorado|Connecticut|Delaware|District of Columbia|Florida|Georgia|Idaho|Illinois|Indiana|Iowa|Kansas|Kentucky|Louisiana|Maine|Maryland|Massachusetts|Michigan|Minnesota|Mississippi|Missouri|Montana|Nebraska|Nevada|New Hampshire|New Jersey|New Mexico|New York|North Carolina|North Dakota|Ohio|Oklahoma|Oregon|Pennsylvania|Rhode Island|South Carolina|South Dakota|Tennessee|Texas|Utah|Vermont|Virginia|Washington|West Virginia|Wisconsin|Wyoming').split('|'),
))
RELEVANT_EVENTS = {
    'High Wind Warning': 'wind', 'Winter Storm Warning': 'snow',
    'Blizzard Warning': 'snow', 'Ice Storm Warning': 'snow',
    'Flood Warning': 'rain', 'Flash Flood Warning': 'rain',
    'Tornado Warning': 'mixed', 'Severe Thunderstorm Warning': 'mixed',
}


def parse_alerts(data: dict | list) -> list[dict]:
    if not isinstance(data, dict) or not isinstance(data.get('features'), list):
        raise ProviderError('NWS returned an invalid alert collection')
    grouped: dict[str, dict] = {}
    seen = set()
    for feature in data['features']:
        if not isinstance(feature, dict):
            continue
        props = feature.get('properties') or {}
        if not isinstance(props, dict):
            continue
        if props.get('status') != 'Actual' or props.get('severity') not in ('Severe', 'Extreme'):
            continue
        event = props.get('event')
        geocode = props.get('geocode') or {}
        codes = geocode.get('UGC', []) if isinstance(geocode, dict) else []
        if not isinstance(event, str) or not event or not isinstance(codes, list):
            continue
        states = {code[:2] for code in codes if isinstance(code, str)
                  and re.fullmatch(r'[A-Z]{2}[CZ]\d{3}', code) and code[:2] in STATE_NAMES}
        if not states:
            continue
        identifier = feature.get('id') or props.get('id')
        if isinstance(identifier, str):
            if identifier in seen:
                continue
            seen.add(identifier)
        group = grouped.setdefault(event, {'event': event, 'count': 0, 'states': set()})
        group['count'] += 1  # One alert can contain many counties or several states.
        group['states'].update(states)
    return [{**group, 'states': sorted(group['states'])} for _, group in sorted(grouped.items())]


def active_alerts() -> list[dict]:
    # get_json's shared client sends the app User-Agent; circuit is separate from forecasts.
    return parse_alerts(get_json('nws', 'https://api.weather.gov/alerts/active',
                                {'status': 'actual', 'severity': 'Severe,Extreme'}))
