"""
쇼츠 자동화 시스템 REST API 서버 (edge-tts 무료 버전)
PR-PY-01: CORS 제한 + API Key 인증
"""
import logging
import threading
from typing import Dict, Any, List, Set

from flask import Flask, jsonify, request
from flask_cors import CORS
import sqlalchemy

from config import (
    BASE_DIR, DB_CONNECTION_STRING, CORS_ORIGINS,
    PYTHON_API_HOST, PYTHON_API_PORT,
    LOG_FORMAT, LOG_LEVEL
)
from auth.middleware import require_api_key
from smart_curator import SmartCurator
from shorts_generator import (
    get_target_by_bno,
    generate_script_with_openai,
    render_video_with_persona
)
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

# PR-PY-01: CORS whitelist (환경변수 기반)
CORS(app, origins=CORS_ORIGINS, methods=["GET", "POST"], supports_credentials=True)
logger.info(f"✅ CORS 설정 완료: {CORS_ORIGINS}")

DB_ENGINE = sqlalchemy.create_engine(DB_CONNECTION_STRING)

# 초기화 플래그 (최초 요청 시 한 번만 실행)
_initialized = False

# 동시 제작 방지: 현재 제작 중인 BNO 추적
_generating_bnos: Set[int] = set()
_generating_lock = threading.Lock()

@app.before_request
def initialize():
    global _initialized
    if not _initialized:
        logger.info("🚀 Flask 서버 초기화 중... (edge-tts 무료 버전)")
        persona_manager.fetch_all_personas()
        analyzer = TrendAnalyzer(DB_ENGINE)
        analyzer.analyze_recent_trends(days=7)
        logger.info("✅ 초기화 완료 (edge-tts 사용)")
        _initialized = True


@app.route('/api/health', methods=['GET'])
def health_check() -> Dict[str, Any]:
    """헬스 체크 (인증 불필요)"""
    return jsonify({
        "success": True,
        "message": "Python 쇼츠 공장 정상 가동 중 (edge-tts 무료 90% 버전)"
    })


@app.route('/api/status', methods=['GET'])
def get_status() -> Dict[str, Any]:
    """시스템 상태 조회 (인증 불필요)"""
    try:
        with DB_ENGINE.connect() as conn:
            pending = conn.execute(
                sqlalchemy.text("SELECT COUNT(*) FROM shorts_queue WHERE status = 0")
            ).scalar()

            completed = conn.execute(
                sqlalchemy.text("SELECT COUNT(*) FROM shorts_queue WHERE status = 1")
            ).scalar()

            scheduled_today = conn.execute(
                sqlalchemy.text("""
                                SELECT COUNT(*) FROM upload_schedule
                                WHERE TRUNC(scheduled_time) = TRUNC(SYSDATE)
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
                    "persona_count": len(persona_manager.persona_cache),
                    "tts_engine": "edge-tts (무료)"
                }
            })
    except Exception as e:
        logger.error(f"❌ 상태 조회 실패: {e}", exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/api/curate/premium', methods=['POST'])
@require_api_key  # PR-PY-01: 인증 필수
def run_premium_curate() -> Dict[str, Any]:
    """프리미엄 큐레이션 (인증 필수)"""
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


def _ensure_queue_ready(bno: int, video_type: str, req_data: dict) -> None:
    """
    제작 요청 전 shorts_queue에 status=0 레코드가 있는지 확인.
    - status=9(실패) 레코드가 있으면 → 최신 1건을 status=0으로 초기화
    - 레코드 자체가 없으면 → 새로 INSERT
    """
    try:
        # 조회용 커넥션 (autobegin)
        with DB_ENGINE.connect() as conn:
            has_ready = conn.execute(
                sqlalchemy.text(
                    "SELECT COUNT(*) FROM shorts_queue WHERE bno = :bno AND status = 0"
                ),
                {"bno": bno}
            ).scalar()

        if has_ready and has_ready > 0:
            logger.debug(f"BNO={bno}: status=0 레코드 이미 존재 ({has_ready}건)")
            return

        # 쓰기용 별도 커넥션 (begin 명시)
        with DB_ENGINE.begin() as conn:
            latest_failed = conn.execute(
                sqlalchemy.text(
                    "SELECT sq_no FROM shorts_queue "
                    "WHERE bno = :bno AND status = 9 "
                    "ORDER BY sq_no DESC FETCH FIRST 1 ROW ONLY"
                ),
                {"bno": bno}
            ).fetchone()

            if latest_failed:
                sq_no = latest_failed[0]
                conn.execute(
                    sqlalchemy.text(
                        "UPDATE shorts_queue SET status = 0, video_type = :vtype "
                        "WHERE sq_no = :sq_no"
                    ),
                    {"sq_no": sq_no, "vtype": video_type}
                )
                logger.info(f"BNO={bno}: 실패 레코드 SQ_NO={sq_no} -> status=0 초기화")
                return

            # 레코드 자체가 없으면 신규 INSERT
            conn.execute(
                sqlalchemy.text(
                    "INSERT INTO shorts_queue (bno, video_type, quality_score, priority, status, reg_date) "
                    "VALUES (:bno, :vtype, :qscore, :priority, 0, SYSDATE)"
                ),
                {
                    "bno": bno,
                    "vtype": video_type,
                    "qscore": float(req_data.get('quality_score', 5.0)),
                    "priority": int(req_data.get('priority', 5))
                }
            )
            logger.info(f"BNO={bno}: shorts_queue 신규 INSERT (TYPE={video_type})")

    except Exception as e:
        logger.error(f"shorts_queue 준비 실패 (BNO={bno}): {e}", exc_info=True)


@app.route('/api/generate', methods=['POST'])
@require_api_key  # PR-PY-01: 인증 필수
def generate_shorts() -> Dict[str, Any]:
    """쇼츠 생성 실행 (edge-tts) - 인증 필수"""
    try:
        data = request.json
        if not data or 'bno' not in data:
            return jsonify({"success": False, "error": "bno 필수"}), 400

        bno: int = int(data['bno'])
        video_type: str = data.get('video_type', 'INFO')

        logger.info(f"제작 요청 수신: BNO={bno}, TYPE={video_type}")

        # 동일 BNO 동시 제작 방지
        with _generating_lock:
            if bno in _generating_bnos:
                logger.warning(f"BNO={bno}: 이미 제작 진행 중 - 중복 요청 거부")
                return jsonify({"success": False, "error": f"BNO={bno} 이미 제작 중"}), 409
            _generating_bnos.add(bno)

        try:
            # shorts_queue에 status=0 레코드 보장 (없으면 생성/초기화)
            _ensure_queue_ready(bno, video_type, data)

            target = get_target_by_bno(bno)
            if not target:
                return jsonify({"success": False, "error": f"BNO={bno} 없음"}), 404

            # OpenAI로 대본 생성
            script = generate_script_with_openai(target, video_type)
            if not script:
                return jsonify({"success": False, "error": "대본 생성 실패"}), 500

            # edge-tts로 렌더링
            result = render_video_with_persona(script, target)
            if not result:
                return jsonify({"success": False, "error": "렌더링 실패"}), 500

            return jsonify({
                "success": True,
                "data": {
                    "bno": bno,
                    "title": target['title'],
                    "video_path": result['video_path'],
                    "thumbnail_path": result['thumbnail_path'],
                    "video_type": video_type,
                    "quality_score": target.get('quality_score', 0),
                    "tts_engine": "edge-tts"
                }
            })
        finally:
            with _generating_lock:
                _generating_bnos.discard(bno)

    except Exception as e:
        logger.error(f"생성 실패: {e}", exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/api/trends', methods=['GET'])
def get_trends() -> Dict[str, Any]:
    """트렌드 분석 (인증 불필요)"""
    try:
        days = int(request.args.get('days', 7))
        analyzer = TrendAnalyzer(DB_ENGINE)
        trends = analyzer.analyze_recent_trends(days=days)
        return jsonify({"success": True, "data": trends[:20]})
    except Exception as e:
        logger.error(f"❌ 트렌드 조회 실패: {e}", exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/api/queue', methods=['GET'])
def get_queue() -> Dict[str, Any]:
    """큐 목록 조회 (인증 불필요)"""
    try:
        query: str = """
                     SELECT
                         q.sq_no, b.bno, b.title, b.hit,
                         q.video_type, q.quality_score, q.priority,
                         q.status, q.reg_date
                     FROM shorts_queue q
                              JOIN AI_BOARD b ON q.bno = b.bno
                     ORDER BY q.priority DESC, q.quality_score DESC \
                     """

        with DB_ENGINE.connect() as conn:
            result = conn.execute(sqlalchemy.text(query))
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


def main() -> None:
    """API 서버 실행"""
    logger.info("🚀 Python 쇼츠 공장 API 서버 시작 (edge-tts 무료 90% 버전)")
    logger.info(f"📍 Listen on {PYTHON_API_HOST}:{PYTHON_API_PORT}")
    app.run(host=PYTHON_API_HOST, port=PYTHON_API_PORT, debug=False)


if __name__ == "__main__":
    main()
