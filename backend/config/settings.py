import os
from pathlib import Path

from dotenv import load_dotenv
from django.core.management.utils import get_random_secret_key

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")


def env_list(name, default):
    return [value.strip() for value in (os.getenv(name) or default).split(",") if value.strip()]


SECRET_KEY = os.getenv("DJANGO_SECRET_KEY") or get_random_secret_key()
DEBUG = os.getenv("DEBUG", "false").lower() in {"true", "1", "yes"}
ALLOWED_HOSTS = env_list("ALLOWED_HOSTS", "localhost,127.0.0.1,[::1]")
# Render injects its public hostname; behind its proxy, trust X-Forwarded-Proto for HTTPS.
if os.getenv("RENDER_EXTERNAL_HOSTNAME"):
    ALLOWED_HOSTS.append(os.environ["RENDER_EXTERNAL_HOSTNAME"])
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
CORS_ALLOWED_ORIGINS = env_list("CORS_ALLOWED_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173")
CORS_EXPOSE_HEADERS = ["X-Weather-Warnings"]
INSTALLED_APPS = ["django.contrib.staticfiles", "rest_framework", "corsheaders", "planner", "drf_spectacular", "drf_spectacular_sidecar"]
MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.gzip.GZipMiddleware",
    "django.middleware.common.CommonMiddleware",
]
ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"
DATABASES = {"default": {"ENGINE": "django.db.backends.sqlite3", "NAME": BASE_DIR / "db.sqlite3"}}
USE_TZ = True
TIME_ZONE = "UTC"
STATIC_URL = "/static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
STORAGES = {"staticfiles": {"BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage"}}
REDIS_URL = os.getenv("REDIS_URL", "")
CACHES = {"default": (
    {"BACKEND": "django.core.cache.backends.redis.RedisCache", "LOCATION": REDIS_URL}
    if REDIS_URL else {"BACKEND": "django.core.cache.backends.locmem.LocMemCache", "LOCATION": "planner-v05", "OPTIONS": {"MAX_ENTRIES": 10000}}
)}
TOMTOM_API_KEY = os.getenv("TOMTOM_API_KEY", "")
OPEN_METEO_API_KEY = os.getenv("OPEN_METEO_API_KEY", "")
WEATHER_DAILY_BUDGET = int(os.getenv("WEATHER_DAILY_BUDGET") or "9000")
REST_FRAMEWORK = {
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
    "DEFAULT_AUTHENTICATION_CLASSES": [],
    "UNAUTHENTICATED_USER": None,
    "DEFAULT_RENDERER_CLASSES": ["rest_framework.renderers.JSONRenderer"],
    "DEFAULT_THROTTLE_RATES": {"plans": "30/min", "geocode": "120/min", "hotspot": "20/min"},
    "EXCEPTION_HANDLER": "planner.api.exceptions.exception_handler",
}

# App templates and packaged static assets keep both documentation UIs self-hosted.
TEMPLATES = [{"BACKEND": "django.template.backends.django.DjangoTemplates", "APP_DIRS": True}]
from planner.api.description import API_DESCRIPTION

SPECTACULAR_SETTINGS = {
    "TITLE": "Spotter Weather Route API",
    "VERSION": "0.5.0",
    "DESCRIPTION": API_DESCRIPTION,
    "SWAGGER_UI_DIST": "SIDECAR",
    "SWAGGER_UI_FAVICON_HREF": "SIDECAR",
    "REDOC_DIST": "SIDECAR",
    "SWAGGER_UI_SETTINGS": {"deepLinking": True, "validatorUrl": None},
    "REDOC_UI_SETTINGS": {
        "disableGoogleFont": True,
        "theme": {"typography": {"fontFamily": "Arial, sans-serif", "headings": {"fontFamily": "Arial, sans-serif"}}},
    },
    "COMPONENT_SPLIT_REQUEST": True,
    "SERVE_INCLUDE_SCHEMA": False,
    "ENUM_NAME_OVERRIDES": {
        "RoutingNameEnum": ["tomtom", "osrm"],
        "WeatherNameEnum": ["open-meteo"],
    },
}
