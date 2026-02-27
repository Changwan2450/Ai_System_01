"""
쇼츠 자동화 오케스트레이터 (edge-tts 버전)
"""
import time
import logging
from typing import Dict, Any

import sqlalchemy
from sqlalchemy.engine import Engine

from config import BASE_DIR, DB_CONNECTION_STRING, LOG_FORMAT, LOG_LEVEL
from smart_curator import SmartCurator
from shorts_generator import (
    get_target_by_bno,
    generate_script_with_openai,
    render_video_with_persona
)
from persona_manager import persona_manager
from trend_analyzer import TrendAnalyzer
from upload_scheduler import UploadScheduler
from upload_youtube import upload_video

logging.basicConfig(
    level=LOG_LEVEL,
    format=LOG_FORMAT,
    handlers=[
        logging.FileHandler(BASE_DIR / "main.log", encoding='utf-8'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

engine: Engine = sqlalchemy.create_engine(DB_CONNECTION_STRING)

CURATE_INTERVAL = 1800  # 30분
PRODUCTION_INTERVAL = 300  # 5분
UPLOAD_CHECK_INTERVAL = 600  # 10분


def run_curation() -> None:
    """주기적 큐레이션"""
    try:
        logger.info("🎯 큐레이션 시작...")

        trend_analyzer = TrendAnalyzer(engine)
        trend_analyzer.analyze_recent_trends(days=7)

        curator = SmartCurator(engine)
        result = curator.curate_premium(
            agro_count=2,
            info_count=2,
            min_quality_score=6.5
        )

        for item in result['agro'] + result['info']:
            _add_to_queue(item)

        logger.info(f"✅ 큐레이션 완료: {len(result['agro']) + len(result['info'])}개")

    except Exception as e:
        logger.error(f"❌ 큐레이션 실패: {e}", exc_info=True)


def _add_to_queue(item: Dict[str, Any]) -> None:
    """큐에 추가"""
    query = """
        MERGE INTO shorts_queue sq
        USING (SELECT :bno as bno FROM dual) src
        ON (sq.bno = src.bno)
        WHEN NOT MATCHED THEN
            INSERT (bno, video_type, quality_score, priority, status)
            VALUES (:bno, :video_type, :quality_score, :priority, 0)
    """

    try:
        with engine.connect() as conn:
            with conn.begin():
                conn.execute(
                    sqlalchemy.text(query),
                    {
                        "bno": item['bno'],
                        "video_type": item['video_type'],
                        "quality_score": item.get('quality_score', 5.0),
                        "priority": item.get('priority', 5)
                    }
                )
        logger.info(f"✅ 큐 추가: BNO={item['bno']}")
    except Exception as e:
        logger.error(f"❌ 큐 추가 실패: {e}")


def run_production() -> None:
    """대기 중인 쇼츠 제작 (edge-tts)"""
    try:
        query = """
                SELECT b.bno
                FROM shorts_queue q
                         JOIN AI_BOARD b ON q.bno = b.bno
                WHERE q.status = 0
                ORDER BY q.priority DESC, q.quality_score DESC
                    FETCH FIRST 1 ROWS ONLY \
                """

        with engine.connect() as conn:
            result = conn.execute(sqlalchemy.text(query)).fetchone()

            if not result:
                logger.debug("📭 제작 대기 없음")
                return

            bno = result[0]

        logger.info(f"🎬 제작 시작: BNO={bno} (edge-tts)")

        target = get_target_by_bno(bno)
        if not target:
            logger.error(f"❌ BNO={bno} 없음")
            return

        video_type = target.get('video_type', 'INFO')
        script = generate_script_with_openai(target, video_type)

        if not script:
            logger.error(f"❌ 대본 생성 실패: BNO={bno}")
            return

        result = render_video_with_persona(script, target)

        if result:
            logger.info(f"✅ 제작 완료 (edge-tts): {result['video_path']}")
        else:
            logger.error(f"❌ 렌더링 실패: BNO={bno}")

    except Exception as e:
        logger.error(f"❌ 제작 실패: {e}", exc_info=True)


def run_scheduled_upload() -> None:
    """예약된 시간에 업로드"""
    try:
        scheduler = UploadScheduler(engine)
        pending = scheduler.get_pending_uploads()

        if not pending:
            logger.debug("📭 업로드 대기 없음")
            return

        for item in pending:
            logger.info(f"☁️ 업로드 시작: {item['title']}")

            upload_result = upload_video(
                video_file=item['video_path'],
                title=f"[AI {'렉카' if item['video_type'] == 'AGRO' else '해설'}] {item['title']}",
                description=f"edge-tts로 제작된 AI 쇼츠\n\n#AI #기술 #Shorts",
                tags=["AI", "기술", "Shorts", item['video_type']],
                privacy_status="public"
            )

            if upload_result['success']:
                video_id = upload_result['video_id']
                logger.info(f"✅ 업로드 성공: {video_id}")
                scheduler.mark_as_uploaded(item['schedule_id'], video_id)
            else:
                logger.error(f"❌ 업로드 실패: {upload_result['error']}")

    except Exception as e:
        logger.error(f"❌ 업로드 실패: {e}", exc_info=True)


def main_loop() -> None:
    """메인 자동화 루프"""
    logger.info("🏭 쇼츠 공장 가동 시작 (edge-tts 무료 90% 버전)")

    persona_manager.fetch_all_personas()

    last_curate = 0
    last_produce = 0
    last_upload_check = 0
    iteration = 0

    while True:
        iteration += 1
        current_time = time.time()

        try:
            logger.info(f"\n{'='*60}")
            logger.info(f"🔄 작업 사이클 #{iteration} (edge-tts)")
            logger.info(f"{'='*60}\n")

            if current_time - last_curate >= CURATE_INTERVAL:
                run_curation()
                last_curate = current_time

            if current_time - last_produce >= PRODUCTION_INTERVAL:
                run_production()
                last_produce = current_time

            if current_time - last_upload_check >= UPLOAD_CHECK_INTERVAL:
                run_scheduled_upload()
                last_upload_check = current_time

            logger.info(f"⏳ 60초 대기...\n")
            time.sleep(60)

        except KeyboardInterrupt:
            logger.info("\n⚠️ 공장 가동 중지")
            break
        except Exception as e:
            logger.error(f"❌ 예상치 못한 오류: {e}", exc_info=True)
            time.sleep(60)

    logger.info("🛑 공장 가동 종료")


def main() -> None:
    """메인 실행 함수"""
    try:
        main_loop()
    except Exception as e:
        logger.critical(f"❌ 치명적 오류: {e}", exc_info=True)


if __name__ == "__main__":
    main()