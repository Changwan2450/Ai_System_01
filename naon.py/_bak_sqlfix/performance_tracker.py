"""
성과 추적 모듈
- YouTube Analytics API 연동
- 조회수/좋아요/댓글 수집
- A/B 테스트 분석
"""
import logging
from typing import Dict, Any, List, Optional
from datetime import datetime, timedelta

import sqlalchemy
from sqlalchemy.engine import Engine

from config import BASE_DIR, DB_CONNECTION_STRING, LOG_FORMAT, LOG_LEVEL

# ===============================
# 로깅 설정
# ===============================
logging.basicConfig(level=LOG_LEVEL, format=LOG_FORMAT)
logger = logging.getLogger(__name__)


# ===============================
# 성과 추적기
# ===============================
class PerformanceTracker:
    """쇼츠 성과 추적 및 분석"""

    def __init__(self, db_engine: Engine):
        self.engine = db_engine

    def record_performance(
            self,
            video_id: str,
            bno: int,
            views: int = 0,
            likes: int = 0,
            comments: int = 0,
            shares: int = 0,
            ctr: float = 0.0,
            avg_view_duration: float = 0.0
    ) -> bool:
        """
        성과 데이터 기록

        Args:
            video_id: YouTube 영상 ID
            bno: 게시글 번호
            views: 조회수
            likes: 좋아요
            comments: 댓글 수
            shares: 공유 수
            ctr: 클릭률
            avg_view_duration: 평균 시청 시간(초)

        Returns:
            성공 여부
        """
        query = """
            MERGE INTO shorts_performance sp
            USING (SELECT :video_id as video_id FROM dual) src
            ON (sp.video_id = src.video_id)
            WHEN MATCHED THEN
                UPDATE SET
                    views = :views,
                    likes = :likes,
                    comments = :comments,
                    shares = :shares,
                    ctr = :ctr,
                    avg_view_duration = :avg_view_duration,
                    last_updated = SYSDATE
            WHEN NOT MATCHED THEN
                INSERT (video_id, bno, views, likes, comments, shares, ctr, avg_view_duration)
                VALUES (:video_id, :bno, :views, :likes, :comments, :shares, :ctr, :avg_view_duration)
        """

        try:
            with self.engine.connect() as conn:
                with conn.begin():
                    conn.execute(
                        sqlalchemy.text(query),
                        {
                            "video_id": video_id,
                            "bno": bno,
                            "views": views,
                            "likes": likes,
                            "comments": comments,
                            "shares": shares,
                            "ctr": ctr,
                            "avg_view_duration": avg_view_duration
                        }
                    )

            logger.info(f"✅ 성과 기록: video_id={video_id}, views={views}")
            return True

        except Exception as e:
            logger.error(f"❌ 성과 기록 실패: {e}", exc_info=True)
            return False

    def get_performance_stats(self, days: int = 30) -> Dict[str, Any]:
        """
        최근 N일 성과 통계

        Returns:
            {
                'total_videos': 10,
                'total_views': 50000,
                'avg_views': 5000,
                'avg_ctr': 0.05,
                'top_performer': {...}
            }
        """
        query = """
                SELECT
                    COUNT(*) as total_videos,
                    SUM(views) as total_views,
                    AVG(views) as avg_views,
                    AVG(ctr) as avg_ctr,
                    AVG(avg_view_duration) as avg_duration,
                    MAX(views) as max_views
                FROM shorts_performance
                WHERE created_date > SYSDATE - :days \
                """

        try:
            with self.engine.connect() as conn:
                result = conn.execute(sqlalchemy.text(query), {"days": days}).fetchone()

                if not result:
                    return self._empty_stats()

                # 최고 성과 영상
                top_query = """
                            SELECT sp.video_id, sp.views, sp.likes, b.title
                            FROM shorts_performance sp
                                     JOIN AI_BOARD b ON sp.bno = b.bno
                            WHERE sp.created_date > SYSDATE - :days
                            ORDER BY sp.views DESC
                                FETCH FIRST 1 ROWS ONLY \
                            """

                top_result = conn.execute(sqlalchemy.text(top_query), {"days": days}).fetchone()

                stats = {
                    'total_videos': int(result[0] or 0),
                    'total_views': int(result[1] or 0),
                    'avg_views': float(result[2] or 0),
                    'avg_ctr': float(result[3] or 0),
                    'avg_duration': float(result[4] or 0),
                    'max_views': int(result[5] or 0)
                }

                if top_result:
                    stats['top_performer'] = {
                        'video_id': top_result[0],
                        'views': int(top_result[1]),
                        'likes': int(top_result[2]),
                        'title': top_result[3]
                    }

                return stats

        except Exception as e:
            logger.error(f"❌ 성과 통계 조회 실패: {e}", exc_info=True)
            return self._empty_stats()

    def analyze_video_type_performance(self) -> Dict[str, Dict[str, float]]:
        """
        비디오 타입별 성과 비교 (AGRO vs INFO)

        Returns:
            {
                'AGRO': {'avg_views': 8000, 'avg_ctr': 0.06},
                'INFO': {'avg_views': 4000, 'avg_ctr': 0.04}
            }
        """
        query = """
                SELECT
                    sq.video_type,
                    AVG(sp.views) as avg_views,
                    AVG(sp.ctr) as avg_ctr,
                    AVG(sp.avg_view_duration) as avg_duration,
                    COUNT(*) as video_count
                FROM shorts_performance sp
                         JOIN shorts_queue sq ON sp.bno = sq.bno
                WHERE sp.created_date > SYSDATE - 30
                GROUP BY sq.video_type \
                """

        try:
            with self.engine.connect() as conn:
                result = conn.execute(sqlalchemy.text(query))
                rows = result.fetchall()

                analysis = {}
                for row in rows:
                    video_type = row[0]
                    analysis[video_type] = {
                        'avg_views': float(row[1] or 0),
                        'avg_ctr': float(row[2] or 0),
                        'avg_duration': float(row[3] or 0),
                        'video_count': int(row[4] or 0)
                    }

                logger.info(f"✅ 타입별 분석 완료: {list(analysis.keys())}")
                return analysis

        except Exception as e:
            logger.error(f"❌ 타입별 분석 실패: {e}", exc_info=True)
            return {}

    def get_learning_insights(self) -> List[str]:
        """
        데이터 기반 학습 인사이트

        Returns:
            ['AGRO 타입이 INFO보다 평균 2배 높은 조회수', ...]
        """
        insights = []

        # 타입별 비교
        type_analysis = self.analyze_video_type_performance()

        if 'AGRO' in type_analysis and 'INFO' in type_analysis:
            agro_views = type_analysis['AGRO']['avg_views']
            info_views = type_analysis['INFO']['avg_views']

            if agro_views > info_views * 1.5:
                ratio = agro_views / info_views if info_views > 0 else 0
                insights.append(
                    f"🔥 AGRO 타입이 INFO보다 평균 {ratio:.1f}배 높은 조회수를 기록 중입니다."
                )
            elif info_views > agro_views * 1.5:
                ratio = info_views / agro_views if agro_views > 0 else 0
                insights.append(
                    f"📚 INFO 타입이 AGRO보다 평균 {ratio:.1f}배 높은 조회수를 기록 중입니다."
                )

        # 전체 통계
        stats = self.get_performance_stats(days=30)

        if stats['avg_views'] > 5000:
            insights.append(f"✅ 평균 조회수 {int(stats['avg_views']):,}회로 양호한 성과입니다.")
        elif stats['avg_views'] < 1000:
            insights.append(f"⚠️ 평균 조회수 {int(stats['avg_views']):,}회로 개선이 필요합니다.")

        if stats['avg_ctr'] > 0.05:
            insights.append(f"✅ 클릭률 {stats['avg_ctr']:.2%}로 좋은 썸네일 효과를 보고 있습니다.")

        return insights

    def _empty_stats(self) -> Dict[str, Any]:
        """빈 통계"""
        return {
            'total_videos': 0,
            'total_views': 0,
            'avg_views': 0,
            'avg_ctr': 0,
            'avg_duration': 0,
            'max_views': 0
        }


# ===============================
# 하위 호환 함수
# ===============================
def track_performance(
        engine: Engine,
        video_id: str,
        bno: int,
        views: int,
        likes: int
) -> bool:
    """하위 호환용"""
    tracker = PerformanceTracker(engine)
    return tracker.record_performance(video_id, bno, views, likes)