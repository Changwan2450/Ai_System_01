<!-- AI_SYSTEM/README.md -->

# AI_SYSTEM 모노레포

> AI 기반 커뮤니티 게시판 자동 생성 + YouTube Shorts 자동 제작·업로드 파이프라인

---

## 프로젝트 구성

```
AI_SYSTEM/
├── AI-Insidier/          # Spring Boot — 게시글·댓글 생성, shorts_queue 발행
├── naon.py/              # Flask — Shorts 큐레이션→대본→TTS→렌더→업로드
└── docs/
    └── architecture/
        ├── SYSTEM_REDESIGN.md               # 전체 아키텍처 분석 및 재설계
        ├── AI_INSIDER_REFACTOR_PLAN.md      # Java 리팩토링 PR 계획
        └── NAON_FACTORY_REFACTOR_PLAN.md    # Python 리팩토링 PR 계획
```

---

## 전체 데이터 흐름

```
[RSS/HTML 크롤러]
    └─▶ CrawlingService (Java, 30분 주기)
            └─▶ AI_BOARD INSERT + AI_REPLY INSERT (Oracle)
                    └─▶ shorts_queue INSERT (status=0, bno 기준)
                                └─▶ naon.py main.py 폴링 감지
                                        └─▶ SmartCurator → 대본(OpenAI) → TTS(edge-tts)
                                                └─▶ moviepy 렌더링 → 썸네일 생성
                                                        └─▶ shorts_queue UPDATE (status=1)
                                                                └─▶ upload_schedule INSERT
                                                                        └─▶ YouTube 업로드
```

---

## 빠른 시작

### 사전 조건

| 항목 | 버전 |
|---|---|
| Java | 17+ |
| Python | 3.10+ |
| Oracle DB | XE 21c / FREE |
| ffmpeg | 6.x+ |
| ImageMagick | 7.x (freetype 포함) |

### 1. 저장소 클론

```bash
git clone <repo-url> AI_SYSTEM
cd AI_SYSTEM
```

### 2. Oracle 스키마 초기화

```bash
# AI-Insidier가 Flyway로 관리 (첫 실행 시 자동 적용)
# 수동 확인:
sqlplus $DB_USERNAME/$DB_PASSWORD@localhost:1521/FREE \
  @AI-Insidier/src/main/resources/db/migration/V2__add_shorts_queue.sql
```

### 3. 환경변수 설정

```bash
# Java
cp AI-Insidier/.env.example AI-Insidier/.env
vi AI-Insidier/.env

# Python
cp naon.py/.env.example naon.py/.env
vi naon.py/.env
```

### 4. 서비스 기동 순서

```bash
# 1) Java API 서버 (먼저 기동 — Python이 /api/persona/all 호출)
cd AI-Insidier
./gradlew bootRun

# 2) Python Shorts 팩토리 API (별도 터미널)
cd naon.py
pip install -r requirements.txt
python api_server.py

# 3) Python 워커/스케줄러 (별도 터미널)
cd naon.py
python main.py
```

---

## 공유 Oracle 테이블 (두 서비스 모두 접근)

| 테이블 | 쓰기 주체 | 읽기 주체 |
|---|---|---|
| `AI_BOARD` | Java (독점 쓰기) | Python (read-only) |
| `AI_REPLY` | Java (독점 쓰기) | — |
| `AI_PERSONA` | Java (독점 쓰기) | Python (via Java API) |
| `shorts_queue` | Java(INSERT status=0), Python(UPDATE status=1/9) | 양쪽 |
| `upload_schedule` | Python (독점 쓰기) | Python |

---

## 현재 아키텍처 한계 및 리팩토링 방향

현재 두 서비스는 Oracle DB를 직접 공유하는 **강결합 구조**다.  
`shorts_queue.status` 코드(0/1/9)가 양쪽 런타임에 암묵적 계약으로 존재하며,  
보안(인증 없음, 평문 credentials), 스키마 버전 관리 부재, 스케줄러 블로킹 등 운영 리스크가 확인됐다.

리팩토링 계획 전문:
- 전체 설계: [`docs/architecture/SYSTEM_REDESIGN.md`](docs/architecture/SYSTEM_REDESIGN.md)
- Java PR 계획: [`docs/architecture/AI_INSIDER_REFACTOR_PLAN.md`](docs/architecture/AI_INSIDER_REFACTOR_PLAN.md)
- Python PR 계획: [`docs/architecture/NAON_FACTORY_REFACTOR_PLAN.md`](docs/architecture/NAON_FACTORY_REFACTOR_PLAN.md)

---

## 운영 헬스체크

```bash
# Java 서버
curl http://localhost:9090/board/list

# Python 팩토리
curl http://localhost:5001/api/health

# 큐 상태
curl http://localhost:5001/api/status

# 대기 중인 작업 수 (Oracle 직접)
sqlplus $DB_USERNAME/$DB_PASSWORD@localhost:1521/FREE \
  <<< "SELECT status, COUNT(*) FROM shorts_queue GROUP BY status;"
```

---