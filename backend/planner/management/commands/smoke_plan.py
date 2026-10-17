import gzip
import sys
import json
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

from django.conf import settings
from django.core.management.base import BaseCommand

from planner.api.serializers import PlanSerializer
from planner.providers.resilience import set_record_directory
from planner.providers.base import ProviderError
from planner.services.geocode_service import geocode
from planner.services.plan_service import create_plan


class Command(BaseCommand):
    help = "One live Joliet, IL → Denver, CO plan; no heatmap weather calls."

    def add_arguments(self, parser):
        parser.add_argument("--record-fixtures", action="store_true", help="Record provider response bodies under planner/tests/fixtures.")

    def handle(self, *args, **options):
        if hasattr(sys.stdout, "reconfigure"):
            sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # Windows consoles default to cp1252
        directory = Path(settings.BASE_DIR) / "planner/tests/fixtures"
        if options["record_fixtures"]:
            set_record_directory(directory)
            if not (directory / "photon_live_error.json").exists():
                try:
                    self.stdout.write(f"Geocode: {len(geocode('Joliet, IL', 5)['results'])} US/Canada results")
                except ProviderError as exc:
                    self.stdout.write(f"Geocode unavailable: {exc}")
        local = (datetime.now(timezone.utc) + timedelta(hours=1)).astimezone(ZoneInfo("America/Chicago"))
        serializer = PlanSerializer(data={
            "origin": {"label": "Joliet, IL, USA", "lat": 41.525, "lon": -88.081},
            "destination": {"label": "Denver, CO, USA", "lat": 39.739, "lon": -104.990},
            "departure_local": local.strftime("%Y-%m-%dT%H:%M"), "cargo_lb": 42000,
            "spacing_mi": 25, "wind_measure": "gust", "rest": {"mode": "auto"},
        })
        serializer.is_valid(raise_exception=True)
        started = time.perf_counter()
        try:
            plan = create_plan(serializer.validated_data)
        finally:
            set_record_directory(None)
        elapsed = time.perf_counter() - started
        payload = json.dumps(plan, separators=(",", ":"), ensure_ascii=False).encode()
        lines = [f"Provider: {plan['providers']['routing']['name']}; departure {plan['inputs']['departure_utc']}"]
        for route in plan["routes"]:
            risk = route["risk"]
            lines.append(f"{route['id']} | {route['label']} | {route['distance_mi']:.1f} mi | "
                         f"No Travel {risk['miles_by_level']['no_travel']:.2f} mi | Severe {risk['miles_by_level']['severe']:.2f} mi | High {risk['miles_by_level']['high']:.2f} mi | "
                         f"coverage {risk['coverage']:.1%} | {route['total_s'] / 3600:.2f} h including rests")
        verdict = plan["recommendation"]
        first = plan["routes"][0]["checkpoints"]
        # Spread five examples across the trip rather than only showing its origin.
        for i in sorted({round(n * (len(first) - 1) / 4) for n in range(5)}):
            lines.append(f"Checkpoint {first[i]['mi']:.1f} mi: {first[i]['place_label']}")
        lines.extend([f"Recommendation: {verdict['status']} {verdict['route_id']}",
                      f"Reasons: {'; '.join(verdict['reasons'])}", f"Departure advice: {verdict['departure_advice']}",
                      f"Server time: {elapsed:.3f} s", f"Payload: {len(payload)} bytes JSON; {len(gzip.compress(payload))} bytes gzip"])
        output = "\n".join(lines)
        self.stdout.write(output)
        if options["record_fixtures"]:
            (directory / "smoke_plan.json").write_text(payload.decode(), encoding="utf-8")
            (directory / "smoke_summary.txt").write_text(output + "\n", encoding="utf-8")
