
<!-- naon.py/README.md -->

# naon.py — Shorts Factory

> Flask 기반 YouTube Shorts 자동 제작 팩토리 — `shorts_queue` 폴링 → OpenAI 대본 → edge-tts → moviepy 렌더링 → 썸네일 → YouTube 업로드 예약

---

## 폴더 구조

```
naon.py/
├── api_server.py          # Flask REST API 서버 (큐 제어, 상태 조회)
├── main.py                # 메인 루프 (큐레이션→제작→업로드 오케스트레이션)
├── worker.py              # (예정) 렌더링 전용 워커 프로세스 분리
├── shorts_generator.py    # 핵심: 대본생성→TTS→영상합성→썸네일
├── smart_curator.py       # 품질 기반 큐레이션 + 중복 필터
├── persona_manager.py     # Java API 페르소나 캐시 (TTL 10분)
├── upload_scheduler.py    # upload_schedule 등록 및 상태 전환
├── upload_youtube.py      # YouTube Data API OAuth 업로드
├── trend_analyzer.py      # keyword_trends 저장·조회
├── sentiment_analyzer.py  # reply_sentiment 분석·저장
├── performance_tracker.py # shorts_performance 집계
├── thumbnail_generator.py # PIL 기반 썸네일 생성
├── crawler.py             # 보조 HTML 수집기
├── twitter_bot.py         # Twitter 게시 (선택)
├── config.py              # 모든 설정값 (환경변수 참조)
├── errors.py              # (예정) 표준 ErrorCode / ApiError
├── auth/
│   └── middleware.py      # (예정) X-API-Key 인증 미들웨어
├── db/
│   └── queue_status.py    # (예정) QueueStatus 상수 (0/1/9)
├── alembic/               # (예정) Python 전용 테이블 마이그레이션
├── assets/                # 영상 배경, 폰트 등 정적 자원
├── output/                # 렌더링 결과물 (.mp4, .jpg) — git 제외
├── temp/                  # 렌더링 임시 파일 — git 제외
└── requirements.txt
```

---

## 로컬 실행

### 사전 조건

```bash
# Python 3.10+
python --version

# ffmpeg (경로가 PATH에 있어야 함)
ffmpeg -version

# ImageMagick 7 (freetype 지원 필수)
magick --version

# 한국어 폰트 (권장: Pretendard, Nanum Gothic)
# macOS: ~/Library/Fonts/ 에 설치
# Linux: sudo apt install fonts-nanum
```

### 환경변수 설정

```bash
cp .env.example .env
vi .env
```

`.env.example`:
```dotenv
# Oracle DB
DB_USERNAME=PLACEHOLDER_DB_USER
DB_PASSWORD=PLACEHOLDER_DB_PASS
DB_HOST=localhost
DB_PORT=1521
DB_SERVICE=FREE

# OpenAI
OPENAI_API_KEY=PLACEHOLDER_OPENAI_KEY

# Java API 주소 (페르소나 조회용)
JAVA_API_URL=http://localhost:9090

# Flask 서버
PYTHON_API_HOST=0.0.0.0
PYTHON_API_PORT=5001

# 서비스 간 인증 — /api/generate, /api/curate/premium 보호 (PR-PY-02 적용 예정)
FACTORY_API_KEY=PLACEHOLDER_FACTORY_KEY

# CORS 허용 Origin (쉼표 구분, 기본값: Java 서버만)
CORS_ORIGINS=http://localhost:9090

# 렌더링 도구 경로 (미설정 시 자동 탐색)
IMAGEMAGICK_BINARY=
FONT_PATH=

# 워커 폴링 간격 (초)
WORKER_POLL_INTERVAL=30
```

> **⚠️ 보안 주의**  
> `.env` 파일은 절대 커밋하지 않는다. `.gitignore`에 포함 확인 필수.  
> `auth/client_secrets.json` (YouTube OAuth) 도 마찬가지로 커밋 금지.  
> 모든 시크릿은 환경변수 또는 운영 서버의 `EnvironmentFile`로만 관리한다.

### 패키지 설치

```bash
pip install -r requirements.txt
```

### 실행

```bash
# API 서버 (별도 터미널)
python api_server.py

# 메인 오케스트레이터 루프 (별도 터미널)
python main.py

# (선택) 단건 수동 제작 — bno 직접 지정
python shorts_generator.py 1042
```

### systemd 서비스 등록 (운영 서버)

```ini
# /etc/systemd/system/naon-api.service
[Unit]
Description=Naon Shorts Factory API
After=network.target

[Service]
WorkingDirectory=/opt/naon
ExecStart=/usr/bin/python3 /opt/naon/api_server.py
EnvironmentFile=/opt/naon/.env
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable naon-api naon-worker
sudo systemctl start naon-api naon-worker
```

---

## 주요 엔드포인트

| Method | Path | 설명 | 인증 |
|---|---|---|---|
| `GET` | `/api/health` | 헬스체크 | 없음 |
| `GET` | `/api/status` | 큐/성과/페르소나 현황 | 없음 |
| `GET` | `/api/queue` | shorts_queue 전체 목록 | 없음 |
| `GET` | `/api/queue/bno/{bno}` | 특정 bno 작업 상태 폴링 | 없음 |
| `GET` | `/api/trends` | 키워드 트렌드 조회 | 없음 |
| `POST` | `/api/curate/premium` | 프리미엄 큐레이션 실행 | **⚠️ 없음 → 예정: X-API-Key** |
| `POST` | `/api/generate` | bno 기준 Shorts 제작 실행 | **⚠️ 없음 → 예정: X-API-Key** |

### `/api/generate` 요청 예시

```bash
# 현재 (인증 없음 — 임시)
curl -X POST http://localhost:5001/api/generate \
  -H "Content-Type: application/json" \
  -d '{"bno": 1042, "video_type": "INFO"}'

# 적용 예정 (PR-PY-02 이후)
curl -X POST http://localhost:5001/api/generate \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $FACTORY_API_KEY" \
  -d '{"bno": 1042, "video_type": "INFO", "idempotency_key": "gen-1042-abc"}'
```

`video_type` 허용값: `AGRO` | `INFO` | `TREND` | `COMMUNITY` | `ENTERTAINMENT`

---

## 인증/보안 현황 및 계획

### 현재 상태 ⚠️

- `CORS(app)` — 전체 Origin 허용 상태
- `/api/generate`, `/api/curate/premium` — 인증 없이 호출 가능  
  → **외부에서 호출 시 OpenAI 비용 발생 및 CPU 집약 렌더링 무단 트리거 가능**

### 적용 예정 (PR-PY-02)

```
X-API-Key: <FACTORY_API_KEY>   헤더 기반 인증 (hmac.compare_digest)
```

- CORS: `CORS_ORIGINS` 환경변수 기반 화이트리스트로 전환
- 변경 대상: `/api/generate`, `/api/curate/premium`
- Java `ShortsService`는 `X-API-Key` 헤더를 포함해 호출하도록 함께 수정

계획 전문: [`../docs/architecture/NAON_FACTORY_REFACTOR_PLAN.md`](../docs/architecture/NAON_FACTORY_REFACTOR_PLAN.md) — PR-PY-02 참조

---

## 운영/디버깅

```bash
# API 서버 로그
tail -f api_server.log

# Shorts 생성 로그
tail -f shorts_generator.log

# 헬스체크
curl http://localhost:5001/api/health

# 큐 상태 전체 조회
curl http://localhost:5001/api/status | python3 -m json.tool

# 특정 bno 작업 상태 확인
curl http://localhost:5001/api/queue/bno/1042

# 대기 중 작업만 필터 (Oracle 직접)
sqlplus $DB_USERNAME/$DB_PASSWORD@localhost:1521/FREE \
  <<< "SELECT sq_no, bno, status, video_type, error_msg FROM shorts_queue WHERE status=0 ORDER BY priority DESC, quality_score DESC;"

# 실패 작업 확인
sqlplus $DB_USERNAME/$DB_PASSWORD@localhost:1521/FREE \
  <<< "SELECT sq_no, bno, error_msg, reg_date FROM shorts_queue WHERE status=9 ORDER BY reg_date DESC FETCH FIRST 10 ROWS ONLY;"

# 수동 재처리 — 실패 항목 status 초기화
sqlplus $DB_USERNAME/$DB_PASSWORD@localhost:1521/FREE \
  <<< "UPDATE shorts_queue SET status=0, error_msg=NULL WHERE sq_no=<대상_sq_no>; COMMIT;"

# output 디렉토리 용량 확인
du -sh output/ temp/

# 렌더링 의존성 점검 (PR-PY-07 적용 후 자동화)
python -c "from shorts_generator import validate_render_dependencies; validate_render_dependencies()"
```

---

## 렌더링 의존성 문제 해결

```bash
# ImageMagick freetype 지원 확인
magick -list font | grep -i nanum

# ffmpeg 코덱 확인
ffmpeg -codecs | grep libx264

# 폰트 설치 (Ubuntu/Debian)
sudo apt install fonts-nanum fonts-nanum-extra

# ImageMagick policy 오류 시 (PDF policy 완화)
sudo vi /etc/ImageMagick-7/policy.xml
# <policy domain="coder" rights="read|write" pattern="PDF" /> 로 수정
```

---

## 아키텍처 문서

| 문서 | 설명 |
|---|---|
| [`../docs/architecture/SYSTEM_REDESIGN.md`](../docs/architecture/SYSTEM_REDESIGN.md) | 전체 시스템 분석, 10개 인시던트 목록, 재설계 계획 |
| [`../docs/architecture/NAON_FACTORY_REFACTOR_PLAN.md`](../docs/architecture/NAON_FACTORY_REFACTOR_PLAN.md) | Python PR-PY-01~PR-PY-10 (인증·오류모델·워커분리·멱등성) |
| [`../docs/architecture/AI_INSIDER_REFACTOR_PLAN.md`](../docs/architecture/AI_INSIDER_REFACTOR_PLAN.md) | Java PR-01~PR-10 (Flyway·Spring Security·타입안전 오류모델) |
