"""
API 인증 미들웨어 (PR-PY-01)
X-API-Key 헤더 검증
"""
import secrets
from functools import wraps
from flask import request, jsonify
from config import FACTORY_API_KEY


def require_api_key(f):
    """
    API Key 인증 데코레이터

    Usage:
        @app.route('/api/generate', methods=['POST'])
        @require_api_key
        def generate_shorts():
            ...

    Returns:
        401 Unauthorized if:
        - X-API-Key header is missing
        - X-API-Key does not match FACTORY_API_KEY
        - FACTORY_API_KEY is not configured (fail closed)
    """
    @wraps(f)
    def decorated_function(*args, **kwargs):
        provided_key = request.headers.get("X-API-Key", "")

        # API Key가 설정되지 않았으면 모든 요청 거부 (fail closed)
        if not FACTORY_API_KEY or FACTORY_API_KEY.strip() == "":
            return jsonify({
                "success": False,
                "error_code": "CONFIG_ERROR",
                "message": "Server API key not configured"
            }), 503

        # 제공된 키가 없거나 일치하지 않으면 거부
        if not provided_key or not secrets.compare_digest(provided_key, FACTORY_API_KEY):
            return jsonify({
                "success": False,
                "error_code": "UNAUTHORIZED",
                "message": "Invalid API key"
            }), 401

        # 인증 성공 - 원래 함수 실행
        return f(*args, **kwargs)

    return decorated_function
