"""
키워드 트렌드 분석 모듈
- 게시글에서 핫 키워드 추출
- 시간대별 트렌드 점수 계산
- 트렌딩 주제 예측
"""
import logging
import re
from typing import List, Dict, Any, Tuple
from collections import Counter
from datetime import datetime, timedelta

import sqlalchemy
from sqlalchemy.engine import Engine
import pandas as pd

from config import BASE_DIR, DB_CONNECTION_STRING, LOG_FORMAT, LOG_LEVEL

# ===============================
# 로깅 설정
# ===============================
logging.basicConfig(level=LOG_LEVEL, format=LOG_FORMAT)
logger = logging.getLogger(__name__)


# ===============================
# 트렌드 분석기
# ===============================
class TrendAnalyzer:
    """키워드 트렌드 분석 및 예측"""

    def __init__(self, db_engine: Engine):
        self.engine = db_engine

        # AI/기술 관련 중요 키워드 (수동 정의)
        self.important_keywords = {
            'GPT', 'Claude', 'Gemini', 'LLM', 'AI', '인공지능',
            'ChatGPT', 'OpenAI', 'Anthropic', 'Google',
            '딥러닝', '머신러닝', '트랜스포머', 'NVIDIA',
            'GPU', '반도체', '오픈소스', 'API', '모델', '학습'
        }

    def extract_keywords(self, text: str) -> List[str]:
        """
        텍스트에서 키워드 추출

        규칙:
        - 한글 2글자 이상
        - 영문 3글자 이상 (대문자 포함)
        - 숫자+영문 조합 (GPT-4 등)
        """
        keywords = []

        # 한글 키워드 (2글자 이상)
        korean_pattern = r'[가-힣]{2,}'
        keywords.extend(re.findall(korean_pattern, text))

        # 영문 키워드 (3글자 이상, 대문자 포함)
        english_pattern = r'[A-Z][A-Za-z0-9\-]{2,}'
        keywords.extend(re.findall(english_pattern, text))

        # 중요 키워드 필터링
        filtered = [k for k in keywords if k in self.important_keywords or len(k) >= 3]

        return filtered

    def analyze_recent_trends(self, days: int = 7) -> List[Dict[str, Any]]:
        """
        최근 N일간 트렌드 분석

        Returns:
            [
                {
                    'keyword': 'GPT-4',
                    'frequency': 15,
                    'avg_hit': 120.5,
                    'avg_reply': 8.2,
                    'trend_score': 9.3
                }
            ]
        """
        query = """
                SELECT b.title, b.content, b.hit,
                       (SELECT COUNT(*) FROM AI_REPLY r WHERE r.bno = b.bno) as reply_count
                FROM AI_BOARD b
                WHERE b.regdate > SYSDATE - :days
                ORDER BY b.regdate DESC \
                """

        try:
            with self.engine.connect() as conn:
                df = pd.read_sql(
                    sqlalchemy.text(query),
                    conn,
                    params={"days": days}
                )

                if df.empty:
                    logger.warning("⚠️ 최근 게시글 없음")
                    return []

                # 키워드 추출 및 통계
                keyword_stats = {}

                for _, row in df.iterrows():
                    text = f"{row['title']} {row['content']}"
                    keywords = self.extract_keywords(text)

                    for keyword in keywords:
                        if keyword not in keyword_stats:
                            keyword_stats[keyword] = {
                                'frequency': 0,
                                'total_hit': 0,
                                'total_reply': 0
                            }

                        keyword_stats[keyword]['frequency'] += 1
                        keyword_stats[keyword]['total_hit'] += row['hit']
                        keyword_stats[keyword]['total_reply'] += row['reply_count']

                # 트렌드 점수 계산
                trends = []
                for keyword, stats in keyword_stats.items():
                    freq = stats['frequency']

                    if freq < 2:  # 2회 미만 등장은 제외
                        continue

                    avg_hit = stats['total_hit'] / freq
                    avg_reply = stats['total_reply'] / freq

                    # 트렌드 점수 (0~10)
                    trend_score = self._calculate_trend_score(freq, avg_hit, avg_reply)

                    trends.append({
                        'keyword': keyword,
                        'frequency': freq,
                        'avg_hit': avg_hit,
                        'avg_reply': avg_reply,
                        'trend_score': trend_score
                    })

                # 점수 순 정렬
                trends.sort(key=lambda x: x['trend_score'], reverse=True)

                # DB 저장
                self._save_trends(trends)

                logger.info(f"✅ 트렌드 분석 완료: {len(trends)}개 키워드")
                return trends

        except Exception as e:
            logger.error(f"❌ 트렌드 분석 실패: {e}", exc_info=True)
            return []

    def _calculate_trend_score(
            self,
            frequency: int,
            avg_hit: float,
            avg_reply: float
    ) -> float:
        """
        트렌드 점수 산출 (0~10)

        가중치:
        - 빈도: 30%
        - 평균 조회수: 40%
        - 평균 댓글: 30%
        """
        # 빈도 점수 (0~3점)
        freq_score = min(frequency / 5.0 * 3.0, 3.0)

        # 조회수 점수 (0~4점)
        hit_score = min(avg_hit / 100.0 * 4.0, 4.0)

        # 댓글 점수 (0~3점)
        reply_score = min(avg_reply / 5.0 * 3.0, 3.0)

        return freq_score + hit_score + reply_score

    def _save_trends(self, trends: List[Dict[str, Any]]) -> None:
        """트렌드 데이터 DB 저장"""
        query = """
            MERGE INTO keyword_trends kt
            USING (SELECT :keyword as keyword FROM dual) src
            ON (kt.keyword = src.keyword)
            WHEN MATCHED THEN
                UPDATE SET 
                    frequency = :frequency,
                    avg_hit = :avg_hit,
                    avg_reply_count = :avg_reply,
                    trend_score = :trend_score,
                    last_seen = SYSDATE
            WHEN NOT MATCHED THEN
                INSERT (keyword_id, keyword, frequency, avg_hit, avg_reply_count, trend_score)
                VALUES (keyword_trends_seq.NEXTVAL, :keyword, :frequency, :avg_hit, :avg_reply, :trend_score)
        """

        try:
            with self.engine.connect() as conn:
                with conn.begin():
                    for trend in trends:
                        conn.execute(
                            sqlalchemy.text(query),
                            {
                                "keyword": trend['keyword'],
                                "frequency": trend['frequency'],
                                "avg_hit": trend['avg_hit'],
                                "avg_reply": trend['avg_reply'],
                                "trend_score": trend['trend_score']
                            }
                        )
            logger.info(f"✅ 트렌드 {len(trends)}개 저장 완료")
        except Exception as e:
            logger.error(f"❌ 트렌드 저장 실패: {e}", exc_info=True)

    def get_top_trends(self, limit: int = 10) -> List[str]:
        """
        상위 트렌드 키워드 조회

        Returns:
            ['GPT-4', 'Claude', 'NVIDIA', ...]
        """
        query = """
                SELECT keyword
                FROM keyword_trends
                WHERE last_seen > SYSDATE - 7
                ORDER BY trend_score DESC
                    FETCH FIRST :limit ROWS ONLY \
                """

        try:
            with self.engine.connect() as conn:
                result = conn.execute(sqlalchemy.text(query), {"limit": limit})
                keywords = [row[0] for row in result.fetchall()]
                return keywords
        except Exception as e:
            logger.error(f"❌ 트렌드 조회 실패: {e}", exc_info=True)
            return []


# ===============================
# 하위 호환 함수
# ===============================
def analyze_trends(engine: Engine, days: int = 7) -> List[Dict[str, Any]]:
    """하위 호환용"""
    analyzer = TrendAnalyzer(engine)
    return analyzer.analyze_recent_trends(days)