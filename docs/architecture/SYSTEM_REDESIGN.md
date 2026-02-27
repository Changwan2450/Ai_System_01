# SYSTEM_REDESIGN.md
> Production-Grade Distributed Architecture Redesign  
> Systems: AI-Insider (Spring Boot) + naon.py (Flask/Python)  
> Analysis Date: 2026-02-25

---

## PHASE 1 — SYSTEM ANALYSIS

### 1.1 Confirmed Production Incidents (Evidence-Based)

The following are not hypothetical — they are structurally guaranteed failure modes given the current codebase:

| # | Incident Class | Root Cause in Code |
|---|---|---|
| I-1 | Silent data loss on generation | `ShortsService.updateShortsQueue` catches all exceptions and swallows them; `bno` with `status=0` stays stuck indefinitely |
| I-2 | Hardcoded credentials in committed artifacts | `application.properties` in `build/resources/main/`: `username=hr`, `password=hr`; `config.py`: `DB_CONFIG = {"user":"hr","password":"hr"}` |
| I-3 | Unauthenticated production triggers | `GET /test/run-post-scheduler`, `GET /test/run-shorts-scheduler` — no Spring Security, publicly reachable |
| I-4 | SQL bind parameter logging in production | `logging.level.org.hibernate.orm.jdbc.bind=TRACE` active — all bound values (content, titles) written to logs |
| I-5 | Flask server exposes all internals | `CORS(app)` — wildcard origin; `/api/generate` callable by any client, triggers OpenAI spend |
| I-6 | Race condition on queue status | Java `AiPostGenerationService` INSERTs `status=0` into `shorts_queue`, Python `_ensure_queue_ready` does a separate `SELECT` then `UPDATE/INSERT` — no row-level lock, two threads can both insert for same `bno` |
| I-7 | Schema drift between runtimes | No DDL versioning; Java uses `ddl-auto=update` (Hibernate can silently ALTER/drop columns); Python runs raw SQL — no shared schema source of truth |
| I-8 | LLM error string propagation | `AiService.askGpt` returns `"ERROR: ..."` string on failure; callers test `.startsWith("ERROR")` — type-unsafe, can be stored in DB as content |
| I-9 | Unbound memory growth in Flask process | `_initialized = False` check uses `@app.before_request` with no thread safety on `_initialized` flag — in multi-threaded gunicorn, initialization runs multiple times concurrently |
| I-10 | Hardcoded local Mac filesystem paths | `config.py`: `IMAGEMAGICK_BINARY = "/opt/homebrew/..."`, `FONT_PATH` candidates include `/Users/changwan/...` — deployment to any non-Mac host silently breaks video rendering |

---

### 1.2 Tight Coupling Points

#### 1.2.1 Shared Oracle Database — The Primary Coupling

Both runtimes share the same Oracle schema (`hr`) with **no ownership boundary**:

```
Java writes:     AI_BOARD, AI_REPLY, AI_PERSONA, shorts_queue (INSERT status=0)
Python reads:    AI_BOARD, shorts_queue (SELECT for curation + generation targets)
Python writes:   shorts_queue (UPDATE status=1/9), upload_schedule (INSERT)
Java reads:      shorts_queue (UPDATE status=1/9 via ShortsService), upload_schedule

Contention zone: shorts_queue.status — both runtimes mutate it without coordination
```

Any schema change to `shorts_queue` or `AI_BOARD` requires synchronized deployment of both Java and Python — currently impossible to verify because there is no shared DDL contract.

#### 1.2.2 Status Code Contract — Implicit and Fragile

`shorts_queue.status` is an integer with semantics split across three files:

| Value | Meaning | Set By | Read By |
|---|---|---|---|
| `0` | Pending / ready | Java (`AiPostGenerationService`), Python (`_ensure_queue_ready`) | Python (`get_target_by_bno`) |
| `1` | Completed | Python (`render_video_with_persona`), Java (`updateShortsQueue`) | Both |
| `9` | Failed | Java (`markAsFailed`), Python on exception | Python (`_ensure_queue_ready` reversal) |

No enum, no constant, no comment. The `9→0` reversal in `_ensure_queue_ready` can re-activate a record that Java already marked as permanently failed.

#### 1.2.3 Cross-Runtime HTTP Call Chain

```
Java AiScheduler (30-min cron)
  └─> AiPostGenerationService.generateShockingPost()
        └─> ShortsService.requestShortsGeneration(bno)   [RestTemplate POST]
              └─> Python /api/generate                    [synchronous blocking]
                    └─> OpenAI API                        [3-30s latency]
                          └─> edge-tts + moviepy          [30-120s render time]
```

**Java's `@Scheduled` thread is blocked for the entire render duration (up to 2 minutes).** With `fixedDelay=1_800_000`, if render takes 3 minutes, the next schedule fires immediately after completion with no back-pressure. Spring's default scheduler thread pool is `size=1` — one hung render starves all schedulers.

#### 1.2.4 `shorts_queue` as the Only Integration Bus

The queue table is serving simultaneously as: a work queue, a status tracker, a results store (video_path, thumbnail_path), and an audit log. Any reader and writer must understand all these roles simultaneously.

#### 1.2.5 Python `persona_manager` Calls Back to Java API

`persona_manager.py` → `GET http://localhost:9090/api/persona/all` → Java JPA → Oracle

This creates a circular dependency: Python API server initialization (`@app.before_request`) makes an HTTP call to Java, meaning **Python cannot start if Java is not running**. There is no cache TTL, retry backoff, or graceful degradation.

---

### 1.3 Runtime Risks

#### Security
- **CRITICAL**: `hr/hr` Oracle credentials committed to `build/resources/main/application.properties` (in source tree, likely in git history)
- **CRITICAL**: `CORS(app)` — any origin can POST to `/api/generate`, triggering OpenAI API spend and CPU-intensive rendering
- **CRITICAL**: `/test/run-post-scheduler` and `/test/run-shorts-scheduler` are unauthenticated GET endpoints that trigger full crawl + AI generation + DB writes
- **HIGH**: SQL bind TRACE logging (`logging.level.org.hibernate.orm.jdbc.bind=TRACE`) writes all parameterized values to log files, including post content, persona prompts
- **HIGH**: `OPENAI_API_KEY` in `.env` committed to repo (`.env` not in `.gitignore` for naon.py based on gitignore listing)
- **MEDIUM**: No rate limiting on any endpoint; `/api/generate` endpoint has no cost guardrail

#### Failure Propagation
- Python render failure propagates as HTTP 500 back to Java, which calls `markAsFailed(bno)` — but `markAsFailed` also catches exceptions silently, meaning the `bno` can be left in `status=0` forever
- `AiService.askGpt` returns a string starting with `"ERROR:"` on failure; `AiPostGenerationService` checks `rawContent.startsWith("ERROR")` — but `escapeJson()` is called on the error string before storing it, meaning error text can be stored as `shortsScript` in `AI_BOARD`
- `@app.before_request` initialization failure in Flask is unhandled — if `persona_manager.fetch_all_personas()` throws (Java not running), Flask continues serving requests with an empty persona cache, producing silent content quality degradation

#### Concurrency
- `AiScheduler` uses `@Scheduled(fixedDelay=1_800_000)` — single-threaded by default in Spring. If `generateShockingPost` + HTTP call to Python takes >30 minutes, schedules stack
- `ShortsProductionScheduler` fires at 09:00 and 21:00 with no check whether previous run is still active (`_generating_bnos` set is in-process Python memory only, not shared with Java)
- Python `_generating_bnos` set + `_generating_lock` protects within one Flask process but not across multiple workers (gunicorn multi-process)

#### Schema Drift
- `spring.jpa.hibernate.ddl-auto=update` — Hibernate will silently attempt to add/modify columns on startup; if Oracle user `hr` lacks ALTER TABLE rights this fails silently or errors at boot
- `shorts_queue` has no Flyway migration; Python uses raw `INSERT` statements with column names inlined in SQL strings — any column rename breaks both runtimes independently

---

### 1.4 Domain Boundaries

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ CONTENT ORIGIN DOMAIN (Java owns)                                           │
│  CrawlingService → AiPostGenerationService → ReplyGenerationService        │
│  Entities: AI_BOARD, AI_REPLY, AI_PERSONA                                  │
│  External: RSS feeds, HTML crawlers, OpenAI (post/reply generation)         │
└─────────────────────────────────────────────────────────────────────────────┘
         │  publishes BNO via shorts_queue INSERT
         ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ VIDEO PRODUCTION DOMAIN (Python owns)                                       │
│  SmartCurator → shorts_generator → UploadScheduler                         │
│  Entities: shorts_queue (consumer), upload_schedule                         │
│  External: OpenAI (script), edge-tts, moviepy/ffmpeg, YouTube API          │
└─────────────────────────────────────────────────────────────────────────────┘
         │  publishes completion via shorts_queue UPDATE + upload_schedule
         ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ ANALYTICS DOMAIN (Python owns — currently embedded)                         │
│  TrendAnalyzer, SentimentAnalyzer, PerformanceTracker                      │
│  Entities: keyword_trends, reply_sentiment, shorts_performance              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## PHASE 2 — ARCHITECTURAL REDEFINITION

### 2.1 Ownership Boundaries (Strict)

#### Java (AI-Insider) Owns
- All content creation: crawl → AI post → AI replies → `AI_BOARD` + `AI_REPLY` writes
- `AI_BOARD`, `AI_REPLY`, `AI_PERSONA` tables — **exclusive write ownership**
- Scheduling of content creation (`AiScheduler`)
- Board display (Thymeleaf views)
- Publishing a "production job" via a well-defined API call or queue insert — **never directly mutating `shorts_queue` status beyond `0` (pending)**

#### Python (naon.py) Owns
- All video production: curation → script → TTS → render → thumbnail
- `shorts_queue` table — **exclusive write ownership after Java inserts status=0**
- `upload_schedule` table — **exclusive ownership**
- `keyword_trends`, `reply_sentiment`, `shorts_performance` tables — **exclusive ownership**
- YouTube upload and scheduling

#### Shared Read (No Dual Write)
- Python reads `AI_BOARD` (title, content, shorts_script) — read-only
- Java reads `shorts_queue` status and video paths — read-only after initial insert

---

### 2.2 Explicit API Contract (OpenAPI Snapshot)

File: `contracts/shorts-factory-api.yaml`

```yaml
openapi: "3.0.3"
info:
  title: "Shorts Factory API"
  version: "1.0.0"

paths:
  /api/generate:
    post:
      operationId: generateShorts
      security:
        - ApiKeyAuth: []
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/GenerateRequest'
      responses:
        '202':
          description: Accepted, async generation started
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/GenerateAccepted'
        '409':
          description: Already generating for this BNO
        '422':
          description: Validation error
        '500':
          $ref: '#/components/responses/InternalError'

  /api/health:
    get:
      operationId: healthCheck
      responses:
        '200':
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/HealthResponse'

components:
  securitySchemes:
    ApiKeyAuth:
      type: apiKey
      in: header
      name: X-API-Key

  schemas:
    GenerateRequest:
      type: object
      required: [bno, video_type, idempotency_key]
      properties:
        bno:          { type: integer, minimum: 1 }
        video_type:   { type: string, enum: [AGRO, INFO, TREND, COMMUNITY, ENTERTAINMENT] }
        quality_score:{ type: number, minimum: 0, maximum: 10 }
        priority:     { type: integer, minimum: 1, maximum: 10 }
        idempotency_key: { type: string, maxLength: 64 }

    GenerateAccepted:
      type: object
      properties:
        success:   { type: boolean }
        bno:       { type: integer }
        sq_no:     { type: integer }
        trace_id:  { type: string }

    ErrorResponse:
      type: object
      required: [success, error_code, message, trace_id]
      properties:
        success:    { type: boolean, enum: [false] }
        error_code: { type: string }   # MACHINE-READABLE: BNO_NOT_FOUND, LLM_TIMEOUT, etc.
        message:    { type: string }
        trace_id:   { type: string }

  responses:
    InternalError:
      description: Internal server error
      content:
        application/json:
          schema:
            $ref: '#/components/schemas/ErrorResponse'
```

---

### 2.3 Standardized Error Model

#### Python (Flask) — Replace bare `str(e)` error responses

```python
# errors.py
from dataclasses import dataclass
from enum import Enum

class ErrorCode(str, Enum):
    BNO_NOT_FOUND      = "BNO_NOT_FOUND"
    LLM_TIMEOUT        = "LLM_TIMEOUT"
    LLM_FORMAT_ERROR   = "LLM_FORMAT_ERROR"
    RENDER_FAILED      = "RENDER_FAILED"
    TTS_FAILED         = "TTS_FAILED"
    QUEUE_CONFLICT     = "QUEUE_CONFLICT"
    DB_ERROR           = "DB_ERROR"
    VALIDATION_ERROR   = "VALIDATION_ERROR"

@dataclass
class ApiError(Exception):
    error_code: ErrorCode
    message: str
    http_status: int = 500

# Usage in api_server.py
@app.errorhandler(ApiError)
def handle_api_error(e: ApiError):
    return jsonify({
        "success": False,
        "error_code": e.error_code.value,
        "message": e.message,
        "trace_id": g.get("trace_id", "unknown")
    }), e.http_status
```

#### Java — Replace `"ERROR: ..."` string returns

```java
// AiService.java — replace String return type
public sealed interface AiResult permits AiResult.Success, AiResult.Failure {
    record Success(String content) implements AiResult {}
    record Failure(String errorCode, String message) implements AiResult {}
}

// AiPostGenerationService — caller must handle both cases
AiResult result = aiService.askGpt(ctx, persona, task);
if (result instanceof AiResult.Failure f) {
    log.error("LLM call failed: code={} msg={}", f.errorCode(), f.message());
    return null;
}
String rawContent = ((AiResult.Success) result).content();
```

---

### 2.4 DB Schema Versioning Strategy

**Decision**: Flyway (Java-controlled) as single source of truth for all shared tables. Python uses Alembic only for Python-exclusive tables.

#### Flyway (Java — controls all shared tables)
```
src/main/resources/db/migration/
  V1__create_ai_board_ai_reply_ai_persona.sql
  V2__create_shorts_queue.sql
  V3__create_upload_schedule.sql
  V4__add_shorts_queue_error_msg.sql
  V5__add_shorts_queue_trace_id.sql
```

`application.properties`:
```properties
# REPLACE ddl-auto=update with:
spring.jpa.hibernate.ddl-auto=validate
spring.flyway.enabled=true
spring.flyway.locations=classpath:db/migration
spring.flyway.baseline-on-migrate=true
```

#### Alembic (Python — controls Python-exclusive tables)
```
naon.py/alembic/
  versions/
    001_create_keyword_trends.py
    002_create_reply_sentiment.py
    003_create_shorts_performance.py
```

#### DDL Contract for Shared Tables (checked in as `contracts/shared-schema.sql`)
```sql
-- shorts_queue — canonical definition, owned by Flyway V2
CREATE TABLE shorts_queue (
    sq_no          NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    bno            NUMBER NOT NULL REFERENCES AI_BOARD(bno),
    status         NUMBER(1) NOT NULL DEFAULT 0,  -- 0=pending,1=done,9=failed
    video_type     VARCHAR2(20) NOT NULL,
    quality_score  NUMBER(4,2),
    priority       NUMBER(2) DEFAULT 5,
    video_path     VARCHAR2(500),
    thumbnail_path VARCHAR2(500),
    error_msg      VARCHAR2(2000),
    trace_id       VARCHAR2(64),
    idempotency_key VARCHAR2(64) UNIQUE,
    reg_date       TIMESTAMP DEFAULT SYSTIMESTAMP,
    completed_date TIMESTAMP
);
CREATE INDEX idx_sq_bno_status ON shorts_queue(bno, status);
```

---

### 2.5 Idempotency Strategy

#### Java → Python HTTP calls
```java
// ShortsService.requestShortsGeneration
String idempotencyKey = "gen-" + bno + "-" + (System.currentTimeMillis() / 300_000); // 5-min window
requestBody.put("idempotency_key", idempotencyKey);
```

Python stores `idempotency_key` in `shorts_queue` (UNIQUE constraint). On duplicate:
- If existing record is `status=1`: return cached success response
- If existing record is `status=0`: return 409 (in progress)
- If existing record is `status=9`: allow retry with new key

#### DB-Level Idempotency
```sql
-- Java INSERT becomes MERGE
MERGE INTO shorts_queue q
USING (SELECT :bno AS bno, :ikey AS ikey FROM DUAL) src
ON (q.idempotency_key = src.ikey)
WHEN NOT MATCHED THEN
  INSERT (bno, status, video_type, quality_score, priority, idempotency_key, reg_date)
  VALUES (:bno, 0, :vtype, :qscore, :priority, :ikey, SYSTIMESTAMP);
```

---

### 2.6 Observability Baseline

#### Trace ID Propagation

```java
// Java: MDC-based trace ID
// AppConfig.java — add filter bean
@Bean
public FilterRegistrationBean<TraceIdFilter> traceIdFilter() {
    FilterRegistrationBean<TraceIdFilter> bean = new FilterRegistrationBean<>();
    bean.setFilter(new TraceIdFilter());
    bean.addUrlPatterns("/*");
    return bean;
}

public class TraceIdFilter implements Filter {
    @Override
    public void doFilter(ServletRequest req, ServletResponse res, FilterChain chain) {
        String traceId = UUID.randomUUID().toString().replace("-","").substring(0,16);
        MDC.put("traceId", traceId);
        ((HttpServletResponse)res).setHeader("X-Trace-Id", traceId);
        // Also inject into outgoing RestTemplate calls:
        ((HttpServletRequest)req).setAttribute("traceId", traceId);
        chain.doFilter(req, res);
        MDC.clear();
    }
}
```

```python
# Python: Flask g-based trace ID
@app.before_request
def inject_trace_id():
    g.trace_id = request.headers.get("X-Trace-Id") or secrets.token_hex(8)

# logging format update in config.py:
LOG_FORMAT = '%(asctime)s [%(levelname)s] [trace=%(trace_id)s] [bno=%(bno)s] %(message)s'
```

#### Structured Log Format (both runtimes)
```json
{
  "ts": "2026-02-25T09:00:01.123Z",
  "level": "INFO",
  "trace_id": "a1b2c3d4e5f6",
  "bno": 1042,
  "event": "shorts_generation_complete",
  "duration_ms": 47230,
  "video_type": "INFO",
  "runtime": "python"
}
```

#### Metrics (Minimal Baseline — no Prometheus required immediately)
Add to `shorts_queue` table:
```sql
ALTER TABLE shorts_queue ADD (
    script_gen_ms   NUMBER,
    tts_gen_ms      NUMBER,
    render_ms       NUMBER,
    total_ms        NUMBER
);
```

Expose via existing `/api/status` endpoint with P50/P95 aggregates from `shorts_queue`.

---

### 2.7 Security Hardening (Immediate)

#### Java — Spring Security (minimal, non-breaking)
```java
// SecurityConfig.java
@Configuration
@EnableWebSecurity
public class SecurityConfig {
    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
            .csrf(csrf -> csrf.disable())  // REST API
            .authorizeHttpRequests(auth -> auth
                .requestMatchers("/board/**").permitAll()
                .requestMatchers("/api/persona/**").permitAll()
                .requestMatchers("/api/shorts/**").hasRole("INTERNAL")
                .requestMatchers("/api/shorts-script/**").hasRole("INTERNAL")
                .requestMatchers("/test/**").hasRole("ADMIN")
                .anyRequest().authenticated()
            )
            .addFilterBefore(new ApiKeyAuthFilter(), UsernamePasswordAuthenticationFilter.class);
        return http.build();
    }
}
```

```java
// ApiKeyAuthFilter.java
public class ApiKeyAuthFilter extends OncePerRequestFilter {
    private static final String HEADER = "X-Internal-Token";
    @Override
    protected void doFilterInternal(HttpServletRequest req, HttpServletResponse res, FilterChain chain) {
        String token = req.getHeader(HEADER);
        String expected = System.getenv("INTERNAL_API_TOKEN");
        if (expected != null && expected.equals(token)) {
            SecurityContextHolder.getContext().setAuthentication(
                new UsernamePasswordAuthenticationToken("internal", null,
                    List.of(new SimpleGrantedAuthority("ROLE_INTERNAL"),
                            new SimpleGrantedAuthority("ROLE_ADMIN")))
            );
        }
        chain.doFilter(req, res);
    }
}
```

#### Python — API Key Middleware
```python
# auth/middleware.py
API_KEY = os.environ["FACTORY_API_KEY"]

def require_api_key(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        key = request.headers.get("X-API-Key")
        if not key or not secrets.compare_digest(key, API_KEY):
            return jsonify({"success": False, "error_code": "UNAUTHORIZED", 
                          "message": "Invalid API key"}), 401
        return f(*args, **kwargs)
    return decorated

# Apply to all mutation endpoints:
@app.route('/api/generate', methods=['POST'])
@require_api_key
def generate_shorts(): ...

@app.route('/api/curate/premium', methods=['POST'])
@require_api_key
def run_premium_curate(): ...
```

#### Secret Management (Immediate Actions)
```bash
# 1. Rotate Oracle credentials — create dedicated app user
CREATE USER ai_insider_app IDENTIFIED BY <strong_password>;
GRANT SELECT, INSERT, UPDATE ON hr.AI_BOARD TO ai_insider_app;
GRANT SELECT, INSERT, UPDATE ON hr.shorts_queue TO ai_insider_app;
-- (principle of least privilege per domain)

# 2. Set as environment variables — never in application.properties
export DB_USERNAME=ai_insider_app
export DB_PASSWORD=<rotated>
export OPENAI_API_KEY=<rotated>
export INTERNAL_API_TOKEN=<generated>
export FACTORY_API_KEY=<generated>

# 3. application.properties
spring.datasource.username=${DB_USERNAME}
spring.datasource.password=${DB_PASSWORD}
```

```properties
# application.properties — fix log level
logging.level.org.hibernate.orm.jdbc.bind=OFF
spring.jpa.show-sql=false  # in production profile
```

---

## PHASE 3 — PHASED REFACTOR PLAN

See dedicated files: `AI_INSIDER_REFACTOR_PLAN.md` and `NAON_FACTORY_REFACTOR_PLAN.md`

---

## PHASE 4 — FUTURE TRAJECTORY (SaaS in 12 Months)

### 4.1 Components That Must Be Isolated for Scale

| Component | Why It Must Be Isolated | Target Isolation |
|---|---|---|
| `shorts_generator.py` (render worker) | CPU/memory intensive, blocks entire Python process; one slow render delays all API responses | Separate process pool / worker service |
| `AiService.askGpt` (Java LLM calls) | Unbounded latency from OpenAI; blocks scheduler thread | Async HTTP + timeout + circuit breaker |
| `upload_youtube.py` | OAuth token state, long-running I/O, rate limits per channel | Isolated upload service per tenant channel |
| `CrawlingService` | Network I/O, external blocking, rate limiting per source | Separate scheduler process |
| Oracle `shorts_queue` | Becomes the bottleneck table for all coordination; needs partitioning for multi-tenant | Migrate to dedicated job queue (Redis Streams or Postgres pg-boss) |

### 4.2 Components That Can Remain Monolithic

| Component | Reason |
|---|---|
| `AI_BOARD` + `AI_REPLY` + board display | Low volume, Thymeleaf rendering is fine for single-tenant phase |
| `SmartCurator` + `TrendAnalyzer` | Read-heavy, stateless per-request; stays in Python process |
| `persona_manager` | Low-frequency reads; cache TTL is sufficient |
| `SentimentAnalyzer` + `PerformanceTracker` | Analytics workload; can batch-run separately without isolation |

### 4.3 Minimal Abstraction Layers (No Infrastructure Explosion)

#### Layer 1: Internal Job Queue (Redis — single instance, no cluster)
Replace `shorts_queue` DB polling with Redis Lists:
```python
# Python worker pulls from queue instead of DB polling
job = redis_client.blpop("shorts:jobs", timeout=30)  # blocking pop, no sleep loop
```
Java pushes:
```java
// After saving Board to DB:
redisTemplate.opsForList().rightPush("shorts:jobs", 
    objectMapper.writeValueAsString(Map.of("bno", saved.getBno(), "video_type", videoType)));
```
Migration: Keep `shorts_queue` DB table as audit log; Redis becomes the signaling layer.

#### Layer 2: Tenant Column on Key Tables
Add to `AI_BOARD`, `shorts_queue`, `upload_schedule` before any multi-tenant work:
```sql
ALTER TABLE AI_BOARD ADD (tenant_id VARCHAR2(50) DEFAULT 'default');
ALTER TABLE shorts_queue ADD (tenant_id VARCHAR2(50) DEFAULT 'default');
CREATE INDEX idx_board_tenant ON AI_BOARD(tenant_id);
```
Java: Inject `tenant_id` from `ThreadLocal` context (set via request header `X-Tenant-Id`).

#### Layer 3: Python Worker Process Separation
Split `api_server.py` and `main.py` into roles without full microservice decomposition:
```
naon.py/
  api_server.py      ← HTTP API only (no blocking work)
  worker.py          ← render/TTS/upload, pulled via Redis queue
  scheduler.py       ← curation cron, lightweight
```
Deploy as three separate `systemd` services on the same host — horizontal scaling later via adding more `worker.py` instances.

#### Layer 4: Config Service (Prepare for Multi-Tenant Prompts)
Extract prompt templates and banned-word lists from Java source into a database table:
```sql
CREATE TABLE ai_policy (
    policy_id   NUMBER GENERATED ALWAYS AS IDENTITY,
    policy_type VARCHAR2(50),  -- 'banned_phrase', 'prompt_template'
    policy_key  VARCHAR2(100),
    policy_value CLOB,
    tenant_id   VARCHAR2(50) DEFAULT 'default',
    version     NUMBER DEFAULT 1
);
```
Java reads policies at startup (cached, refreshed every 10 min) rather than hardcoding them in `AiPostGenerationService`.

### 4.4 SaaS Evolution Path

```
Now (Single Tenant, Single Host)
  ↓  PR-01 through PR-05: Security + Schema versioning + Error model
  
Phase A (Multi-Persona, Single Tenant)
  ↓  PR-06 through PR-10: Redis queue + Worker split + Observability
  
Phase B (Multi-Channel Upload)
  ↓  Tenant column + per-channel OAuth + upload worker isolation
  
Phase C (Multi-Tenant SaaS)
  ↓  Auth service + tenant routing + per-tenant Oracle schema or PG migration
  
Phase D (Scale-Out)
  ↓  Kubernetes workers for render + distributed tracing (Jaeger/Tempo)
```

The key constraint at every phase: **do not add infrastructure you cannot operate**. Redis before Kafka. Separate processes before containers. Postgres before Kubernetes. The current system's deepest problems are not scale problems — they are correctness and security problems that no amount of infrastructure solves.
