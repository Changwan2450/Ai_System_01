"""
업로드 스케줄러
- 시간대별 최적 업로드 타이밍
- 요일별 전략
- 스팸 방지 분산
"""
import logging
from typing import Dict, Any, List, Optional
from datetime import datetime, timedelta
import pytz

import sqlalchemy
from sqlalchemy.engine import Engine

from config import BASE_DIR, DB_CONNECTION_STRING, LOG_FORMAT, LOG_LEVEL

# ===============================
# 로깅 설정
# ===============================
logging.basicConfig(level=LOG_LEVEL, format=LOG_FORMAT)
logger = logging.getLogger(__name__)


# ===============================
# 업로드 스케줄러
# ===============================
class UploadScheduler:
    """유튜브 최적 업로드 시간 관리"""

    def __init__(self, db_engine: Engine, timezone: str = 'Asia/Seoul'):
        self.engine = db_engine
        self.tz = pytz.timezone(timezone)

        # 시간대별 업로드 전략 (KST 기준)
        self.upload_slots = {
            'weekday': [
                {'hour': 7, 'minute': 30},   # 출근 시간
                {'hour': 12, 'minute': 0},   # 점심 시간
                {'hour': 18, 'minute': 30},  # 퇴근 시간
                {'hour': 21, 'minute': 0}    # 저녁 시간
            ],
            'weekend': [
                {'hour': 10, 'minute': 0},   # 주말 아침
                {'hour': 15, 'minute': 0},   # 오후
                {'hour': 20, 'minute': 0}    # 저녁
            ]
        }

    def get_next_upload_time(self, video_type: str) -> datetime:
        """
        다음 업로드 최적 시간 계산

        Args:
            video_type: AGRO 또는 INFO

        Returns:
            업로드 예정 시간 (datetime)
        """
        now = datetime.now(self.tz)

        # 오늘 이미 예약된 업로드 확인
        today_uploads = self._get_today_upload_count()

        # 하루 최대 4개 제한 (스팸 방지)
        if today_uploads >= 4:
            # 내일로 넘김
            next_day = now + timedelta(days=1)
            target_time = self._get_first_slot_of_day(next_day)
        else:
            # 오늘 다음 슬롯
            target_time = self._get_next_available_slot(now)

        logger.info(f"📅 다음 업로드 시간: {target_time.strftime('%Y-%m-%d %H:%M')}")
        return target_time

    def _get_today_upload_count(self) -> int:
        """오늘 예약된 업로드 수"""
        query = """
                SELECT COUNT(*)
                FROM upload_schedule
                WHERE TRUNC(scheduled_time) = TRUNC(SYSDATE)
                  AND status IN ('PENDING', 'SCHEDULED') \
                """

        try:
            with self.engine.connect() as conn:
                result = conn.execute(sqlalchemy.text(query)).scalar()
                return int(result or 0)
        except Exception as e:
            logger.error(f"❌ 오늘 업로드 수 조회 실패: {e}")
            return 0

    def _get_next_available_slot(self, current_time: datetime) -> datetime:
        """다음 가능한 업로드 슬롯"""
        is_weekend = current_time.weekday() >= 5
        day_type = 'weekend' if is_weekend else 'weekday'
        slots = self.upload_slots[day_type]

        for slot in slots:
            slot_time = current_time.replace(
                hour=slot['hour'],
                minute=slot['minute'],
                second=0,
                microsecond=0
            )

            # 현재 시간보다 이후면 사용
            if slot_time > current_time:
                # 이미 예약된 시간인지 확인
                if not self._is_slot_taken(slot_time):
                    return slot_time

        # 오늘 슬롯 다 찼으면 내일 첫 슬롯
        next_day = current_time + timedelta(days=1)
        return self._get_first_slot_of_day(next_day)

    def _get_first_slot_of_day(self, target_date: datetime) -> datetime:
        """특정 날짜의 첫 업로드 슬롯"""
        is_weekend = target_date.weekday() >= 5
        day_type = 'weekend' if is_weekend else 'weekday'
        first_slot = self.upload_slots[day_type][0]

        return target_date.replace(
            hour=first_slot['hour'],
            minute=first_slot['minute'],
            second=0,
            microsecond=0
        )

    def _is_slot_taken(self, slot_time: datetime) -> bool:
        """해당 시간에 이미 예약 있는지 확인"""
        query = """
                SELECT COUNT(*)
                FROM upload_schedule
                WHERE scheduled_time = :slot_time
                  AND status IN ('PENDING', 'SCHEDULED') \
                """

        try:
            with self.engine.connect() as conn:
                result = conn.execute(
                    sqlalchemy.text(query),
                    {"slot_time": slot_time}
                ).scalar()
                return int(result or 0) > 0
        except Exception as e:
            logger.error(f"❌ 슬롯 확인 실패: {e}")
            return False

    def schedule_upload(self, bno: int, video_type: str) -> Optional[datetime]:
        """
        업로드 스케줄 등록

        Args:
            bno: 게시글 번호
            video_type: 영상 타입

        Returns:
            예약 시간
        """
        scheduled_time = self.get_next_upload_time(video_type)

        query = """
                INSERT INTO upload_schedule (schedule_id, bno, scheduled_time, status)
                VALUES (upload_schedule_seq.NEXTVAL, :bno, :scheduled_time, 'SCHEDULED') \
                """

        try:
            with self.engine.connect() as conn:
                with conn.begin():
                    conn.execute(
                        sqlalchemy.text(query),
                        {"bno": bno, "scheduled_time": scheduled_time}
                    )

            logger.info(f"✅ 업로드 예약: BNO={bno}, 시간={scheduled_time}")
            return scheduled_time

        except Exception as e:
            logger.error(f"❌ 스케줄 등록 실패: {e}", exc_info=True)
            return None

    def get_pending_uploads(self) -> List[Dict[str, Any]]:
        """
        현재 시간 기준 업로드할 영상 조회

        Returns:
            업로드 대상 리스트
        """
        query = """
                SELECT us.schedule_id, us.bno, sq.video_path, sq.video_type,
                       b.title, us.scheduled_time
                FROM upload_schedule us
                         JOIN shorts_queue sq ON us.bno = sq.bno
                         JOIN AI_BOARD b ON us.bno = b.bno
                WHERE us.status = 'SCHEDULED'
                  AND us.scheduled_time <= SYSDATE
                  AND sq.status = 1
                ORDER BY us.scheduled_time \
                """

        try:
            with self.engine.connect() as conn:
                result = conn.execute(sqlalchemy.text(query))
                rows = result.fetchall()

                uploads = []
                for row in rows:
                    uploads.append({
                        'schedule_id': row[0],
                        'bno': row[1],
                        'video_path': row[2],
                        'video_type': row[3],
                        'title': row[4],
                        'scheduled_time': row[5]
                    })

                return uploads

        except Exception as e:
            logger.error(f"❌ 대기 업로드 조회 실패: {e}", exc_info=True)
            return []

    def mark_as_uploaded(self, schedule_id: int, video_id: str) -> None:
        """업로드 완료 표시"""
        query = """
                UPDATE upload_schedule
                SET status = 'UPLOADED',
                    uploaded_time = SYSDATE
                WHERE schedule_id = :schedule_id \
                """

        try:
            with self.engine.connect() as conn:
                with conn.begin():
                    conn.execute(
                        sqlalchemy.text(query),
                        {"schedule_id": schedule_id}
                    )

            logger.info(f"✅ 업로드 완료 표시: schedule_id={schedule_id}, video_id={video_id}")

        except Exception as e:
            logger.error(f"❌ 업로드 완료 표시 실패: {e}")


# ===============================
# 하위 호환 함수
# ===============================
def schedule_next_upload(engine: Engine, bno: int, video_type: str) -> Optional[datetime]:
    """하위 호환용"""
    scheduler = UploadScheduler(engine)
    return scheduler.schedule_upload(bno, video_type)