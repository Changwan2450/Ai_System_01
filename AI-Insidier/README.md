# AI-Insidier - Java 컨텐츠 생성

> 크롤링 → AI 포스트/댓글 생성 → Python 영상 제작 요청

**포트**: 9090 | **상태**: v0.9

---

## 아키텍처

```
스케줄러 (30분)
  └─> CrawlingService: RSS/HTML
  └─> AiPostGenerationService: OpenAI
      └─> AI_BOARD INSERT
      └─> shorts_queue INSERT (status=0)
  └─> ShortsService: Python /api/generate
      └─> RestTemplate + X-API-Key 자동
```

---

## 테이블 소유권

| 테이블 | Java |
|--------|------|
| AI_BOARD | INSERT/UPDATE |
| shorts_queue | INSERT (status=0) |

---

## 실행

```bash
export FACTORY_API_KEY="your-key"
./gradlew bootRun
```

**로그**:

```
✅ 환경변수 검증: FACTORY_API_KEY=...
✅ RestTemplate Bean (인터셉터 활성화)
Started AiBotApplication
```

---

## 보안 (PR-02)

### X-API-Key 자동 추가

**위치**: `config/AppConfig.java`

```java
@PostConstruct
public void validateRequiredEnvVars() {
    // FACTORY_API_KEY 필수
}

@Bean
public RestTemplate restTemplate() {
    // 인터셉터: X-API-Key 자동 추가
}
```

---

## 검증

```bash
curl http://localhost:9090/board/list
curl -X POST "http://localhost:9090/api/shorts/generate/1"
```

**로그**:

```
[DEBUG] 🔑 X-API-Key 헤더 추가: ...
[INFO] 🚀 Python 제작 요청: BNO=1
[INFO] ✅ 쇼츠 제작 성공!
```

---

## 주요 파일

```
config/AppConfig.java          # 인터셉터
service/CrawlingService.java   # 크롤링
service/AiPostGenerationService.java
service/ShortsService.java     # Python 호출
```

---

## 스키마

### AI_BOARD (Java 소유)

```sql
CREATE TABLE AI_BOARD (
    bno NUMBER PRIMARY KEY,
    title VARCHAR2(500),
    content CLOB,
    shorts_script CLOB,
    reg_date TIMESTAMP
);
```

### shorts_queue (협업)

```sql
CREATE TABLE shorts_queue (
    sq_no NUMBER PRIMARY KEY,
    bno NUMBER,
    status NUMBER(1),  -- Java: INSERT 0
    video_path VARCHAR2(500)  -- Python: UPDATE
);
```

---

## Planned

- [ ] Flyway (현재: ddl-auto=update)
- [ ] Typed AiResult (현재: String)
- [ ] Trace ID (현재: 미구현)
- [ ] Spring Security (현재: 무인증)

---

## 트러블슈팅

| 문제 | 해결 |
|------|------|
| IllegalStateException: FACTORY_API_KEY | export 후 재시작 |
| Connection refused | Python 먼저 시작 |

---

**문서**: [리팩토링 계획](../docs/architecture/AI_INSIDER_REFACTOR_PLAN.md)
