"""Recompute additive clearance fields using the saved plan and exact weather cells."""
import copy
from datetime import datetime
import json
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand
import h3

from planner.domain.weather import clearance
from planner.providers.openmeteo import OpenMeteo
from planner.services.plan_service import iso


class Command(BaseCommand):
    help = "Refresh recorded checkpoint clearance fields offline; no provider calls."

    def handle(self, *args, **options):
        fixtures = Path(settings.BASE_DIR) / 'planner/tests/fixtures'
        request = json.loads((fixtures / 'openmeteo_request.json').read_text(encoding='utf-8'))
        records = json.loads((fixtures / 'openmeteo.json').read_text(encoding='utf-8'))
        cells = [h3.latlng_to_cell(float(lat), float(lon), 5) for lat, lon in zip(
            request['latitude'].split(','), request['longitude'].split(','))]
        forecasts = dict(zip(cells, map(OpenMeteo.normalise, records)))
        plan_path = fixtures / 'smoke_plan.json'
        plan = json.loads(plan_path.read_text(encoding='utf-8'))
        flagged = 0
        for route in plan['routes']:
            for cp in route['checkpoints']:
                series = forecasts[h3.latlng_to_cell(cp['lat'], cp['lon'], 5)]
                hours, at = clearance(series, datetime.fromisoformat(cp['eta_utc']), cp['level'],
                                      plan['inputs']['cargo_lb'], plan['inputs']['wind_measure'])
                cp.update(clears_in_h=hours, clears_at_utc=iso(at) if at else None)
                flagged += cp['level'] in (3, 4)
        plan_path.write_text(json.dumps(plan, separators=(',', ':'), ensure_ascii=False), encoding='utf-8')
        abridged = copy.deepcopy(plan)
        for route in abridged['routes']:
            route['checkpoints'] = route['checkpoints'][:3]
        (Path(settings.BASE_DIR) / 'planner/api/plan_example.json').write_text(
            json.dumps(abridged, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
        self.stdout.write(f'Recomputed clearance for {flagged} flagged recorded checkpoints; no network calls.')
