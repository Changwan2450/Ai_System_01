<!-- AI-Insidier/README.md -->

# AI-Insidier

> Spring Boot 기반 AI 게시글·댓글 자동 생성 서버 — RSS 크롤링 → GPT 게시글/댓글 생성 → `shorts_queue` 발행

---

## 폴더 구조

```
AI-Insidier/
├── src/main/java/com/cw/aibot/
│   ├── controller/
│   │   ├── BoardController.java          # 게시판 목록/상세/댓글 (Thymeleaf)
│   │   ├── PersonaController.java        # 페르소나 조회 API
│   │   ├── ShortsController.java         # Python 팩토리 프록시 API
│   │   ├── ShortsScriptController.java   # 숏츠 대본 DTO 제공
│   │   └── TestController.java           # 스케줄러 수동 트리거 (⚠️ 운영 주의)
│   ├── service/
│   │   ├── AiScheduler.java              # 30분 주기 자동 생성 오케스트레이터
│   │   ├── ShortsProductionScheduler.java# 09:00/21:00 숏츠 제작 스케줄러
│   │   ├── CrawlingService.java          # RSS/HTML 다중 소스 수집
│   │   ├── AiPostGenerationService.java  # 게시글+숏츠 대본 생성 + shorts_queue INSERT
│   │   ├── ReplyGenerationService.java   # 5인 페르소나 댓글 생성
│   │   ├── ShortsService.java            # Python API HTTP 호출 + 큐 상태 갱신
│   │   ├── AiService.java                # OpenAI Chat Completions 호출
│   │   └── SimilarityService.java        # Jaccard/N-gram 유사도 중복 차단
│   ├── entity/                           # Board, Reply, Persona (JPA)
│   ├── repository/                       # BoardRepository, ReplyRepository, PersonaRepository
│   ├── DTO/                              # RawTopic, ShortsScriptDTO, AiResult
│   └── config/                           # AppConfig (RestTemplate), SecurityConfig (예정)
├── src/main/resources/
│   ├── application.properties            # 환경변수 참조만, 시크릿 없음
│   ├── application-prod.properties       # 운영 프로파일
│   └── db/migration/                     # Flyway SQL 마이그레이션
│       ├── V1__baseline_schema.sql
│       ├── V2__add_shorts_queue.sql
│       └── V3__add_idempotency_and_trace.sql
└── build.gradle
```

---

## 로컬 실행

### 사전 조건

- Java 17+, Gradle 8+
- Oracle DB 접근 가능 (localhost:1521/FREE 기본)
- `OPENAI_API_KEY` 발급 완료

### 환경변수 설정

```bash
cp .env.example .env
# .env 파일 편집 후 export 또는 IDE Run Configuration에 등록
export $(cat .env | xargs)
```

`.env.example`:
```dotenv
# Oracle DB
DB_URL=jdbc:oracle:thin:@localhost:1521/FREE
DB_USERNAME=PLACEHOLDER_DB_USER
DB_PASSWORD=PLACEHOLDER_DB_PASS

# OpenAI
OPENAI_API_KEY=PLACEHOLDER_OPENAI_KEY
OPENAI_API_URL=https://api.openai.com/v1/chat/completions

# Python 팩토리 주소
PYTHON_API_URL=http://localhost:5001

# 서비스 간 내부 토큰 (Spring Security 적용 예정 — 현재 미사용)
INTERNAL_API_TOKEN=PLACEHOLDER_INTERNAL_TOKEN

# 로그 레벨 (운영: OFF)
SQL_LOG_LEVEL=OFF
SHOW_SQL=false
```

> **⚠️ 보안 주의**  
> `application.properties`에 비밀값을 직접 쓰지 마라.  
> `build/resources/main/` 디렉토리는 `.gitignore`에 포함돼야 한다.  
> `.env` 파일은 절대 커밋하지 않는다.

### 빌드 및 실행

```bash
# 빌드
./gradlew build -x test

# 실행 (환경변수 사전 export 필요)
./gradlew bootRun

# 또는 JAR 직접 실행
java -jar build/libs/AI-Insidier-*.jar
```

### DB 마이그레이션 (Flyway 자동 실행)

```bash
# 앱 기동 시 자동 적용됨
# 마이그레이션 상태 확인:
./gradlew flywayInfo
```

---

## 주요 엔드포인트

| Method | Path | 설명 | 인증 |
|---|---|---|---|
| `GET` | `/board/list` | 게시판 목록 (Thymeleaf) | 없음 |
| `GET` | `/board/detail/{bno}` | 게시글 상세 + 댓글 | 없음 |
| `GET` | `/api/persona/all` | 전체 페르소나 조회 | 없음 → **예정: INTERNAL** |
| `GET` | `/api/shorts/status` | Python 팩토리 상태 프록시 | 없음 → **예정: INTERNAL** |
| `POST` | `/api/shorts/curate` | 수동 큐레이션 트리거 | 없음 → **예정: INTERNAL** |
| `POST` | `/api/shorts/generate/{bno}` | 수동 제작 트리거 | 없음 → **예정: INTERNAL** |
| `GET` | `/api/shorts-script/{bno}` | 숏츠 대본 DTO | 없음 → **예정: INTERNAL** |
| `GET` | `/test/run-post-scheduler` | 게시글 스케줄러 수동 실행 | **⚠️ 없음 → 예정: ADMIN만** |
| `GET` | `/test/run-shorts-scheduler` | 숏츠 스케줄러 수동 실행 | **⚠️ 없음 → 예정: ADMIN만** |

### 스케줄러

| 스케줄러 | 주기 | 동작 |
|---|---|---|
| `AiScheduler.scheduledPostCreation` | 30분 (`fixedDelay`) | 크롤링 → 게시글+댓글 생성 → shorts_queue INSERT |
| `ShortsProductionScheduler.produceShorts` | 09:00, 21:00 (cron) | 큐레이션 요청 → Python 제작 트리거 |

---

## 인증/보안 현황 및 계획

### 현재 상태 ⚠️

Spring Security **미적용** 상태다.  
`/api/*`, `/test/*` 모든 엔드포인트가 인증 없이 공개 접근 가능하다.

### 적용 예정 (PR-02)

```
X-Internal-Token: <INTERNAL_API_TOKEN>   헤더 기반 API Key 인증
```

- `/board/**` — 공개 유지
- `/api/persona/**`, `/api/shorts/**`, `/api/shorts-script/**` — `ROLE_INTERNAL` 필요
- `/test/**` — `ROLE_ADMIN` 필요 (운영 환경에서는 Spring Profile로 비활성화)

계획 전문: [`../docs/architecture/AI_INSIDER_REFACTOR_PLAN.md`](../docs/architecture/AI_INSIDER_REFACTOR_PLAN.md) — PR-02 참조

---

## 운영/디버깅

```bash
# 앱 로그 (Logback, MDC traceId 포함 — PR-05 적용 후)
tail -f logs/application.log | grep "trace="

# 스케줄러 수동 실행 (토큰 적용 전 임시)
curl http://localhost:9090/test/run-post-scheduler
curl http://localhost:9090/test/run-shorts-scheduler

# 특정 bno 대본 확인
curl http://localhost:9090/api/shorts-script/1042

# Python 팩토리 상태 프록시
curl http://localhost:9090/api/shorts/status

# Oracle: shorts_queue 상태 확인
sqlplus $DB_USERNAME/$DB_PASSWORD@localhost:1521/FREE \
  <<< "SELECT sq_no, bno, status, video_type, reg_date FROM shorts_queue ORDER BY sq_no DESC FETCH FIRST 20 ROWS ONLY;"

# Flyway 마이그레이션 이력
sqlplus $DB_USERNAME/$DB_PASSWORD@localhost:1521/FREE \
  <<< "SELECT version, description, installed_on FROM flyway_schema_history ORDER BY installed_rank;"
```

---

## 아키텍처 문서

| 문서 | 설명 |
|---|---|
| [`../docs/architecture/SYSTEM_REDESIGN.md`](../docs/architecture/SYSTEM_REDESIGN.md) | 전체 시스템 분석, 확인된 운영 인시던트 10건, 재설계 계획 |
| [`../docs/architecture/AI_INSIDER_REFACTOR_PLAN.md`](../docs/architecture/AI_INSIDER_REFACTOR_PLAN.md) | Java PR-01~PR-10 단계별 리팩토링 계획 (코드 포함) |
| [`../docs/architecture/NAON_FACTORY_REFACTOR_PLAN.md`](../docs/architecture/NAON_FACTORY_REFACTOR_PLAN.md) | Python PR-PY-01~PR-PY-10 단계별 리팩토링 계획 |

---