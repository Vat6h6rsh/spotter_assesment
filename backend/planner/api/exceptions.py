from rest_framework.exceptions import ValidationError
from rest_framework.views import exception_handler as drf_exception_handler


def first_error(detail, prefix=""):
    if isinstance(detail, dict):
        key = next(iter(detail))
        return first_error(detail[key], f"{prefix}.{key}".strip("."))
    if isinstance(detail, list):
        return first_error(detail[0], prefix)
    return str(detail), prefix or None


def exception_handler(exc, context):
    response = drf_exception_handler(exc, context)
    if response is not None:
        message, field = first_error(response.data)
        code = "VALIDATION_ERROR" if isinstance(exc, ValidationError) else getattr(exc, "default_code", "ERROR").upper()
        response.data = {"error": {"code": code, "message": message, "field": field}}
    return response
