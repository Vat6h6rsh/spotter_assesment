import json

from django.conf import settings
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView
from drf_spectacular.utils import extend_schema, OpenApiParameter, OpenApiResponse, PolymorphicProxySerializer
from drf_spectacular.types import OpenApiTypes

from .schema import Health, GeocodeResult, PlanRequest, PlanResponse, HeatmapResponse, Error, HotspotAvailable, HotspotUnavailable
from .examples import PLAN_EXAMPLE, REQUEST_EXAMPLE, GEOCODE_EXAMPLE, HEATMAP_EXAMPLE, HOTSPOT_EXAMPLE, HOTSPOT_UNAVAILABLE_EXAMPLE

from planner.providers.base import ProviderError
from planner.services.geocode_service import geocode
from planner.services.heatmap_service import get_heatmap
from planner.services.plan_service import create_plan
from planner.services.weather_store import budget_usage
from planner.services.hotspot_service import get_hotspot
from .serializers import GeocodeSerializer, PlanSerializer


def provider_error(exc):
    return Response({"error": {"code": "PROVIDER_UNAVAILABLE", "message": str(exc), "field": None}}, status=503)


class HotspotView(APIView):
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "hotspot"

    @extend_schema(
        summary="Find a bad-weather freight trip", tags=["Weather"],
        description="Scan a fixed contiguous-US freight catalogue over 48 hours with 43000 lb cargo and gust classification. Severity ranks before normalized gust/rain/snow exceedance; relevant state-level NWS alerts add a small tie-break boost. Shared H3 res-5 weather cache and daily location budget; result cached 60 minutes with singleflight. 20 requests/min per IP. No notable weather, budget exhaustion and provider failures return available=false with HTTP 200; NWS failure alone is nonfatal. This sample scan and immediate demo departure do not guarantee a nationwide maximum or an encounter with the forecast peak.",
        responses={200: PolymorphicProxySerializer(component_name="HotspotResponse",
                   serializers=[HotspotAvailable, HotspotUnavailable], resource_type_field_name=None),
                   429: OpenApiResponse(Error, "20 hotspot requests/min per IP exceeded.")},
        examples=[HOTSPOT_EXAMPLE, HOTSPOT_UNAVAILABLE_EXAMPLE],
    )
    def get(self, request):
        return Response(get_hotspot())


class HealthView(APIView):
    @extend_schema(
        summary="Check service health and weather budget", tags=["System"],
        description="Reports process status, configured primary router and today's UTC weather location budget. Does not call providers.",
        responses={200: Health},
    )
    def get(self, request):
        return Response({"status": "ok", "version": "0.5.0", "routing": "tomtom" if settings.TOMTOM_API_KEY else "osrm",
                         "weather": "open-meteo", "weather_budget": budget_usage()})


class GeocodeView(APIView):
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "geocode"

    @extend_schema(
        summary="Find US and Canada places", tags=["Places"],
        examples=[GEOCODE_EXAMPLE],
        description="Choose place coordinates before planning. TomTom falls back to Open-Meteo geocoding then Photon. Cached 7 days by normalized query and limit; 120 requests/min per IP. Client should debounce 300 ms.",
        parameters=[
            OpenApiParameter("q", OpenApiTypes.STR, required=True, description="Search text, 3?250 characters, trimmed. Required; no default.", pattern=r"^.{3,250}$"),
            OpenApiParameter("limit", OpenApiTypes.INT, description="Maximum matches, inclusive 1?20; default 5.", default=5, location=OpenApiParameter.QUERY),
        ],
        responses={200: GeocodeResult, 400: OpenApiResponse(Error, "Invalid query or limit."), 429: OpenApiResponse(Error, "120 geocodes/min per IP exceeded."), 503: OpenApiResponse(Error, "Geocoding providers unavailable.")},
    )
    def get(self, request):
        serializer = GeocodeSerializer(data=request.query_params)
        serializer.is_valid(raise_exception=True)
        try:
            return Response(geocode(serializer.validated_data["q"], serializer.validated_data["limit"]))
        except ProviderError as exc:
            return provider_error(exc)


class PlansView(APIView):
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "plans"

    @extend_schema(
        summary="Plan weather-aware truck routes", tags=["Plans"],
        description="Return up to three routes, owned-mile weather exposure, rest-inclusive ETAs and a risk-first recommendation. departure_local is in the origin's time zone. Identical normalized inputs cache 10 min; 30 plans/min per IP. Load the corridor heatmap separately using plan_id.",
        request=PlanRequest,
        responses={200: PlanResponse, 400: OpenApiResponse(Error, "Invalid trip input; field identifies the first error."), 429: OpenApiResponse(Error, "30 plans/min per IP exceeded."), 503: OpenApiResponse(Error, "Routing/provider service unavailable.")},
        examples=[REQUEST_EXAMPLE, PLAN_EXAMPLE],
    )
    def post(self, request):
        serializer = PlanSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            return Response(create_plan(serializer.validated_data))
        except ProviderError as exc:
            return provider_error(exc)


class HeatmapView(APIView):
    @extend_schema(
        summary="Load a plan's hourly weather corridor", tags=["Plans"],
        examples=[HEATMAP_EXAMPLE],
        description="Lazily compute 49 hour-major H3 risk slices. Decode levels_b64 as unsigned bytes; 255 is Unknown. A missing/expired plan returns 404: re-POST its inputs. Cached one hour. Weather warnings, when present, are a JSON array in the X-Weather-Warnings header.",
        parameters=[
            OpenApiParameter("plan_id", OpenApiTypes.STR, location=OpenApiParameter.PATH, required=True, description="Opaque plan_id returned by POST /api/plans; plan cache lifetime is one hour."),
            OpenApiParameter("X-Weather-Warnings", OpenApiTypes.STR, location=OpenApiParameter.HEADER, response=[200], description='Optional JSON array of {code, message} weather warnings; CORS-exposed.'),
        ],
        responses={200: HeatmapResponse, 404: OpenApiResponse(Error, "Unknown or expired plan (PLAN_EXPIRED). Re-submit the trip."), 503: OpenApiResponse(Error, "Provider service unavailable.")},
    )
    def get(self, request, plan_id):
        try:
            result = get_heatmap(plan_id)
        except ProviderError as exc:
            return provider_error(exc)
        if result is None:
            return Response({"error": {"code": "PLAN_EXPIRED", "message": "Plan expired; submit it again.", "field": None}}, status=404)
        response = Response({k: v for k, v in result.items() if k != "_warnings"})
        if result.get("_warnings"):
            response["X-Weather-Warnings"] = json.dumps(result["_warnings"], separators=(",", ":"))
        return response
