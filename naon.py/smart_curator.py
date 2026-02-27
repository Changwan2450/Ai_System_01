"""
스마트 큐레이터 (OpenAI 버전)
"""
import logging
from typing import List, Dict, Any, Tuple
from pathlib import Path

import pandas as pd
import torch
from sentence_transformers import SentenceTransformer, util
import sqlalchemy
from sqlalchemy.engine import Engine

from config import (
    BASE_DIR, DB_CONNECTION_STRING,
    SIMILARITY_THRESHOLD, AGRO_HIT_THRESHOLD, INFO_DEPTH_THRESHOLD,
    LOG_FORMAT, LOG_LEVEL
)
from sentiment_analyzer import SentimentAnalyzer
from trend_analyzer import TrendAnalyzer

logging.basicConfig(level=LOG_LEVEL, format=LOG_FORMAT)
logger = logging.getLogger(__name__)

model: SentenceTransformer = SentenceTransformer('all-MiniLM-L6-v2')


class SmartCurator:
    """AI 기반 스마트 콘텐츠 큐레이터"""

    def __init__(
            self,
            db_engine: Engine,
            similarity_threshold: float = SIMILARITY_THRESHOLD
    ):
        self.engine = db_engine
        self.similarity_threshold = similarity_threshold
        self.model = model
        self.sentiment_analyzer = SentimentAnalyzer(db_engine)
        self.trend_analyzer = TrendAnalyzer(db_engine)

    def fetch_quality_candidates(self, video_type: str, limit: int = 30) -> pd.DataFrame:
        """품질 기준으로 후보 조회"""
        base_query = """
                     SELECT
                         b.bno, b.title, b.content, b.shorts_script,
                         b.hit, b.p_id, b.writer,
                         (SELECT COUNT(*) FROM AI_REPLY r WHERE r.bno = b.bno) as reply_count
                     FROM AI_BOARD b
                     WHERE LENGTH(b.content) >= 300
                       AND b.hit > 50
                       AND NOT EXISTS (
                         SELECT 1 FROM shorts_queue sq
                         WHERE sq.bno = b.bno AND sq.status IN (0, 1)
                     ) \
                     """

        if video_type == "AGRO":
            query = base_query + """
                AND b.hit > :hit_threshold
                ORDER BY b.hit DESC, reply_count DESC
                FETCH FIRST :limit ROWS ONLY
            """
            params = {"hit_threshold": AGRO_HIT_THRESHOLD, "limit": limit}
        else:
            query = base_query + """
                AND LENGTH(b.content) > :depth_threshold
                ORDER BY LENGTH(b.content) DESC, reply_count DESC
                FETCH FIRST :limit ROWS ONLY
            """
            params = {"depth_threshold": INFO_DEPTH_THRESHOLD, "limit": limit}

        try:
            with self.engine.connect() as conn:
                df = pd.read_sql(sqlalchemy.text(query), conn, params=params)
                logger.info(f"✅ [{video_type}] 품질 후보 {len(df)}개 로드")
                return df
        except Exception as e:
            logger.error(f"❌ 후보 조회 실패: {e}", exc_info=True)
            return pd.DataFrame()

    def calculate_quality_score(self, row: pd.Series) -> float:
        """종합 품질 점수 계산"""
        bno = int(row['bno'])

        # 감성 분석
        sentiment_result = self.sentiment_analyzer.analyze_board_replies(bno)
        sentiment_score = sentiment_result['quality_score'] * 0.4

        # 트렌드 매칭
        top_trends = self.trend_analyzer.get_top_trends(limit=20)
        title = row['title']
        trend_match = sum(1 for keyword in top_trends if keyword in title)
        trend_score = min(trend_match / 3.0 * 3.0, 3.0)

        # 댓글 수
        reply_count = row.get('reply_count', 0)
        reply_score = min(reply_count / 10.0 * 2.0, 2.0)

        # 조회수
        hit_score = min(row['hit'] / 200.0 * 1.0, 1.0)

        total_score = sentiment_score + trend_score + reply_score + hit_score

        return total_score

    def is_duplicate(self, new_text: str, existing_texts: List[str]) -> Tuple[bool, float]:
        """90% 유사도 체크"""
        if not existing_texts:
            return False, 0.0

        try:
            new_embedding = self.model.encode(new_text, convert_to_tensor=True)
            existing_embeddings = self.model.encode(existing_texts, convert_to_tensor=True)

            cosine_scores = util.cos_sim(new_embedding, existing_embeddings)
            max_score: float = float(torch.max(cosine_scores).item())

            return max_score > self.similarity_threshold, max_score
        except Exception as e:
            logger.error(f"❌ 유사도 체크 오류: {e}", exc_info=True)
            return False, 0.0

    def fetch_existing_contents(self) -> List[str]:
        """기존 제작본 텍스트"""
        query: str = """
                     SELECT b.title || ' ' || SUBSTR(b.content, 1, 200) as full_text
                     FROM AI_BOARD b
                              JOIN shorts_queue sq ON b.bno = sq.bno
                     WHERE sq.status = 1 \
                     """

        try:
            with self.engine.connect() as conn:
                df = pd.read_sql(sqlalchemy.text(query), conn)
                return df['full_text'].tolist() if not df.empty else []
        except Exception as e:
            logger.error(f"❌ 기존 컨텐츠 조회 실패: {e}", exc_info=True)
            return []

    def filter_track(
            self,
            candidates_df: pd.DataFrame,
            video_type: str,
            existing_texts: List[str],
            max_selected: int = 3
    ) -> List[Dict[str, Any]]:
        """특정 트랙 필터링"""
        selected: List[Dict[str, Any]] = []

        for _, row in candidates_df.iterrows():
            if len(selected) >= max_selected:
                break

            full_text: str = f"{row['title']} {row['content'][:200]}"
            is_dup, score = self.is_duplicate(full_text, existing_texts)

            if not is_dup:
                selected.append({
                    "bno": int(row['bno']),
                    "title": str(row['title']),
                    "content": str(row['content']),
                    "shorts_script": str(row.get('shorts_script', '')),
                    "hit": int(row['hit']),
                    "p_id": str(row.get('p_id', '')),
                    "writer": str(row.get('writer', '')),
                    "video_type": video_type,
                    "quality_score": float(row.get('quality_score', 5.0)),
                    "priority": int(row.get('quality_score', 5.0))
                })
                existing_texts.append(full_text)
                logger.info(f"✅ [{video_type}] 선정: BNO={row['bno']}")

        return selected

    def curate_premium(
            self,
            agro_count: int = 1,
            info_count: int = 1,
            min_quality_score: float = 6.0
    ) -> Dict[str, List[Dict[str, Any]]]:
        """프리미엄 큐레이션"""
        logger.info("🎯 프리미엄 큐레이션 시작")

        self.trend_analyzer.analyze_recent_trends(days=7)
        existing_texts = self.fetch_existing_contents()

        result = {"agro": [], "info": []}

        for video_type, target_count in [("AGRO", agro_count), ("INFO", info_count)]:
            candidates_df = self.fetch_quality_candidates(video_type, limit=30)

            if candidates_df.empty:
                logger.warning(f"⚠️ [{video_type}] 후보 없음")
                continue

            candidates_df['quality_score'] = candidates_df.apply(
                self.calculate_quality_score, axis=1
            )

            candidates_df = candidates_df.sort_values('quality_score', ascending=False)

            selected = self.filter_track(
                candidates_df,
                video_type,
                existing_texts.copy(),
                max_selected=target_count
            )

            result[video_type.lower()] = selected

        logger.info(f"🎯 완료: 어그로 {len(result['agro'])}개, 정보 {len(result['info'])}개")
        return result