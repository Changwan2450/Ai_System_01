"""
쇼츠 자동화 REST API (PostgreSQL)
"""
import logging
import os
import threading
from pathlib import Path
from typing import Dict, Any, Set

from flask import Flask, jsonify, request
from flask_cors import CORS
import sqlalchemy
from sqlalchemy import text

from config import (
    BASE_DIR, DB_CONNECTION_STRING, CORS_ORIGINS,
    PYTHON_API_HOST, PYTHON_API_PORT,
    LOG_FORMAT, LOG_LEVEL
)

# Output folder configuration
OUTPUT_FOLDER = BASE_DIR / "output"
VIDEO_EXTENSIONS = {'.mp4', '.mov', '.mkv'}
from auth.middleware import require_api_key
from smart_curator import SmartCurator
from shorts_generator import generate_shorts
from persona_manager import persona_manager
from sentiment_analyzer import SentimentAnalyzer
from trend_analyzer import TrendAnalyzer
from upload_scheduler import UploadScheduler
from performance_tracker import PerformanceTracker

logging.basicConfig(
    level=LOG_LEVEL,
    format=LOG_FORMAT,
    handlers=[
        logging.FileHandler(BASE_DIR / "api_server.log", encoding='utf-8'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

app = Flask(__name__)

CORS(app, origins=CORS_ORIGINS, methods=["GET", "POST"], supports_credentials=True)
logger.info(f"✅ CORS: {CORS_ORIGINS}")

DB_ENGINE = sqlalchemy.create_engine(DB_CONNECTION_STRING, pool_pre_ping=True)

_initialized = False
_generating_bnos: Set[int] = set()
_generating_lock = threading.Lock()

@app.before_request
def initialize():
    global _initialized
    if not _initialized:
        logger.info("🚀 Flask 초기화")
        persona_manager.fetch_all_personas()
        analyzer = TrendAnalyzer(DB_ENGINE)
        analyzer.analyze_recent_trends(days=7)
        logger.info("✅ 초기화 완료")
        _initialized = True


@app.route('/api/health', methods=['GET'])
def health_check() -> Dict[str, Any]:
    """헬스 체크"""
    return jsonify({
        "success": True,
        "message": "쇼츠 공장 정상"
    })


@app.route('/api/status', methods=['GET'])
def get_status() -> Dict[str, Any]:
    """시스템 상태"""
    try:
        with DB_ENGINE.connect() as conn:
            pending = conn.execute(
                text("SELECT COUNT(*) FROM shorts_queue WHERE status = 0")
            ).scalar()

            completed = conn.execute(
                text("SELECT COUNT(*) FROM shorts_queue WHERE status = 1")
            ).scalar()

            scheduled_today = conn.execute(
                text("""
                    SELECT COUNT(*) FROM upload_schedule
                    WHERE DATE(scheduled_time) = CURRENT_DATE
                      AND status = 'SCHEDULED'
                """)
            ).scalar()

            tracker = PerformanceTracker(DB_ENGINE)
            perf_stats = tracker.get_performance_stats(days=7)

            return jsonify({
                "success": True,
                "data": {
                    "queue": {
                        "pending": int(pending),
                        "completed": int(completed),
                        "total": int(pending + completed)
                    },
                    "schedule": {
                        "today": int(scheduled_today)
                    },
                    "performance": {
                        "total_videos": perf_stats['total_videos'],
                        "avg_views": perf_stats['avg_views'],
                        "avg_ctr": perf_stats['avg_ctr']
                    },
                    "persona_count": len(persona_manager.persona_cache)
                }
            })
    except Exception as e:
        logger.error(f"❌ 상태 조회 실패: {e}", exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/api/curate/premium', methods=['POST'])
@require_api_key
def run_premium_curate() -> Dict[str, Any]:
    """프리미엄 큐레이션"""
    try:
        data = request.json or {}
        agro_count: int = data.get('agro_count', 1)
        info_count: int = data.get('info_count', 1)
        min_quality: float = data.get('min_quality_score', 6.0)

        curator = SmartCurator(DB_ENGINE)
        result = curator.curate_premium(
            agro_count=agro_count,
            info_count=info_count,
            min_quality_score=min_quality
        )

        return jsonify({
            "success": True,
            "data": {
                "agro": result["agro"],
                "info": result["info"],
                "total": len(result["agro"]) + len(result["info"])
            }
        })
    except Exception as e:
        logger.error(f"❌ 큐레이션 실패: {e}", exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/api/generate', methods=['POST'])
@require_api_key
def api_generate_shorts() -> Dict[str, Any]:
    """쇼츠 생성"""
    try:
        data = request.json
        if not data or 'bno' not in data:
            return jsonify({"success": False, "error": "bno 필수"}), 400

        bno: int = int(data['bno'])
        video_type: str = data.get('video_type', 'INFO')

        logger.info(f"제작 요청: BNO={bno}, TYPE={video_type}")

        with _generating_lock:
            if bno in _generating_bnos:
                logger.warning(f"BNO={bno}: 중복 요청 거부")
                return jsonify({"success": False, "error": f"BNO={bno} 진행 중"}), 409
            _generating_bnos.add(bno)

        try:
            result = generate_shorts(bno)
            
            if result["success"]:
                return jsonify(result)
            else:
                return jsonify(result), 500

        finally:
            with _generating_lock:
                _generating_bnos.discard(bno)

    except Exception as e:
        logger.error(f"생성 실패: {e}", exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/api/trends', methods=['GET'])
def get_trends() -> Dict[str, Any]:
    """트렌드 분석"""
    try:
        days = int(request.args.get('days', 7))
        analyzer = TrendAnalyzer(DB_ENGINE)
        trends = analyzer.analyze_recent_trends(days=days)
        return jsonify({"success": True, "data": trends[:20]})
    except Exception as e:
        logger.error(f"❌ 트렌드 실패: {e}", exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/api/queue', methods=['GET'])
def get_queue() -> Dict[str, Any]:
    """큐 목록"""
    try:
        query = text("""
            SELECT
                q.sq_no, b.bno, b.title, b.hit,
                q.video_type, q.quality_score, q.priority,
                q.status, q.reg_date
            FROM shorts_queue q
            JOIN ai_board b ON q.bno = b.bno
            ORDER BY q.priority DESC, q.quality_score DESC
            LIMIT 100
        """)

        with DB_ENGINE.connect() as conn:
            result = conn.execute(query)
            rows = result.fetchall()

            queue_list = [
                {
                    "sq_no": row[0],
                    "bno": row[1],
                    "title": row[2],
                    "hit": row[3],
                    "video_type": row[4],
                    "quality_score": float(row[5] or 0),
                    "priority": int(row[6] or 0),
                    "status": row[7],
                    "reg_date": str(row[8])
                }
                for row in rows
            ]

            return jsonify({"success": True, "data": queue_list})
    except Exception as e:
        logger.error(f"❌ 큐 조회 실패: {e}", exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/api/videos', methods=['GET'])
def get_videos() -> Dict[str, Any]:
    """파일시스템에서 비디오 목록 조회"""
    try:
        if not OUTPUT_FOLDER.exists():
            return jsonify({
                "success": False,
                "error": "Output folder does not exist"
            }), 404

        videos = []
        for file_path in OUTPUT_FOLDER.iterdir():
            if file_path.is_file() and file_path.suffix.lower() in VIDEO_EXTENSIONS:
                stat = file_path.stat()
                videos.append({
                    "name": file_path.name,
                    "size": stat.st_size,
                    "createdAt": os.path.getctime(str(file_path)),
                    "modifiedAt": stat.st_mtime
                })

        # Sort by modifiedAt DESC
        videos.sort(key=lambda x: x['modifiedAt'], reverse=True)

        return jsonify({
            "success": True,
            "total": len(videos),
            "videos": videos
        })

    except Exception as e:
        logger.error(f"❌ 비디오 목록 조회 실패: {e}", exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/api/videos/<filename>', methods=['DELETE'])
def delete_video(filename: str) -> Dict[str, Any]:
    """비디오 파일 삭제"""
    try:
        # Validate filename (prevent directory traversal)
        if '..' in filename or '/' in filename or '\\' in filename:
            return jsonify({
                "success": False,
                "error": "Invalid filename"
            }), 400

        file_path = OUTPUT_FOLDER / filename

        # Ensure file is within output folder
        if not str(file_path.resolve()).startswith(str(OUTPUT_FOLDER.resolve())):
            return jsonify({
                "success": False,
                "error": "Invalid file path"
            }), 400

        # Check if file exists
        if not file_path.exists():
            return jsonify({
                "success": False,
                "error": "File not found"
            }), 404

        # Check if it's a video file
        if file_path.suffix.lower() not in VIDEO_EXTENSIONS:
            return jsonify({
                "success": False,
                "error": "Not a video file"
            }), 400

        # Delete the file
        file_path.unlink()
        logger.info(f"✅ 파일 삭제: {filename}")

        return jsonify({"success": True})

    except Exception as e:
        logger.error(f"❌ 파일 삭제 실패: {e}", exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/api/system/status', methods=['GET'])
def get_system_status() -> Dict[str, Any]:
    """시스템 상태 조회"""
    try:
        if not OUTPUT_FOLDER.exists():
            return jsonify({
                "success": False,
                "error": "Output folder does not exist"
            }), 404

        videos = []
        for file_path in OUTPUT_FOLDER.iterdir():
            if file_path.is_file() and file_path.suffix.lower() in VIDEO_EXTENSIONS:
                stat = file_path.stat()
                videos.append({
                    "modifiedAt": stat.st_mtime
                })

        last_modified = None
        if videos:
            videos.sort(key=lambda x: x['modifiedAt'], reverse=True)
            # Convert timestamp to ISO string
            from datetime import datetime
            last_modified = datetime.fromtimestamp(videos[0]['modifiedAt']).isoformat()

        return jsonify({
            "success": True,
            "outputPath": str(OUTPUT_FOLDER),
            "totalVideos": len(videos),
            "lastModified": last_modified
        })

    except Exception as e:
        logger.error(f"❌ 시스템 상태 조회 실패: {e}", exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/api/dashboard/status', methods=['GET'])
def get_dashboard_status() -> Dict[str, Any]:
    """통합 대시보드 상태 집계 (read-only, no X-API-Key required)"""
    import json as _json
    import time as _time
    import urllib.request as _req
    from datetime import datetime, timezone, timedelta

    now_kst = datetime.now(timezone(timedelta(hours=9))).isoformat(timespec='seconds')

    # ── 1. Python self-health (always ok if we got here) ──────────────
    servers = {
        "python": {"status": "ok", "latency_ms": 0}
    }

    # ── 2. Java health (HEAD on /board/list) ──────────────────────────
    java_url = os.environ.get("JAVA_API_URL", "http://localhost:9090")
    try:
        t0 = _time.monotonic()
        r = _req.urlopen(f"{java_url}/board/list", timeout=3)
        latency = int((_time.monotonic() - t0) * 1000)
        servers["java"] = {
            "status": "ok" if r.status < 500 else "error",
            "latency_ms": latency
        }
    except Exception as e:
        logger.warning(f"Java health check failed: {e}")
        servers["java"] = {"status": "unknown", "latency_ms": -1}

    # ── 3. ACP / queue status (reuse existing DB_ENGINE) ───────────────
    acp: Dict[str, Any] = {
        "queue_pending": 0,
        "queue_completed": 0,
        "queue_error": 0,
        "scheduled_today": 0,
        "generating_count": 0,
    }
    try:
        with DB_ENGINE.connect() as conn:
            acp["queue_pending"] = int(
                conn.execute(text("SELECT COUNT(*) FROM shorts_queue WHERE status = 0")).scalar() or 0
            )
            acp["queue_completed"] = int(
                conn.execute(text("SELECT COUNT(*) FROM shorts_queue WHERE status = 1")).scalar() or 0
            )
            acp["queue_error"] = int(
                conn.execute(text("SELECT COUNT(*) FROM shorts_queue WHERE status = 9")).scalar() or 0
            )
            acp["scheduled_today"] = int(
                conn.execute(text(
                    "SELECT COUNT(*) FROM upload_schedule "
                    "WHERE DATE(scheduled_time) = CURRENT_DATE AND status = 'SCHEDULED'"
                )).scalar() or 0
            )
        with _generating_lock:
            acp["generating_count"] = len(_generating_bnos)
    except Exception as e:
        logger.warning(f"ACP DB query failed: {e}")

    # ── 4. n8n health (optional) ────────────────────────────────────────
    n8n_url = os.environ.get("N8N_URL", "")
    n8n: Dict[str, Any] = {"status": "not_configured", "checked_at": now_kst}
    if n8n_url:
        try:
            t0 = _time.monotonic()
            r2 = _req.urlopen(f"{n8n_url.rstrip('/')}/healthz", timeout=3)
            latency = int((_time.monotonic() - t0) * 1000)
            n8n = {
                "status": "ok" if r2.status < 500 else "error",
                "latency_ms": latency,
                "checked_at": now_kst,
            }
        except Exception as e:
            logger.warning(f"n8n health check failed: {e}")
            n8n = {"status": "unknown", "checked_at": now_kst}

    # ── 5. Deploy info (version.json) ───────────────────────────────────
    version_file = BASE_DIR / "version.json"
    deploy: Dict[str, Any] = {"version": "unknown", "sha": "", "deployed_at": ""}
    if version_file.exists():
        try:
            with version_file.open() as f:
                deploy = _json.load(f)
        except Exception as e:
            logger.warning(f"version.json read failed: {e}")

    return jsonify({
        "success": True,
        "timestamp": now_kst,
        "servers": servers,
        "acp": acp,
        "n8n": n8n,
        "deploy": deploy,
    })


def main() -> None:
    """API 서버 실행"""
    logger.info("🚀 쇼츠 공장 API 시작")
    logger.info(f"📍 {PYTHON_API_HOST}:{PYTHON_API_PORT}")
    app.run(host=PYTHON_API_HOST, port=PYTHON_API_PORT, debug=False)


if __name__ == "__main__":
    main()
