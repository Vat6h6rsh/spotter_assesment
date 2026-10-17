"""Fill the same hotspot cache consumed by the welcome endpoint."""
import json

from django.core.management.base import BaseCommand

from planner.services.hotspot_service import get_hotspot


class Command(BaseCommand):
    help = "Warm the shared hotspot cache (real provider calls on a cache miss)."

    def handle(self, *args, **options):
        self.stdout.write(json.dumps(get_hotspot(), ensure_ascii=True))
