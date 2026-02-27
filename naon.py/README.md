# naon.py - Python 영상 제작 Factory

> 떡밥 대본 생성 → TTS → 영상 렌더링 → YouTube 스케줄링

**포트**: 5001 | **상태**: v0.9

---

## 아키텍처

```
Flask API (X-API-Key 필수)
  └─> POST /api/generate (Java 호출)
      └─> OpenAI 떡밥 대본 → edge-tts → moviepy
      └─> shorts_queue UPDATE (status=1)
```

---

## 테이블 소유권

| 테이블 | Python 역할 |
|--------|------------|
| AI_BOARD | SELECT |
| shorts_queue | UPDATE (status=1/9, video_path) |
| upload_schedule | INSERT/UPDATE |

---

## 실행

### .env (필수)

```bash
cp .env.example .env
nano .env
```

```bash
DB_USERNAME=hr
DB_PASSWORD=hr
OPENAI_API_KEY=sk-...
FACTORY_API_KEY=your-secret-key
CORS_ORIGINS=http://localhost:9090
```

### 시작

```bash
python3 api_server.py
```

---

## 보안 (PR-PY-01)

### X-API-Key 인증

```python
@require_api_key  # auth/middleware.py
```

### CORS Whitelist

```python
CORS(app, origins=CORS_ORIGINS)
```

---

## 떡밥 대본 (PR-PHASE2)

```json
{
  "hook": "와 님들 이거 진짜?",
  "core_summary": "그니까 오픈AI가. 새 모델 풀었는데.",
  "controversy_point": "근데 어떤 사람들은. 별로래.",
  "comment_trigger": "님들 생각은 어때?"
}
```

**규칙**: 커뮤니티 말투, 20자 전후, 감탄형 hook, 질문형 trigger
**금지**: "ㄹㅇ", "실화냐", URL

---

## API

| 엔드포인트 | 인증 |
|-----------|------|
| /api/health | ❌ |
| /api/generate | ✅ |
| /api/curate/premium | ✅ |

---

## 검증

```bash
# Health
curl http://localhost:5001/api/health

# 대본 테스트 (DB 없이)
python3 test_script_generator.py 1
```

---

## 파일

```
naon.py/
├── api_server.py           # Flask
├── shorts_generator.py     # 대본+렌더링
├── auth/middleware.py      # require_api_key
└── test_script_generator.py
```

---

## 렌더링

```
OpenAI → edge-tts → moviepy → output/shorts_<BNO>.mp4
```

**소요**: 40-120초 (동기)

---

## 스키마

### shorts_queue (Python UPDATE)

```sql
video_path VARCHAR2(500),
status NUMBER(1),          -- 0→1/9
error_msg VARCHAR2(2000)
```

### upload_schedule (Python 소유)

```sql
CREATE TABLE upload_schedule (
    schedule_id NUMBER PRIMARY KEY,
    bno NUMBER,
    scheduled_time TIMESTAMP,
    status VARCHAR2(20)
);
```

---

## Planned

- [ ] worker.py 분리 (현재: 동기)
- [ ] MERGE 큐 (현재: race)
- [ ] Alembic (현재: 수동 DDL)
- [ ] Typed Error (현재: str)
- [ ] Trace ID (현재: 미구현)
- [ ] Redis (현재: DB)

---

## 트러블슈팅

| 문제 | 해결 |
|------|------|
| KeyError: DB_USERNAME | .env 설정 |
| edge-tts 실패 | gTTS 폴백 (정상) |

---

**문서**: [리팩토링 계획](../docs/architecture/NAON_FACTORY_REFACTOR_PLAN.md)
