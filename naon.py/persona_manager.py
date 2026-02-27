"""
Persona 관리 (Java API optional, DB fallback)
"""
import logging
from typing import Dict, Any, List, Optional
import requests
import sqlalchemy
from sqlalchemy import text

from config import (
    JAVA_PERSONA_API,
    EDGE_TTS_VOICES,
    DEFAULT_VOICE,
    DB_CONNECTION_STRING,
    LOG_FORMAT, LOG_LEVEL
)

logging.basicConfig(level=LOG_LEVEL, format=LOG_FORMAT)
logger = logging.getLogger(__name__)


class PersonaManager:
    """Persona 관리 (9090 죽어도 동작)"""

    def __init__(self):
        self.persona_cache: Dict[str, Dict[str, Any]] = {}
        self.voice_mapping: Dict[str, str] = {}
        self.speed_mapping: Dict[str, str] = {}
        self.engine = sqlalchemy.create_engine(DB_CONNECTION_STRING, pool_pre_ping=True)

    def fetch_all_personas(self) -> bool:
        """Java API (optional) → DB fallback"""
        try:
            logger.info("🎭 Persona 로드 시도 (Java API)")
            response = requests.get(f"{JAVA_PERSONA_API}/all", timeout=3)
            response.raise_for_status()

            data = response.json()

            if data.get("success") and "data" in data:
                persona_list: List[Dict[str, Any]] = data["data"]

                for persona in persona_list:
                    p_id = persona.get("pId")
                    if p_id:
                        self.persona_cache[p_id] = persona
                        self._map_voice_and_speed(persona)

                logger.info(f"✅ Persona {len(self.persona_cache)}명 로드 (Java)")
                return True

        except Exception as e:
            logger.warning(f"⚠️ Java API 실패 (무시): {e}")

        return self._fetch_from_db()

    def _fetch_from_db(self) -> bool:
        """PostgreSQL에서 Persona 로드"""
        try:
            logger.info("🎭 Persona 로드 (PostgreSQL)")
            query = text("SELECT p_id, name, job, prompt, avatar FROM ai_persona LIMIT 10")

            with self.engine.connect() as conn:
                result = conn.execute(query)
                rows = result.fetchall()

                if not rows:
                    logger.warning("⚠️ DB에 Persona 없음 → 기본값")
                    self._create_default_persona()
                    return True

                for row in rows:
                    persona = {
                        "pId": row[0],
                        "name": row[1],
                        "job": row[2] or "",
                        "prompt": row[3] or "",
                        "avatar": row[4] or ""
                    }
                    p_id = persona["pId"]
                    self.persona_cache[p_id] = persona
                    self._map_voice_and_speed(persona)

                logger.info(f"✅ Persona {len(self.persona_cache)}명 로드 (DB)")
                return True

        except Exception as e:
            logger.error(f"❌ DB 조회 실패: {e} → 기본 Persona")
            self._create_default_persona()
            return True

    def _create_default_persona(self) -> None:
        """기본 Persona"""
        default_persona = {
            "pId": "default",
            "name": "AI Insider",
            "job": "AI 기술 리포터",
            "prompt": "전문적이고 객관적인 톤",
            "avatar": ""
        }
        self.persona_cache["default"] = default_persona
        self._map_voice_and_speed(default_persona)
        logger.info("✅ 기본 Persona 생성")

    def _map_voice_and_speed(self, persona: Dict[str, Any]) -> None:
        """음성 매핑"""
        p_id = persona.get("pId")
        job = persona.get("job", "").lower()
        prompt = persona.get("prompt", "").lower()

        if any(word in job for word in ["개발자", "엔지니어"]):
            voice = EDGE_TTS_VOICES["male_professional"]
            speed = "+35%"
        elif any(word in job for word in ["교수", "연구원"]):
            voice = EDGE_TTS_VOICES["male_calm"]
            speed = "+30%"
        elif any(word in prompt for word in ["독설", "비판"]):
            voice = EDGE_TTS_VOICES["male_young"]
            speed = "+40%"
        elif any(word in job for word in ["디자이너"]):
            voice = EDGE_TTS_VOICES["female_bright"]
            speed = "+35%"
        elif any(word in prompt for word in ["친절", "따뜻"]):
            voice = EDGE_TTS_VOICES["female_warm"]
            speed = "+30%"
        else:
            voice = DEFAULT_VOICE
            speed = "+35%"

        self.voice_mapping[p_id] = voice
        self.speed_mapping[p_id] = speed

    def get_persona(self, p_id: str) -> Optional[Dict[str, Any]]:
        """Persona 조회"""
        persona = self.persona_cache.get(p_id)
        if not persona and self.persona_cache:
            return list(self.persona_cache.values())[0]
        return persona

    def get_voice(self, p_id: str) -> str:
        """음성 조회"""
        return self.voice_mapping.get(p_id, DEFAULT_VOICE)

    def get_speed(self, p_id: str) -> str:
        """속도 조회"""
        return self.speed_mapping.get(p_id, "+35%")

    def get_tts_config(self, p_id: str) -> Dict[str, Any]:
        """TTS 설정"""
        persona = self.get_persona(p_id)

        return {
            "voice": self.get_voice(p_id),
            "speed": self.get_speed(p_id),
            "persona_name": persona.get("name", "Unknown") if persona else "Unknown"
        }


persona_manager = PersonaManager()
