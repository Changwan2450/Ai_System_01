"""
댓글 감성 분석 모듈
- VADER Sentiment Analysis
- 긍정/부정/중립 판단
- 품질 점수 산출
"""
import logging
from typing import List, Dict, Any, Tuple
from pathlib import Path

from vaderSentiment.vaderSentiment import SentimentIntensityAnalyzer
import sqlalchemy
from sqlalchemy.engine import Engine

from config import BASE_DIR, DB_CONNECTION_STRING, LOG_FORMAT, LOG_LEVEL

# ===============================
# 로깅 설정
# ===============================
logging.basicConfig(level=LOG_LEVEL, format=LOG_FORMAT)
logger = logging.getLogger(__name__)

# VADER 분석기
analyzer = SentimentIntensityAnalyzer()


# ===============================
# 감성 분석기
# ===============================
class SentimentAnalyzer:
    """댓글 감성 분석 및 품질 평가"""

    def __init__(self, db_engine: Engine):
        self.engine = db_engine
        self.analyzer = analyzer

    def analyze_text(self, text: str) -> Dict[str, float]:
        """
        텍스트 감성 분석

        Returns:
            {'pos': 0.5, 'neg': 0.1, 'neu': 0.4, 'compound': 0.8}
        """
        return self.analyzer.polarity_scores(text)

    def classify_sentiment(self, compound_score: float) -> str:
        """
        Compound 점수 기반 분류

        Returns:
            'positive', 'negative', 'neutral'
        """
        if compound_score >= 0.05:
            return 'positive'
        elif compound_score <= -0.05:
            return 'negative'
        else:
            return 'neutral'

    def analyze_board_replies(self, bno: int) -> Dict[str, Any]:
        """
        게시글의 모든 댓글 감성 분석

        Returns:
            {
                'total_replies': 10,
                'positive_ratio': 0.7,
                'negative_ratio': 0.1,
                'neutral_ratio': 0.2,
                'avg_score': 0.45,
                'quality_score': 8.5
            }
        """
        query = """
                SELECT r.rno, r.content
                FROM AI_REPLY r
                WHERE r.bno = :bno \
                """

        try:
            with self.engine.connect() as conn:
                result = conn.execute(sqlalchemy.text(query), {"bno": bno})
                replies = result.fetchall()

                if not replies:
                    return {
                        'total_replies': 0,
                        'positive_ratio': 0,
                        'negative_ratio': 0,
                        'neutral_ratio': 0,
                        'avg_score': 0,
                        'quality_score': 0
                    }

                sentiments = []
                scores = []

                for rno, content in replies:
                    sentiment = self.analyze_text(content)
                    compound = sentiment['compound']

                    sentiments.append(self.classify_sentiment(compound))
                    scores.append(compound)

                    # DB에 저장
                    self._save_sentiment(rno, self.classify_sentiment(compound), compound)

                # 통계 계산
                total = len(sentiments)
                positive_count = sentiments.count('positive')
                negative_count = sentiments.count('negative')
                neutral_count = sentiments.count('neutral')
                avg_score = sum(scores) / total if total > 0 else 0

                # 품질 점수 (0~10)
                quality_score = self._calculate_quality_score(
                    positive_count / total,
                    negative_count / total,
                    avg_score,
                    total
                )

                return {
                    'total_replies': total,
                    'positive_ratio': positive_count / total,
                    'negative_ratio': negative_count / total,
                    'neutral_ratio': neutral_count / total,
                    'avg_score': avg_score,
                    'quality_score': quality_score
                }

        except Exception as e:
            logger.error(f"❌ 감성 분석 실패 (bno={bno}): {e}", exc_info=True)
            return {
                'total_replies': 0,
                'positive_ratio': 0,
                'negative_ratio': 0,
                'neutral_ratio': 0,
                'avg_score': 0,
                'quality_score': 0
            }

    def _calculate_quality_score(
            self,
            pos_ratio: float,
            neg_ratio: float,
            avg_score: float,
            reply_count: int
    ) -> float:
        """
        품질 점수 산출 (0~10)

        가중치:
        - 긍정 비율: 40%
        - 부정 비율: -30%
        - 평균 점수: 20%
        - 댓글 수: 10%
        """
        score = 0.0

        # 긍정 비율 (0~4점)
        score += pos_ratio * 4.0

        # 부정 비율 (0~-3점)
        score -= neg_ratio * 3.0

        # 평균 감성 점수 (0~2점)
        score += (avg_score + 1) * 1.0  # -1~1을 0~2로 변환

        # 댓글 수 보너스 (0~1점)
        score += min(reply_count / 10.0, 1.0)

        return max(0, min(10, score))

    def _save_sentiment(self, rno: int, sentiment: str, score: float) -> None:
        """감성 분석 결과 DB 저장"""
        query = """
            MERGE INTO reply_sentiment rs
            USING (SELECT :rno as rno FROM dual) src
            ON (rs.rno = src.rno)
            WHEN MATCHED THEN
                UPDATE SET sentiment = :sentiment, score = :score, analyzed_date = SYSDATE
            WHEN NOT MATCHED THEN
                INSERT (rno, sentiment, score) VALUES (:rno, :sentiment, :score)
        """

        try:
            with self.engine.connect() as conn:
                with conn.begin():
                    conn.execute(
                        sqlalchemy.text(query),
                        {"rno": rno, "sentiment": sentiment, "score": score}
                    )
        except Exception as e:
            logger.error(f"❌ 감성 저장 실패 (rno={rno}): {e}")


# ===============================
# 하위 호환 함수
# ===============================
def analyze_board_sentiment(engine: Engine, bno: int) -> Dict[str, Any]:
    """하위 호환용"""
    analyzer = SentimentAnalyzer(engine)
    return analyzer.analyze_board_replies(bno)