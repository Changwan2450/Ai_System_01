"""
Python 프로젝트 설정 파일 (edge-tts 버전)
PR-PY-01: 크레덴셜 환경변수화 + CORS 설정
"""
import os
from pathlib import Path
from typing import Dict, List
from dotenv import load_dotenv

# ===============================
# .env 파일 로드
# ===============================
BASE_DIR: Path = Path(__file__).resolve().parent
ENV_FILE: Path = BASE_DIR / ".env"

if ENV_FILE.exists():
    load_dotenv(ENV_FILE)
    print(f"✅ .env 파일 로드 완료: {ENV_FILE}")
else:
    print(f"⚠️ .env 파일 없음: {ENV_FILE}")

# ===============================
# 경로 설정
# ===============================
OUTPUT_DIR: Path = BASE_DIR / "output"
TEMP_DIR: Path = BASE_DIR / "temp"
ASSETS_DIR: Path = BASE_DIR / "assets"

OUTPUT_DIR.mkdir(exist_ok=True)
TEMP_DIR.mkdir(exist_ok=True)
ASSETS_DIR.mkdir(exist_ok=True)

# ===============================
# DB 설정 (PR-PY-01: fail-fast)
# ===============================
# 필수 환경변수 - 누락 시 KeyError 발생
_db_user = os.environ["DB_USERNAME"]
_db_pass = os.environ["DB_PASSWORD"]
_db_host = os.environ.get("DB_HOST", "localhost")
_db_port = os.environ.get("DB_PORT", "5432")
_db_name = os.environ.get("DB_SERVICE", "postgres")

# PostgreSQL 연결 문자열
DB_CONNECTION_STRING: str = (
    f"postgresql+psycopg2://{_db_user}:{_db_pass}"
    f"@{_db_host}:{_db_port}/{_db_name}"
)

print(f"✅ DB 연결: {_db_user}@{_db_host}:{_db_port}/{_db_name}")

# ===============================
# API 설정
# ===============================
JAVA_API_URL: str = os.environ.get("JAVA_API_URL", "http://localhost:9090")
JAVA_PERSONA_API: str = f"{JAVA_API_URL}/api/persona"

PYTHON_API_HOST: str = os.environ.get("PYTHON_API_HOST", "0.0.0.0")
PYTHON_API_PORT: int = int(os.environ.get("PYTHON_API_PORT", "5001"))

# PR-PY-01: CORS whitelist (환경변수, 쉼표 구분)
CORS_ORIGINS: List[str] = os.environ.get(
    "CORS_ORIGINS",
    "http://localhost:9090"
).split(",")
print(f"✅ CORS 허용 Origins: {CORS_ORIGINS}")

# ===============================
# OpenAI API 설정 (PR-PY-01: fail-fast)
# ===============================
OPENAI_API_KEY: str = os.environ["OPENAI_API_KEY"]  # 필수
OPENAI_API_URL: str = "https://api.openai.com/v1/chat/completions"
OPENAI_MODEL: str = "gpt-4o-mini"
print(f"✅ OpenAI API Key: {OPENAI_API_KEY[:10]}...")

# PR-PY-01: Factory API Key (inbound auth)
FACTORY_API_KEY: str = os.environ.get("FACTORY_API_KEY", "")
if FACTORY_API_KEY:
    print(f"✅ Factory API Key: {FACTORY_API_KEY[:8]}... (인증 활성화)")
else:
    print("⚠️ Factory API Key 미설정 (인증 비활성화)")

# ===============================
# edge-tts 음성 설정 (무료!)
# ===============================
# 한국어 음성 목록
EDGE_TTS_VOICES: Dict[str, str] = {
    "male_professional": "ko-KR-InJoonNeural",    # 남성, 뉴스 앵커 톤
    "male_calm": "ko-KR-BongJinNeural",           # 남성, 차분한
    "male_young": "ko-KR-GookMinNeural",          # 남성, 젊은
    "female_friendly": "ko-KR-SunHiNeural",       # 여성, 친근한
    "female_bright": "ko-KR-JiMinNeural",         # 여성, 밝은
    "female_professional": "ko-KR-SeoHyeonNeural",# 여성, 전문적
    "female_warm": "ko-KR-SoonBokNeural",         # 여성, 따뜻한
    "female_casual": "ko-KR-YuJinNeural"          # 여성, 캐주얼
}

# 기본 음성
DEFAULT_VOICE: str = "ko-KR-InJoonNeural"

# ===============================
# SNS API (선택)
# ===============================
TWITTER_API_KEY: str = os.getenv("TWITTER_API_KEY", "")
TWITTER_API_SECRET: str = os.getenv("TWITTER_API_SECRET", "")
TWITTER_ACCESS_TOKEN: str = os.getenv("TWITTER_ACCESS_TOKEN", "")
TWITTER_ACCESS_TOKEN_SECRET: str = os.getenv("TWITTER_ACCESS_TOKEN_SECRET", "")

YOUTUBE_CLIENT_SECRETS_PATH: str = os.getenv(
    "YOUTUBE_CLIENT_SECRETS_PATH",
    str(BASE_DIR / "auth" / "client_secrets.json")
)

# ===============================
# ImageMagick 경로 (moviepy TextClip용, freetype 지원 필수)
# ===============================
IMAGEMAGICK_BINARY: str = "/opt/homebrew/opt/imagemagick-full/bin/magick"
os.environ["IMAGEMAGICK_BINARY"] = IMAGEMAGICK_BINARY
# moviepy 내부 config에도 직접 설정
import moviepy.config as _mpc
_mpc.IMAGEMAGICK_BINARY = IMAGEMAGICK_BINARY

# ===============================
# 폰트 경로 (존재하는 폰트 자동 탐색)
# ===============================
_FONT_CANDIDATES = [
    "/Users/changwan/Library/Fonts/Pretendard-Bold.otf",
    "/Users/changwan/Library/Fonts/D2Coding-Ver1.3.2-20180524-ligature.ttc",
    "/System/Library/Fonts/AppleSDGothicNeo.ttc",
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
]
FONT_PATH: str = next(
    (f for f in _FONT_CANDIDATES if Path(f).exists()),
    "Helvetica"  # ImageMagick 내장 폰트 최종 fallback
)
print(f"Font: {FONT_PATH}")

# ===============================
# 큐레이션 설정
# ===============================
SIMILARITY_THRESHOLD: float = 0.90
AGRO_HIT_THRESHOLD: int = 80
INFO_DEPTH_THRESHOLD: int = 500

# ===============================
# 로깅 설정
# ===============================
LOG_LEVEL: str = "INFO"
LOG_FORMAT: str = '%(asctime)s [%(levelname)s] %(message)s'
