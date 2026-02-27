# AI_INSIDER_REFACTOR_PLAN.md
> Java Spring Boot Refactor Plan — Incremental PR-Sized Steps  
> System: AI-Insider (`com.cw.aibot`)

---

## Guiding Principles

- Each PR is independently deployable and rollbackable.
- No PR breaks existing behavior observable by the Python factory.
- Security PRs have zero-tolerance rollback criteria.
- PRs are ordered by risk: P0 (fire) → P1 (structural) → P2 (quality) → P3 (future).

---

## PR-01 — Credential Rotation & Secret Extraction

**Objective**: Eliminate hardcoded `hr/hr` credentials and OpenAI key from all files. Prevent incident recurrence of credential exposure via committed artifacts.

**Files/Modules Affected**:
- `build/resources/main/application.properties` — **remove from VCS entirely**
- `src/main/resources/application.properties` — create if absent, make canonical
- `src/main/resources/application-prod.properties` — new
- `build.gradle` — verify `build/` is in `.gitignore`
- `.gitignore` — add `build/resources/main/`, `*.properties` with credentials

**Changes**:
```properties
# src/main/resources/application.properties (committed, no secrets)
server.port=${SERVER_PORT:9090}
spring.datasource.driver-class-name=oracle.jdbc.OracleDriver
spring.datasource.url=${DB_URL:jdbc:oracle:thin:@localhost:1521/FREE}
spring.datasource.username=${DB_USERNAME}
spring.datasource.password=${DB_PASSWORD}
spring.jpa.hibernate.ddl-auto=validate
logging.level.org.hibernate.orm.jdbc.bind=OFF
logging.level.org.hibernate.SQL=${SQL_LOG_LEVEL:OFF}
spring.jpa.show-sql=${SHOW_SQL:false}
openai.api.key=${OPENAI_API_KEY}
openai.api.url=${OPENAI_API_URL:https://api.openai.com/v1/chat/completions}
python.api.url=${PYTHON_API_URL:http://localhost:5001}
internal.api.token=${INTERNAL_API_TOKEN}
```

**Migration Steps**:
1. `git rm --cached build/resources/main/application.properties`
2. Add `build/` to `.gitignore`
3. Set environment variables on deployment host: `DB_USERNAME`, `DB_PASSWORD`, `OPENAI_API_KEY`, `INTERNAL_API_TOKEN`
4. Update `AiService` to read `openai.api.key` from `@Value` not `System.getenv()` directly (for testability)
5. Rotate Oracle password, OpenAI key after merge

**Risk Level**: 🟡 MEDIUM — Startup fails if env vars missing. Mitigated by step 3 before deploy.

**Rollback Strategy**: Restore `application.properties` with literal values, redeploy. But do NOT roll back the credential rotation itself.

**Validation**:
- `./gradlew build` succeeds with env vars set
- App starts, `GET /board/list` returns 200
- `GET /api/persona/all` returns persona data
- Verify `build/resources/main/application.properties` not in git after push

---

## PR-02 — Disable Unauthenticated Operation Endpoints

**Objective**: Block `GET /test/run-post-scheduler` and `GET /test/run-shorts-scheduler` from public access. Prevents unauthorized triggered spend (OpenAI API calls per hit).

**Files/Modules Affected**:
- `build.gradle` — add `spring-boot-starter-security`
- `src/main/java/com/cw/aibot/config/SecurityConfig.java` — new
- `src/main/java/com/cw/aibot/config/ApiKeyAuthFilter.java` — new
- `src/main/java/com/cw/aibot/controller/TestController.java` — add profile guard

**Changes**:
```java
// SecurityConfig.java
@Configuration
@EnableWebSecurity
public class SecurityConfig {
    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        return http
            .csrf(csrf -> csrf.disable())
            .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
            .authorizeHttpRequests(auth -> auth
                .requestMatchers("/board/**", "/css/**", "/js/**").permitAll()
                .requestMatchers("/api/persona/**").hasRole("INTERNAL")
                .requestMatchers("/api/shorts/**", "/api/shorts-script/**").hasRole("INTERNAL")
                .requestMatchers("/test/**").hasRole("ADMIN")
                .anyRequest().denyAll()
            )
            .addFilterBefore(new ApiKeyAuthFilter(), UsernamePasswordAuthenticationFilter.class)
            .build();
    }
}
```

```java
// ApiKeyAuthFilter.java — stateless token check
public class ApiKeyAuthFilter extends OncePerRequestFilter {
    @Override
    protected void doFilterInternal(HttpServletRequest req, HttpServletResponse res, FilterChain chain)
            throws ServletException, IOException {
        String token = req.getHeader("X-Internal-Token");
        String expected = System.getenv("INTERNAL_API_TOKEN");
        if (expected != null && !expected.isBlank() && expected.equals(token)) {
            List<GrantedAuthority> authorities = List.of(
                new SimpleGrantedAuthority("ROLE_INTERNAL"),
                new SimpleGrantedAuthority("ROLE_ADMIN")
            );
            SecurityContextHolder.getContext().setAuthentication(
                new UsernamePasswordAuthenticationToken("internal", null, authorities)
            );
        }
        chain.doFilter(req, res);
    }
}
```

**Migration Steps**:
1. Add `implementation 'org.springframework.boot:spring-boot-starter-security'` to `build.gradle`
2. Set `INTERNAL_API_TOKEN` env var on deployment host (shared with Python via same env)
3. Update Python `ShortsService` HTTP calls to include header:
   ```java
   headers.set("X-Internal-Token", System.getenv("INTERNAL_API_TOKEN"));
   ```
4. Update any internal scripts that call `/test/*` endpoints to include the token header

**Risk Level**: 🟠 HIGH — Any existing caller that lacks the header will immediately receive 403.

**Rollback Strategy**: Remove `SecurityConfig.java`, remove security dependency from `build.gradle`. App reverts to fully open. Rollback window: 5 minutes.

**Validation**:
- `curl /test/run-post-scheduler` → 403 without header
- `curl -H "X-Internal-Token: $INTERNAL_API_TOKEN" /test/run-post-scheduler` → triggers scheduler
- `curl /board/list` → 200 (public access preserved)
- `curl /api/persona/all` without token → 401/403

---

## PR-03 — Flyway Schema Versioning (Replace ddl-auto=update)

**Objective**: Replace `spring.jpa.hibernate.ddl-auto=update` with Flyway-managed migrations. Prevents silent schema drift and enables coordinated Java/Python deployments.

**Files/Modules Affected**:
- `build.gradle` — add `org.flywaydb:flyway-core` + Oracle dialect dep
- `src/main/resources/application.properties`
- `src/main/resources/db/migration/V1__baseline_schema.sql` — new
- `src/main/resources/db/migration/V2__add_shorts_queue.sql` — new
- `src/main/resources/db/migration/V3__add_idempotency_and_trace.sql` — new

**V1__baseline_schema.sql** (captures current state):
```sql
-- Baseline: existing tables already in production Oracle
-- Flyway baseline-on-migrate handles pre-existing tables
-- This migration is a no-op for existing schemas (baseline only)
SELECT 1 FROM DUAL;
```

**V2__add_shorts_queue.sql**:
```sql
-- Canonical DDL for shorts_queue (idempotent)
DECLARE
  v_count NUMBER;
BEGIN
  SELECT COUNT(*) INTO v_count FROM user_tables WHERE table_name = 'SHORTS_QUEUE';
  IF v_count = 0 THEN
    EXECUTE IMMEDIATE '
      CREATE TABLE shorts_queue (
        sq_no          NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        bno            NUMBER NOT NULL,
        status         NUMBER(1) DEFAULT 0 NOT NULL,
        video_type     VARCHAR2(20) NOT NULL,
        quality_score  NUMBER(4,2),
        priority       NUMBER(2) DEFAULT 5,
        video_path     VARCHAR2(500),
        thumbnail_path VARCHAR2(500),
        error_msg      VARCHAR2(2000),
        reg_date       TIMESTAMP DEFAULT SYSTIMESTAMP,
        completed_date TIMESTAMP
      )';
    EXECUTE IMMEDIATE 'CREATE INDEX idx_sq_bno_status ON shorts_queue(bno, status)';
  END IF;
END;
/
```

**V3__add_idempotency_and_trace.sql**:
```sql
ALTER TABLE shorts_queue ADD (
  idempotency_key VARCHAR2(64),
  trace_id        VARCHAR2(64),
  script_gen_ms   NUMBER,
  render_ms       NUMBER,
  total_ms        NUMBER
);
ALTER TABLE shorts_queue ADD CONSTRAINT uq_sq_idempotency UNIQUE (idempotency_key);
```

**application.properties changes**:
```properties
spring.jpa.hibernate.ddl-auto=validate
spring.flyway.enabled=true
spring.flyway.locations=classpath:db/migration
spring.flyway.baseline-on-migrate=true
spring.flyway.baseline-version=1
```

**Migration Steps**:
1. Take Oracle schema export as backup: `expdp hr/hr tables=AI_BOARD,AI_REPLY,AI_PERSONA,shorts_queue`
2. Deploy app with `flyway.baseline-on-migrate=true` — Flyway marks existing schema as V1
3. V2 runs only if `shorts_queue` doesn't exist (idempotent DDL)
4. V3 adds new columns (safe ALTER ADD on Oracle)

**Risk Level**: 🟡 MEDIUM — Flyway baseline on first run. V3 ALTER is safe (adding nullable columns).

**Rollback Strategy**: Set `spring.flyway.enabled=false`, revert `ddl-auto=update`. V3 columns can remain (unused). Schema backup from step 1 available.

**Validation**:
- App starts without Flyway errors
- `SELECT * FROM flyway_schema_history` shows 3 applied versions
- `shorts_queue` has `idempotency_key`, `trace_id` columns
- `Board` entity still loads via JPA (ddl-auto=validate passes)

---

## PR-04 — Typed AiService Result + Error Model

**Objective**: Replace `AiService.askGpt` returning `"ERROR: ..."` strings with a typed result. Prevents error strings from being stored as post content or shorts scripts in `AI_BOARD`.

**Files/Modules Affected**:
- `src/main/java/com/cw/aibot/service/AiService.java`
- `src/main/java/com/cw/aibot/service/AiPostGenerationService.java`
- `src/main/java/com/cw/aibot/service/ReplyGenerationService.java`
- `src/main/java/com/cw/aibot/DTO/AiResult.java` — new

**AiResult.java**:
```java
package com.cw.aibot.DTO;

public sealed interface AiResult permits AiResult.Success, AiResult.Failure {
    record Success(String content) implements AiResult {}
    record Failure(String errorCode, String message, Throwable cause) implements AiResult {
        public Failure(String errorCode, String message) { this(errorCode, message, null); }
    }

    static AiResult success(String content) { return new Success(content); }
    static AiResult failure(String code, String msg) { return new Failure(code, msg); }
}
```

**AiService.java** — change return type:
```java
public AiResult askGpt(String recentCtx, String personaPrompt, String task) {
    try {
        // ... existing HTTP call logic ...
        String content = choices.get(0).get("message")... ;
        if (content == null || content.isBlank()) {
            return AiResult.failure("LLM_EMPTY_RESPONSE", "OpenAI returned empty content");
        }
        return AiResult.success(content);
    } catch (HttpClientErrorException e) {
        log.error("OpenAI HTTP error: status={}", e.getStatusCode());
        return AiResult.failure("LLM_HTTP_ERROR", "HTTP " + e.getStatusCode());
    } catch (Exception e) {
        log.error("OpenAI call failed", e);
        return AiResult.failure("LLM_EXCEPTION", e.getMessage());
    }
}
```

**AiPostGenerationService.java** — update all callers:
```java
AiResult result = aiService.askGpt("", writer.getPrompt(), contentTask);
if (result instanceof AiResult.Failure f) {
    log.error("Post generation LLM failure: code={} msg={} topic={}", 
              f.errorCode(), f.message(), topic.getTitle());
    return null;  // explicit null, not stored in DB
}
String rawContent = ((AiResult.Success) result).content();
// No more .startsWith("ERROR") checks
```

**Risk Level**: 🟢 LOW — Internal refactor, no external contract change. Behavior is identical for success path.

**Rollback Strategy**: Revert `AiService.java` and callers. No DB change required.

**Validation**:
- Mock OpenAI to return error → verify no `AI_BOARD` row created, no error string in `shorts_script`
- Normal generation flow → `AI_BOARD` row created with valid content
- Check logs: `AiResult.Failure` logs appear as structured error, not as content

---

## PR-05 — Trace ID Injection + Structured Logging

**Objective**: Add correlation trace IDs to all log lines and outbound HTTP headers. Required for debugging cross-runtime failures.

**Files/Modules Affected**:
- `src/main/java/com/cw/aibot/config/TraceIdFilter.java` — new
- `src/main/java/com/cw/aibot/config/AppConfig.java`
- `src/main/java/com/cw/aibot/service/ShortsService.java`
- `src/main/resources/logback-spring.xml` — new

**TraceIdFilter.java**:
```java
public class TraceIdFilter extends OncePerRequestFilter {
    @Override
    protected void doFilterInternal(HttpServletRequest req, HttpServletResponse res, FilterChain chain)
            throws ServletException, IOException {
        String inbound = req.getHeader("X-Trace-Id");
        String traceId = (inbound != null && !inbound.isBlank()) 
            ? inbound 
            : UUID.randomUUID().toString().replace("-","").substring(0,16);
        MDC.put("traceId", traceId);
        res.setHeader("X-Trace-Id", traceId);
        req.setAttribute("traceId", traceId);
        try {
            chain.doFilter(req, res);
        } finally {
            MDC.clear();
        }
    }
}
```

**logback-spring.xml**:
```xml
<configuration>
  <springProfile name="!test">
    <appender name="STDOUT" class="ch.qos.logback.core.ConsoleAppender">
      <encoder>
        <pattern>%d{ISO8601} [%level] [trace=%X{traceId}] [bno=%X{bno}] %logger{36} - %msg%n</pattern>
      </encoder>
    </appender>
  </springProfile>
  <root level="INFO">
    <appender-ref ref="STDOUT"/>
  </root>
</configuration>
```

**ShortsService.java** — propagate trace ID outbound:
```java
public boolean requestShortsGeneration(Long bno, String videoType) {
    String traceId = (String) RequestContextHolder.currentRequestAttributes()
        .getAttribute("traceId", RequestAttributes.SCOPE_REQUEST);
    if (traceId != null) headers.set("X-Trace-Id", traceId);
    MDC.put("bno", String.valueOf(bno));
    // ... rest of method
}
```

For scheduler-triggered flows (no HTTP request context), generate trace ID in scheduler:
```java
// AiScheduler.java
@Scheduled(fixedDelay = 1_800_000)
public void scheduledPostCreation() {
    String traceId = "sched-" + UUID.randomUUID().toString().replace("-","").substring(0,12);
    MDC.put("traceId", traceId);
    try {
        // ... existing logic
    } finally {
        MDC.clear();
    }
}
```

**Risk Level**: 🟢 LOW — Additive only. No behavior change.

**Rollback Strategy**: Remove filter bean registration. No state change required.

**Validation**:
- Request to `/api/shorts/generate/1` produces response header `X-Trace-Id: abc123`
- All log lines for that request contain `[trace=abc123]`
- Python receives `X-Trace-Id` header and logs matching trace ID

---

## PR-06 — Decouple Scheduler from Synchronous Python HTTP

**Objective**: Remove blocking HTTP call to Python `/api/generate` from `AiScheduler`. Replace with queue-based decoupling (DB signal or Redis). Prevents `@Scheduled` thread starvation.

**Files/Modules Affected**:
- `src/main/java/com/cw/aibot/service/AiScheduler.java`
- `src/main/java/com/cw/aibot/service/AiPostGenerationService.java`
- `src/main/java/com/cw/aibot/service/ShortsService.java` (optional HTTP call preserved for manual API)
- `src/main/java/com/cw/aibot/config/SchedulerConfig.java` — new

**SchedulerConfig.java** — dedicated thread pool for each scheduler:
```java
@Configuration
public class SchedulerConfig implements SchedulingConfigurer {
    @Override
    public void configureTasks(ScheduledTaskRegistrar registrar) {
        ThreadPoolTaskScheduler scheduler = new ThreadPoolTaskScheduler();
        scheduler.setPoolSize(3);
        scheduler.setThreadNamePrefix("ai-sched-");
        scheduler.initialize();
        registrar.setTaskScheduler(scheduler);
    }
}
```

**AiScheduler.java** — fire and forget (Java inserts queue row; Python polls):
```java
@Scheduled(fixedDelay = 1_800_000)
public void scheduledPostCreation() {
    String traceId = "sched-" + UUID.randomUUID().toString().replace("-","").substring(0,12);
    MDC.put("traceId", traceId);
    try {
        List<RawTopic> topics = crawlingService.fetchLatestTopics(15);
        for (RawTopic topic : topics) {
            Board board = aiPostGenerationService.generateShockingPost(topic);
            if (board != null) {
                replyGenerationService.generateReplies(board);
                // ← REMOVED: shortsService.requestShortsGeneration(board.getBno(), videoType)
                // shorts_queue INSERT already done in generateShockingPost()
                // Python factory polls shorts_queue status=0 independently
                log.info("[trace={}] Post queued for production: bno={}", traceId, board.getBno());
            }
        }
    } finally {
        MDC.clear();
    }
}
```

**AiPostGenerationService.java** — add idempotency key to queue INSERT:
```java
String idempotencyKey = "auto-" + saved.getBno() + "-" + (System.currentTimeMillis() / 300_000);
String sql = """
    INSERT INTO shorts_queue (bno, status, video_type, quality_score, priority, 
                               idempotency_key, trace_id, reg_date)
    VALUES (?, 0, ?, 5.0, 5, ?, ?, SYSTIMESTAMP)
    """;
jdbcTemplate.update(sql, saved.getBno(), videoType, idempotencyKey, 
                    MDC.get("traceId"));
```

**ShortsService.requestShortsGeneration** — retained only for `POST /api/shorts/generate/{bno}` manual trigger. Add timeout:
```java
restTemplate.setRequestFactory(new SimpleClientHttpRequestFactory() {{
    setConnectTimeout(5_000);
    setReadTimeout(300_000);  // 5 min max for render
}});
```

**Risk Level**: 🟡 MEDIUM — Changes how `AiScheduler` interacts with Python. Python must be polling `shorts_queue` (it already does via `main.py`). Verify Python `main.py` loop is running.

**Rollback Strategy**: Revert `AiScheduler.java` to include `requestShortsGeneration` call. 

**Validation**:
- Run `GET /test/run-post-scheduler` — returns quickly without waiting for Python render
- Verify `shorts_queue` row inserted with `status=0`
- Python `main.py` picks up the row and processes it
- No scheduler thread blocking observed in thread dump

---

## PR-07 — Idempotency Key + MERGE on Queue Insert

**Objective**: Replace `INSERT INTO shorts_queue` with `MERGE` to prevent duplicate queue entries when scheduler retries or manual triggers overlap with auto-scheduling.

**Files/Modules Affected**:
- `src/main/java/com/cw/aibot/service/AiPostGenerationService.java`
- `src/main/java/com/cw/aibot/service/ShortsService.java`

**AiPostGenerationService.java**:
```java
// Replace INSERT with MERGE
String mergeSQL = """
    MERGE INTO shorts_queue tgt
    USING (SELECT :bno AS bno, :ikey AS ikey FROM DUAL) src
    ON (tgt.idempotency_key = src.ikey)
    WHEN NOT MATCHED THEN
      INSERT (bno, status, video_type, quality_score, priority, idempotency_key, trace_id, reg_date)
      VALUES (:bno, 0, :vtype, :qscore, :priority, :ikey, :tid, SYSTIMESTAMP)
    """;
jdbcTemplate.update(mergeSQL, 
    saved.getBno(), idempotencyKey, videoType, 5.0, 5, idempotencyKey, MDC.get("traceId"));
```

**Risk Level**: 🟢 LOW — SQL change only. MERGE is atomic on Oracle.

**Rollback Strategy**: Revert SQL to INSERT. If unique constraint on `idempotency_key` is hit, it surfaces as exception (better than silent duplicate).

**Validation**:
- Run scheduler twice rapidly — no duplicate `shorts_queue` rows for same BNO + time window
- Manual `POST /api/shorts/generate/1` followed immediately by another → 409 or second MERGE is no-op

---

## PR-08 — ShortsProductionScheduler Overlap Guard

**Objective**: Prevent `ShortsProductionScheduler` from running concurrent instances at 09:00 and 21:00 if previous run exceeds its time window.

**Files/Modules Affected**:
- `src/main/java/com/cw/aibot/service/ShortsProductionScheduler.java`

```java
@Slf4j
@Service
@RequiredArgsConstructor
public class ShortsProductionScheduler {
    private final AtomicBoolean running = new AtomicBoolean(false);

    @Scheduled(cron = "0 0 9,21 * * *")
    public void produceShorts() {
        if (!running.compareAndSet(false, true)) {
            log.warn("ShortsProductionScheduler: previous run still active, skipping");
            return;
        }
        String traceId = "shorts-sched-" + UUID.randomUUID().toString().replace("-","").substring(0,8);
        MDC.put("traceId", traceId);
        try {
            // ... existing curate + generate logic
        } finally {
            running.set(false);
            MDC.clear();
        }
    }
}
```

**Risk Level**: 🟢 LOW — Guard only. No logic change.

**Rollback Strategy**: Remove `AtomicBoolean` guard. No state change.

**Validation**:
- Trigger scheduler manually twice in quick succession → second call logs "skipping"
- Normal single-run: executes fully

---

## PR-09 — BoardController Service Layer Extraction

**Objective**: `BoardController` directly calls `BoardRepository` and `ReplyRepository` (bypassing service layer). Extract to `BoardService` for proper transaction management and future caching.

**Files/Modules Affected**:
- `src/main/java/com/cw/aibot/controller/BoardController.java`
- `src/main/java/com/cw/aibot/service/BoardService.java` — new
- `src/main/java/com/cw/aibot/repository/BoardRepository.java`
- `src/main/java/com/cw/aibot/repository/ReplyRepository.java`

**BoardService.java** (extract existing logic):
```java
@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class BoardService {
    private final BoardRepository boardRepo;
    private final ReplyRepository replyRepo;

    public List<Board> findBestBoards(int limit) { ... }
    public List<Board> findByCategory(String category) { ... }
    
    @Transactional
    public Board findByIdAndIncrementHit(Long bno) {
        Board board = boardRepo.findById(bno).orElseThrow();
        board.setHit(board.getHit() + 1);
        return boardRepo.save(board);
    }

    @Transactional
    public Reply addReply(Long bno, String content, String writer) { ... }
}
```

**Risk Level**: 🟢 LOW — Refactor only, behavior identical.

**Rollback Strategy**: Revert `BoardController` to direct repository calls.

**Validation**:
- All board endpoint responses identical before/after
- Transaction boundaries verified: hit increment is committed in same transaction as read

---

## PR-10 — ShortsScriptController Fallback Cleanup

**Objective**: `ShortsScriptController.parseTimeline` has 3-tier fallback (JSON → legacy JSON → plain text). This silently degrades and returns malformed data to Python. Add explicit validation and rejection.

**Files/Modules Affected**:
- `src/main/java/com/cw/aibot/controller/ShortsScriptController.java`
- `src/main/java/com/cw/aibot/DTO/ShortsScriptDTO.java`

**Changes**:
- Add `script_version` field to `ShortsScriptDTO` indicating which parse path succeeded
- Log `WARN` with `bno` when fallback is used — creates observability of data quality degradation
- Return `script_version: "plain_text_fallback"` in response so Python can handle accordingly
- Add metric counter: track how often each fallback tier is hit (write to `shorts_queue.error_msg` field as JSON annotation if plain-text fallback occurs)

**Risk Level**: 🟢 LOW — Additive logging and DTO field. No behavior change.

**Rollback Strategy**: Remove new DTO field and logging. No external contract change since field is additive.

**Validation**:
- BNO with timeline JSON: `script_version = "timeline_v2"`
- BNO with legacy JSON: `script_version = "timeline_v1"`, WARN log emitted
- BNO with plain text only: `script_version = "plain_text_fallback"`, WARN log + error_msg annotation

---

## Deployment Order & Dependencies

```
PR-01 (secrets)
  └─ PR-02 (auth) — depends on INTERNAL_API_TOKEN from PR-01
       └─ PR-03 (flyway) — depends on ddl=validate (credentials must work first)
            └─ PR-04 (typed errors) — depends on clean schema from PR-03
                 └─ PR-05 (trace IDs) — additive, can go parallel with PR-04
                      └─ PR-06 (decouple scheduler) — depends on PR-05 trace IDs
                           └─ PR-07 (idempotency MERGE) — depends on PR-03 column additions
                                └─ PR-08 (overlap guard) — independent, any time after PR-06
                                     └─ PR-09 (service layer) — independent
                                          └─ PR-10 (script fallback) — last, cleanup
```

## Regression Test Baseline

Before any PR, capture:
```bash
# 1. Record current board list response
curl -s http://localhost:9090/board/list > baseline_board_list.json

# 2. Record persona API response
curl -s http://localhost:9090/api/persona/all > baseline_personas.json

# 3. Capture shorts_queue row count
sqlplus hr/hr@FREE <<< "SELECT COUNT(*) FROM shorts_queue WHERE status=0;"

# 4. Trigger one manual post generation and verify bno created
curl -H "X-Internal-Token: $INTERNAL_API_TOKEN" http://localhost:9090/test/run-post-scheduler
```

After each PR, re-run and diff. Any deviation outside expected behavior = rollback.
