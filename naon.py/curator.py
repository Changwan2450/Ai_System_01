"""
AI 기반 콘텐츠 큐레이터 (SBERT 중복 방지 강화 버전)
"""
import logging
import sqlalchemy
import pandas as pd
import torch
from typing import List, Dict, Any, Tuple
from sentence_transformers import SentenceTransformer, util
from sqlalchemy.engine import Engine

# 형의 프로젝트 공통 설정 로드
import config

# ===============================
# 로깅 설정
# ===============================
logging.basicConfig(
    level=config.LOG_LEVEL,
    format=config.LOG_FORMAT,
    handlers=[
        logging.FileHandler(config.BASE_DIR / "curator.log", encoding='utf-8'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

# 🔥 [안정성] 모델 로드 (최초 1회만 실행)
logger.info("🤖 Sentence-BERT 모델 로딩 중 (중복 90% 컷 준비)...")
model = SentenceTransformer('all-MiniLM-L6-v2')
logger.info("✅ 모델 로드 완료")


class TwoTrackCurator:
    """이원화 전략 큐레이터 (유사도 기반 중복 제거)"""

    def __init__(self, db_engine: Engine):
        self.engine = db_engine
        # config에서 임계값 가져옴 (예: 0.7 이면 70% 이상 비슷할 때 중복 처리)
        self.similarity_threshold = getattr(config, 'SIMILARITY_THRESHOLD', 0.7)
        self.agro_hit_threshold = getattr(config, 'AGRO_HIT_THRESHOLD', 50)
        self.info_depth_threshold = getattr(config, 'INFO_DEPTH_THRESHOLD', 300)

    def fetch_existing_contents(self) -> List[str]:
        """이미 제작 완료된 쇼츠들의 제목+본문 텍스트 긁어오기"""
        query = """
                SELECT b.title || ' ' || SUBSTR(b.content, 1, 150) as full_text
                FROM AI_BOARD b
                         JOIN shorts_queue sq ON b.bno = sq.bno
                WHERE sq.status = 1 \
                """
        try:
            with self.engine.connect() as conn:
                df = pd.read_sql(sqlalchemy.text(query), conn)
                return df['full_text'].tolist() if not df.empty else []
        except Exception as e:
            logger.error(f"❌ 기존 기록 조회 실패: {e}")
            return []

    def is_duplicate(self, new_text: str, existing_texts: List[str]) -> Tuple[bool, float]:
        """SBERT 문맥 분석으로 90% 중복 컷 (코사인 유사도 분석)"""
        if not existing_texts:
            return False, 0.0

        try:
            # 텍스트 임베딩 수치화
            new_embedding = model.encode(new_text, convert_to_tensor=True)
            existing_embeddings = model.encode(existing_texts, convert_to_tensor=True)

            # 유사도 계산
            cosine_scores = util.cos_sim(new_embedding, existing_embeddings)
            max_score = float(torch.max(cosine_scores).item())

            # 설정한 임계값보다 높으면 중복으로 간주
            return (max_score > self.similarity_threshold), max_score
        except Exception as e:
            logger.error(f"❌ 유사도 체크 오류: {e}")
            return False, 0.0

    def fetch_candidates(self, track_type: str) -> pd.DataFrame:
        """어그로형(AGRO) 또는 정보형(INFO) 후보군 조회"""
        if track_type == "AGRO":
            condition = f"b.hit > {self.agro_hit_threshold}"
            order = "b.hit DESC"
        else:
            condition = f"LENGTH(b.content) > {self.info_depth_threshold}"
            order = "LENGTH(b.content) DESC"

        query = f"""
            SELECT b.bno, b.title, b.content, b.shorts_script, b.hit, b.p_id
            FROM AI_BOARD b
            WHERE {condition}
              AND NOT EXISTS (
                  SELECT 1 FROM shorts_queue sq 
                  WHERE sq.bno = b.bno AND sq.status = 1
              )
            ORDER BY {order}, b.bno DESC
            FETCH FIRST 20 ROWS ONLY
        """
        try:
            with self.engine.connect() as conn:
                return pd.read_sql(sqlalchemy.text(query), conn)
        except Exception as e:
            logger.error(f"❌ {track_type} 후보 조회 실패: {e}")
            return pd.DataFrame()

    def curate(self, count: int = 1) -> List[Dict[str, Any]]:
        """최종 선정 로직 (중복 제거 포함)"""
        logger.info("🎯 큐레이션 가동: 중복 필터링 시작")

        existing_texts = self.fetch_existing_contents()
        selected = []

        # 어그로형, 정보형 순서대로 훑기
        for track in ["AGRO", "INFO"]:
            candidates = self.fetch_candidates(track)
            for _, row in candidates.iterrows():
                if len(selected) >= count * 2: # 원하는 개수 차면 종료
                    break

                full_text = f"{row['title']} {row['content'][:150]}"
                is_dup, score = self.is_duplicate(full_text, existing_texts)

                if not is_dup:
                    selected.append(row.to_dict())
                    existing_texts.append(full_text) # 이번 사이클 중복 방지용 추가
                    logger.info(f"✅ 선정 완료: {row['title']} (유사도 {score:.2f})")
                else:
                    logger.warning(f"🚫 중복 컷: {row['title']} (유사도 {score:.2f})")

        return selected

def filter_and_queue(engine: Engine) -> List[Dict[str, Any]]:
    """하위 호환 및 메인 호출용 함수"""
    curator = TwoTrackCurator(engine)
    return curator.curate(count=1)