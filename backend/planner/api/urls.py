from django.urls import path
from django.views.generic import RedirectView
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView, SpectacularRedocView

from .views import GeocodeView, HealthView, HeatmapView, PlansView, HotspotView

urlpatterns = [
    path("", RedirectView.as_view(url="/api/docs/", permanent=False)),
    path("schema/", SpectacularAPIView.as_view(), name="schema"),
    path("docs/", SpectacularSwaggerView.as_view(url_name="schema"), name="swagger-ui"),
    path("redoc/", SpectacularRedocView.as_view(url_name="schema", template_name="planner/redoc.html"), name="redoc"),
    path("health", HealthView.as_view()),
    path("weather/hotspot", HotspotView.as_view()),
    path("geocode", GeocodeView.as_view()),
    path("plans", PlansView.as_view()),
    path("plans/<str:plan_id>/heatmap", HeatmapView.as_view()),
]
