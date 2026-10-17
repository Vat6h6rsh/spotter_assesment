from django.urls import include, path

urlpatterns = [path("api/", include("planner.api.urls"))]
