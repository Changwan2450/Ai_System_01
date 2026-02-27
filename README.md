# 🤖 Agent Governance (Dashboard First)

## Priority
- Antigravity 기반 운영 대시보드 구축이 최우선
- 숏츠 자동화 로직은 수정 금지

## Spec-Driven
- 코드 변경 전 specs/*.md 작성 필수
- 스펙 승인 전 코드 수정 금지

## Infra Freeze
- nginx / 포트 / DB 구조 변경 금지

## Safety
- 삭제 및 대량수정은 사용자 확인 필수

---

# AI_SYSTEM - 숏츠 자동화 시스템

> Java 크롤링 + AI 생성 → Python 영상 제작 → YouTube 업로드

**상태**: v0.9 (동기 렌더링, 보안 적용 완료)

---

## 아키텍처

```
Java (9090)
  └─> 크롤링 → OpenAI → AI_BOARD INSERT
  └─> shorts_queue INSERT (status=0)
  └─> HTTP POST → Python /api/generate (X-API-Key)

Oracle DB (hr)
  - AI_BOARD (Java write)
  - shorts_queue (Java INSERT, Python UPDATE)

Python (5001)
  └─> /api/generate (X-API-Key 필수)
  └─> OpenAI 대본 → edge-tts → moviepy
  └─> shorts_queue UPDATE (status=1)
```

---

## 테이블 소유권

| 테이블 | Java | Python |
|--------|------|--------|
| AI_BOARD | INSERT/UPDATE | SELECT |
| shorts_queue | INSERT (status=0) | UPDATE (status=1/9) |
| upload_schedule | - | INSERT/UPDATE |

---

## 기동 순서

**Python 먼저 시작**

```bash
# 1. Python (5001)
cd naon.py
export FACTORY_API_KEY="your-key"
python3 api_server.py

# 2. Java (9090)
cd AI-Insidier
export FACTORY_API_KEY="your-key"
./gradlew bootRun
```

---

## 환경변수

```bash
# Python (.env)
DB_USERNAME=hr
DB_PASSWORD=hr
OPENAI_API_KEY=sk-...
FACTORY_API_KEY=your-secret-key
CORS_ORIGINS=http://localhost:9090

# Java (export)
export FACTORY_API_KEY=your-secret-key
```

---

## 보안

| 항목 | 상태 |
|------|------|
| CORS 제한 | ✅ (CORS_ORIGINS) |
| API 인증 | ✅ (X-API-Key) |
| Fail-fast | ✅ (필수 env 누락 시 중단) |

### X-API-Key 필요

- `POST /api/generate` (Python)
- `POST /api/curate/premium` (Python)

---

## 검증

```bash
curl http://localhost:5001/api/health
curl -X POST "http://localhost:9090/api/shorts/generate/1"
```

---

## Planned

- [ ] Flyway (현재: ddl-auto=update)
- [ ] worker.py (현재: 동기)
- [ ] Redis (현재: DB)
- [ ] Trace ID (현재: 미구현)
- [ ] Spring Security (현재: /test 무인증)

---

**문서**: [설계](docs/architecture/SYSTEM_REDESIGN.md)
