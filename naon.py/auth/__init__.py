"""
Auth module for API authentication (PR-PY-01)
"""
from .middleware import require_api_key

__all__ = ['require_api_key']
