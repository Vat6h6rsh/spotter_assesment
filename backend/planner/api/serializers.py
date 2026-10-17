from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo
import re

from rest_framework import serializers
from tzfpy import get_tz


class PlaceSerializer(serializers.Serializer):
    label = serializers.CharField(max_length=250)
    lat = serializers.FloatField(min_value=18, max_value=84)
    lon = serializers.FloatField(min_value=-180, max_value=-50)


class RestSerializer(serializers.Serializer):
    mode = serializers.ChoiceField(choices=("auto", "none", "custom"))
    drive_hours = serializers.FloatField(min_value=1, max_value=11, required=False)
    rest_hours = serializers.FloatField(min_value=0.5, max_value=34, required=False)

    def validate(self, attrs):
        if attrs["mode"] == "custom":
            for field in ("drive_hours", "rest_hours"):
                if field not in attrs:
                    raise serializers.ValidationError({field: "Required for custom rest mode."})
            return attrs
        return {"mode": attrs["mode"]}


class PlanSerializer(serializers.Serializer):
    origin = PlaceSerializer()
    destination = PlaceSerializer()
    departure_local = serializers.CharField(max_length=30)
    cargo_lb = serializers.FloatField(min_value=0, max_value=80000)
    spacing_mi = serializers.ChoiceField(choices=(10, 25, 50), default=25)
    wind_measure = serializers.ChoiceField(choices=("gust", "sustained"), default="gust")
    weather_slowdown = serializers.BooleanField(default=True)
    rest = RestSerializer(default={"mode": "auto"})

    def validate(self, attrs):
        origin, destination = attrs["origin"], attrs["destination"]
        if (origin["lat"], origin["lon"]) == (destination["lat"], destination["lon"]):
            raise serializers.ValidationError({"destination": "Origin and destination must differ."})
        zone = get_tz(origin["lon"], origin["lat"])
        try:
            if not re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?", attrs["departure_local"]):
                raise ValueError("Use ISO local wall time YYYY-MM-DDTHH:MM without a UTC offset")
            local = datetime.fromisoformat(attrs["departure_local"])
            if local.tzinfo is not None:
                raise ValueError("Use local wall time without a UTC offset")
            aware = local.replace(tzinfo=ZoneInfo(zone))
            utc = aware.astimezone(timezone.utc)
            if utc.astimezone(ZoneInfo(zone)).replace(tzinfo=None) != local:
                raise ValueError("This local time does not exist due to daylight saving time")
            if aware.utcoffset() != aware.replace(fold=1).utcoffset():
                raise ValueError("This local time is ambiguous due to daylight saving time")
        except ValueError as exc:
            raise serializers.ValidationError({"departure_local": str(exc)}) from exc
        now = datetime.now(timezone.utc)
        if not now - timedelta(hours=1) <= utc <= now + timedelta(hours=72):
            raise serializers.ValidationError({"departure_local": "Departure must be from now − 1 h to now + 72 h."})
        attrs.update({"departure_local": local.isoformat(timespec="seconds" if local.second else "minutes"),
                      "departure_utc": utc.isoformat(timespec="seconds").replace("+00:00", "Z"), "origin_tz": zone})
        return attrs


class GeocodeSerializer(serializers.Serializer):
    q = serializers.CharField(min_length=3, max_length=250)
    limit = serializers.IntegerField(min_value=1, max_value=20, default=5)
