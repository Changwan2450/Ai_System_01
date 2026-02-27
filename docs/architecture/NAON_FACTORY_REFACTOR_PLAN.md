# NAON_FACTORY_REFACTOR_PLAN.md
> Python Flask Factory Refactor Plan — Incremental PR-Sized Steps  
> System: naon.py (Flask, SQLAlchemy, moviepy, edge-tts)

---

## Guiding Principles

- Each PR deployable independently; `api_server.py` and `main.py` remain runnable after each.
- Python process must not crash due to Java API unavailability at startup.
- No PR requires Docker, Kubernetes, or external message broker — single-host improvements only.
- PRs ordered: P0 (active security/crash risk) → P1 (correctness) → P2 (observability) → P3 (architecture).

---

## PR-PY-01 — Secret Extraction & Credential Rotation

**Objective**: Remove `hr/hr` credentials from `config.py`. Remove any committed `.env` file. Prevent recurrence of incident where Oracle credentials were accessible to anyone with repo access.

**Files/Modules Affected**:
- `config.py` — remove all hardcoded fallback values for secrets
- `.env` — **remove from VCS**, add to `.gitignore`
- `.gitignore` — add `.env`, `*.log`, `output/`, `temp/`, `auth/client_secrets.json`
- `naon.py/auth/` — ensure `client_secrets.json` is in `.gitignore`

**Changes to `config.py`**:
```python
# DB — no hardcoded fallback
_db_user = os.environ["DB_USERNAME"]          # fails fast if missing
_db_pass = os.environ["DB_PASSWORD"]
_db_host = os.environ.get("DB_HOST", "localhost")
_db_port = os.environ.get("DB_PORT", "1521")
_db_svc  = os.environ.get("DB_SERVICE", "FREE")

DB_CONNECTION_STRING = (
    f"oracle+oracledb://{_db_user}:{_db_pass}"
    f"@{_db_host}:{_db_port}/?service_name={_db_svc}"
)

OPENAI_API_KEY = os.environ["OPENAI_API_KEY"]   # fail fast — no empty string default
FACTORY_API_KEY = os.environ["FACTORY_API_KEY"] # new — for inbound auth

JAVA_API_URL = os.environ.get("JAVA_API_URL", "http://localhost:9090")
```

**env.example** (committed, no secrets):
```
DB_USERNAME=
DB_PASSWORD=
DB_HOST=localhost
DB_PORT=1521
DB_SERVICE=FREE
OPENAI_API_KEY=
FACTORY_API_KEY=
JAVA_API_URL=http://localhost:9090
PYTHON_API_HOST=0.0.0.0
PYTHON_API_PORT=5001
```

**Migration Steps**:
1. `git rm --cached naon.py/.env`
2. Add `.env` to `.gitignore`
3. Create `.env.example` and commit
4. Set real values in `.env` on server (not committed) or via systemd `EnvironmentFile`
5. Rotate Oracle password and OpenAI key after merge

**Risk Level**: 🟠 HIGH — Process will fail to start if env vars not set. Mitigated by step 4.

**Rollback Strategy**: Restore hardcoded fallbacks in `config.py`. But do NOT restore the committed `.env`.

**Validation**:
- Start `api_server.py` without env vars → `KeyError` on `DB_USERNAME`, immediate fail-fast
- Start with env vars set → `GET /api/health` returns 200
- `git log -- .env` confirms `.env` removed from history (if history rewrite is performed)

---

## PR-PY-02 — API Key Authentication on All Mutation Endpoints

**Objective**: Protect `/api/generate`, `/api/curate/premium` from unauthenticated access. Replace `CORS(app)` wildcard with origin whitelist. Prevents unauthorized OpenAI spend and CPU-intensive render triggers.

**Files/Modules Affected**:
- `api_server.py`
- `auth/middleware.py` — new
- `config.py`

**auth/middleware.py**:
```python
import os
import hmac
import secrets
from functools import wraps
from flask import request, jsonify, g

FACTORY_API_KEY = os.environ.get("FACTORY_API_KEY", "")

def require_api_key(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        provided = request.headers.get("X-API-Key", "")
        if not FACTORY_API_KEY:
            # Key not configured → reject all (fail closed)
            return jsonify({"success": False, "error_code": "CONFIG_ERROR",
                          "message": "API key not configured on server"}), 503
        if not provided or not hmac.compare_digest(provided, FACTORY_API_KEY):
            return jsonify({"success": False, "error_code": "UNAUTHORIZED",
                          "message": "Invalid or missing X-API-Key"}), 401
        return f(*args, **kwargs)
    return decorated
```

**api_server.py changes**:
```python
from flask_cors import CORS
from auth.middleware import require_api_key

# Replace CORS(app) wildcard
ALLOWED_ORIGINS = os.environ.get("CORS_ORIGINS", "http://localhost:9090").split(",")
CORS(app, origins=ALLOWED_ORIGINS, methods=["GET", "POST"])

# Apply decorator to mutation endpoints
@app.route('/api/generate', methods=['POST'])
@require_api_key
def generate_shorts(): ...

@app.route('/api/curate/premium', methods=['POST'])
@require_api_key
def run_premium_curate(): ...
```

**Java ShortsService.java** — add API key header (coordinate with PR-02):
```java
headers.set("X-API-Key", System.getenv("FACTORY_API_KEY"));
```

**Risk Level**: 🟠 HIGH — Java callers must include header or they get 401. Coordinate deploy order: Python first (with key), then Java (with header).

**Rollback Strategy**: Remove `@require_api_key` decorators. Restore `CORS(app)`.

**Validation**:
- `curl -X POST /api/generate -d '{"bno":1}'` without key → 401
- `curl -X POST /api/generate -H "X-API-Key: $FACTORY_API_KEY" -d '{"bno":1}'` → processes
- Java `POST /api/shorts/generate/1` → succeeds with key header

---

## PR-PY-03 — `@app.before_request` Initialization Safety

**Objective**: Fix thread-unsafe `_initialized` flag that causes multiple concurrent initializations in multi-threaded gunicorn. Fix crash if Java API unreachable at startup.

**Files/Modules Affected**:
- `api_server.py`
- `persona_manager.py`

**api_server.py** — thread-safe init with graceful degradation:
```python
import threading

_init_lock = threading.Lock()
_initialized = False

@app.before_request
def initialize():
    global _initialized
    if _initialized:
        return
    with _init_lock:
        if _initialized:  # double-check after acquiring lock
            return
        logger.info("Initializing Flask server...")
        try:
            persona_manager.fetch_all_personas()
        except Exception as e:
            # Log but do NOT crash — personas will be fetched lazily on first generate call
            logger.error(f"Persona initialization failed (Java API may be down): {e}")
        try:
            analyzer = TrendAnalyzer(DB_ENGINE)
            analyzer.analyze_recent_trends(days=7)
        except Exception as e:
            logger.warning(f"Trend initialization failed (non-fatal): {e}")
        _initialized = True
        logger.info("Flask server initialized")
```

**persona_manager.py** — add lazy fetch with TTL:
```python
class PersonaManager:
    def __init__(self):
        self.persona_cache: Dict = {}
        self._cache_expires_at: float = 0
        self._cache_ttl: int = 600  # 10 minutes

    def get_all_personas(self) -> Dict:
        if time.time() > self._cache_expires_at or not self.persona_cache:
            self.fetch_all_personas()
        return self.persona_cache

    def fetch_all_personas(self):
        try:
            resp = requests.get(f"{JAVA_API_URL}/api/persona/all", timeout=5)
            resp.raise_for_status()
            data = resp.json()
            if data.get("success") and data.get("data"):
                self.persona_cache = {p["pId"]: p for p in data["data"]}
                self._cache_expires_at = time.time() + self._cache_ttl
                logger.info(f"Loaded {len(self.persona_cache)} personas from Java API")
        except requests.RequestException as e:
            logger.error(f"Java persona API unavailable: {e}")
            # Keep stale cache rather than clearing it
            if not self.persona_cache:
                logger.warning("No persona cache — using empty fallback")
```

**Risk Level**: 🟡 MEDIUM — Init logic changes. Personas may be stale on cache miss, but system continues.

**Rollback Strategy**: Revert to original `@app.before_request` logic.

**Validation**:
- Start Flask with Java API not running → Flask starts, logs error, serves `/api/health` 200
- Start with Java API running → Personas loaded normally
- Hit `/api/generate` with Java API down mid-flight → Uses stale persona cache

---

## PR-PY-04 — Typed Error Model (Replace bare `str(e)`)

**Objective**: Replace all `jsonify({"success": False, "error": str(e)})` patterns with structured errors. Enables Java to make decisions based on error type, not string parsing.

**Files/Modules Affected**:
- `errors.py` — new
- `api_server.py`
- `shorts_generator.py`

**errors.py**:
```python
from enum import Enum
from dataclasses import dataclass, field
from typing import Optional

class ErrorCode(str, Enum):
    BNO_NOT_FOUND      = "BNO_NOT_FOUND"
    LLM_TIMEOUT        = "LLM_TIMEOUT"
    LLM_FORMAT_ERROR   = "LLM_FORMAT_ERROR"
    LLM_EMPTY          = "LLM_EMPTY"
    RENDER_FAILED      = "RENDER_FAILED"
    TTS_FAILED         = "TTS_FAILED"
    QUEUE_CONFLICT     = "QUEUE_CONFLICT"
    QUEUE_PREPARE_FAIL = "QUEUE_PREPARE_FAIL"
    DB_ERROR           = "DB_ERROR"
    VALIDATION_ERROR   = "VALIDATION_ERROR"
    UNAUTHORIZED       = "UNAUTHORIZED"
    CONFIG_ERROR       = "CONFIG_ERROR"

@dataclass
class ApiError(Exception):
    error_code: ErrorCode
    message: str
    http_status: int = 500
    detail: Optional[str] = field(default=None, repr=False)
```

**api_server.py**:
```python
from errors import ApiError, ErrorCode
from flask import g

@app.errorhandler(ApiError)
def handle_api_error(e: ApiError):
    return jsonify({
        "success": False,
        "error_code": e.error_code.value,
        "message": e.message,
        "trace_id": getattr(g, "trace_id", "unknown")
    }), e.http_status

# In generate_shorts():
if not data or 'bno' not in data:
    raise ApiError(ErrorCode.VALIDATION_ERROR, "bno is required", 400)

if bno in _generating_bnos:
    raise ApiError(ErrorCode.QUEUE_CONFLICT, f"BNO={bno} is already generating", 409)

target = get_target_by_bno(bno)
if not target:
    raise ApiError(ErrorCode.BNO_NOT_FOUND, f"Board {bno} not found", 404)

script = generate_script_with_openai(target, video_type)
if not script:
    raise ApiError(ErrorCode.LLM_FORMAT_ERROR, f"Script generation failed for BNO={bno}")
```

**Risk Level**: 🟢 LOW — Java currently only checks `body.get("success")`. Error body structure change is additive (new fields, `"error"` key preserved for backward compat during transition).

Backward compatible bridge during transition:
```python
# Temporary — keep "error" key while Java migrates to "error_code"
return jsonify({
    "success": False,
    "error_code": e.error_code.value,
    "error": e.message,           # deprecated key, remove in PR-PY-09
    "message": e.message,
    "trace_id": g.trace_id
}), e.http_status
```

**Rollback Strategy**: Revert `errors.py` and `api_server.py` error handlers to bare `str(e)`.

**Validation**:
- `POST /api/generate` with missing `bno` → `{"error_code": "VALIDATION_ERROR", "success": false}`
- `POST /api/generate` with nonexistent `bno` → `{"error_code": "BNO_NOT_FOUND", "success": false, "http_status": 404}`
- Concurrent calls with same `bno` → first succeeds, second returns 409 `QUEUE_CONFLICT`

---

## PR-PY-05 — Trace ID Propagation + Structured Logging

**Objective**: Inject `trace_id` from inbound `X-Trace-Id` header into all log lines. Enable log correlation with Java.

**Files/Modules Affected**:
- `api_server.py`
- `config.py` (log format)
- `shorts_generator.py`
- `main.py`

**api_server.py**:
```python
import secrets
from flask import g

@app.before_request
def inject_trace_id():
    g.trace_id = request.headers.get("X-Trace-Id") or secrets.token_hex(8)
    g.bno = request.json.get("bno") if request.is_json else None

# Log format updated to use thread-local trace context:
# Use logging.Filter to inject g.trace_id into LogRecord
class TraceFilter(logging.Filter):
    def filter(self, record):
        record.trace_id = getattr(g, "trace_id", "no-trace") if g else "no-trace"
        record.bno = getattr(g, "bno", "-") if g else "-"
        return True
```

**config.py**:
```python
LOG_FORMAT = '%(asctime)s [%(levelname)s] [trace=%(trace_id)s] [bno=%(bno)s] %(name)s - %(message)s'
```

**main.py** — add run_id for scheduler loops:
```python
import secrets

def main_loop():
    while True:
        run_id = secrets.token_hex(6)
        logger.info(f"[run={run_id}] Starting production cycle")
        try:
            run_curation(run_id)
            run_production(run_id)
            run_scheduled_upload(run_id)
        except Exception as e:
            logger.error(f"[run={run_id}] Cycle failed: {e}", exc_info=True)
        time.sleep(POLL_INTERVAL)
```

**Risk Level**: 🟢 LOW — Additive only.

**Rollback Strategy**: Remove filter and revert log format.

**Validation**:
- `POST /api/generate` with `X-Trace-Id: abc123` header → all log lines for request contain `[trace=abc123]`
- `POST /api/generate` without header → auto-generated trace ID appears in all log lines

---

## PR-PY-06 — Alembic Migration for Python-Exclusive Tables

**Objective**: Version-control `keyword_trends`, `reply_sentiment`, `shorts_performance`, `upload_schedule` tables. Prevent schema drift between Python deploys.

**Files/Modules Affected**:
- `alembic.ini` — new
- `alembic/env.py` — new
- `alembic/versions/001_create_upload_schedule.py` — new
- `alembic/versions/002_create_keyword_trends.py` — new
- `alembic/versions/003_create_shorts_performance.py` — new
- `alembic/versions/004_create_reply_sentiment.py` — new

**alembic.ini**:
```ini
[alembic]
script_location = alembic
sqlalchemy.url =  # set via env in env.py
```

**alembic/env.py** (Oracle-specific):
```python
from config import DB_CONNECTION_STRING
config.set_main_option("sqlalchemy.url", DB_CONNECTION_STRING)
```

**Sample migration** (`001_create_upload_schedule.py`):
```python
def upgrade():
    op.execute("""
        BEGIN
          EXECUTE IMMEDIATE '
            CREATE TABLE upload_schedule (
              schedule_id   NUMBER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
              bno           NUMBER NOT NULL,
              scheduled_time TIMESTAMP NOT NULL,
              status        VARCHAR2(20) DEFAULT ''SCHEDULED'',
              uploaded_time TIMESTAMP,
              error_msg     VARCHAR2(2000),
              trace_id      VARCHAR2(64)
            )';
          EXECUTE IMMEDIATE 'CREATE INDEX idx_us_status_time 
                             ON upload_schedule(status, scheduled_time)';
        EXCEPTION WHEN OTHERS THEN
          IF SQLCODE != -955 THEN RAISE; END IF;
        END;
    """)

def downgrade():
    op.execute("DROP TABLE upload_schedule")
```

**Deployment**:
```bash
# On each deploy:
alembic upgrade head
```

**Risk Level**: 🟢 LOW — Additive only. Existing tables get baseline revision.

**Rollback Strategy**: `alembic downgrade -1`

**Validation**:
- `alembic history` shows 4 revisions
- `alembic current` shows `head`
- All 4 tables exist in Oracle

---

## PR-PY-07 — Environment-Based Path Configuration

**Objective**: Remove hardcoded Mac-specific paths for ImageMagick, fonts. Any deploy on non-Mac host currently produces silent render failures or crashes.

**Files/Modules Affected**:
- `config.py`
- `shorts_generator.py`

**config.py** — path resolution:
```python
# ImageMagick — configurable, with sane defaults per platform
import platform

_IMAGEMAGICK_CANDIDATES = [
    os.environ.get("IMAGEMAGICK_BINARY", ""),       # explicit override
    "/usr/bin/magick",                               # Linux (apt install imagemagick)
    "/usr/local/bin/magick",                         # Linux alternate
    "/opt/homebrew/opt/imagemagick-full/bin/magick", # macOS Homebrew
    "/opt/homebrew/bin/magick",                      # macOS Homebrew standard
    "magick",                                        # PATH fallback
]
IMAGEMAGICK_BINARY = next(
    (p for p in _IMAGEMAGICK_CANDIDATES if p and (Path(p).exists() or p == "magick")),
    "magick"
)
os.environ["IMAGEMAGICK_BINARY"] = IMAGEMAGICK_BINARY

# Font path — configurable
_FONT_CANDIDATES = [
    os.environ.get("FONT_PATH", ""),               # explicit override
    str(Path.home() / "Library/Fonts/Pretendard-Bold.otf"),  # macOS user
    "/usr/share/fonts/truetype/nanum/NanumGothicBold.ttf",   # Linux Nanum
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",  # Linux generic
    "/System/Library/Fonts/AppleSDGothicNeo.ttc",            # macOS system
    "Helvetica",                                             # ImageMagick built-in fallback
]
FONT_PATH = next(
    (f for f in _FONT_CANDIDATES if f and (f == "Helvetica" or Path(f).exists())),
    "Helvetica"
)

if IMAGEMAGICK_BINARY == "magick":
    logger.warning("ImageMagick path not resolved — using PATH 'magick'. "
                   "Set IMAGEMAGICK_BINARY env var for explicit path.")
if FONT_PATH == "Helvetica":
    logger.warning("No Korean font found — using Helvetica fallback. "
                   "Set FONT_PATH env var or install NanumGothic.")
```

**shorts_generator.py** — add validation at startup:
```python
def validate_render_dependencies():
    """Call at startup, not at render time."""
    import subprocess
    try:
        result = subprocess.run([IMAGEMAGICK_BINARY, "--version"], 
                              capture_output=True, timeout=5)
        logger.info(f"ImageMagick OK: {result.stdout.decode()[:50]}")
    except (FileNotFoundError, subprocess.TimeoutExpired) as e:
        logger.error(f"ImageMagick not found at '{IMAGEMAGICK_BINARY}': {e}. "
                     "Video rendering will fail.")
    
    if not Path(FONT_PATH).exists() and FONT_PATH != "Helvetica":
        logger.error(f"Font not found: {FONT_PATH}. Set FONT_PATH env var.")
```

**Risk Level**: 🟢 LOW — Non-breaking. Existing Mac paths still work (still in candidate list).

**Rollback Strategy**: Revert `config.py` candidate lists.

**Validation**:
- On Linux host: `IMAGEMAGICK_BINARY` resolves to `/usr/bin/magick` (if installed)
- On Mac: resolves to `/opt/homebrew/opt/imagemagick-full/bin/magick`
- Missing IM: startup logs `ERROR` rather than silent crash during render

---

## PR-PY-08 — `_ensure_queue_ready` Race Fix + Status Enum

**Objective**: Fix the read-then-write race condition in `api_server._ensure_queue_ready`. Replace magic integers `0/1/9` with named constants used consistently across all Python code.

**Files/Modules Affected**:
- `api_server.py`
- `shorts_generator.py`
- `main.py`
- `upload_scheduler.py`
- `db/queue_status.py` — new

**db/queue_status.py**:
```python
class QueueStatus:
    PENDING   = 0
    COMPLETED = 1
    FAILED    = 9

class UploadStatus:
    SCHEDULED = "SCHEDULED"
    UPLOADED  = "UPLOADED"
    FAILED    = "FAILED"
```

**`_ensure_queue_ready` — atomic MERGE replacing read-then-write**:
```python
def _ensure_queue_ready(bno: int, video_type: str, req_data: dict, trace_id: str) -> bool:
    """
    Atomically ensures exactly one status=0 row exists for bno.
    Uses MERGE to avoid read-then-write race condition.
    Returns True if queue is ready, False on DB error.
    """
    idempotency_key = req_data.get("idempotency_key") or f"api-{bno}-{int(time.time() // 300)}"
    try:
        with DB_ENGINE.begin() as conn:
            # First: check if already completed (idempotent success)
            existing = conn.execute(sqlalchemy.text("""
                SELECT status FROM shorts_queue 
                WHERE idempotency_key = :ikey
            """), {"ikey": idempotency_key}).fetchone()
            
            if existing and existing[0] == QueueStatus.COMPLETED:
                logger.info(f"BNO={bno}: Already completed (idempotent), skipping")
                return True
            
            # Atomic MERGE — no separate SELECT + INSERT/UPDATE
            conn.execute(sqlalchemy.text("""
                MERGE INTO shorts_queue tgt
                USING (SELECT :bno AS bno, :ikey AS ikey FROM DUAL) src
                ON (tgt.bno = src.bno AND tgt.idempotency_key = src.ikey)
                WHEN MATCHED AND tgt.status = :failed THEN
                  UPDATE SET status = :pending, video_type = :vtype, trace_id = :tid
                WHEN NOT MATCHED THEN
                  INSERT (bno, status, video_type, quality_score, priority, 
                          idempotency_key, trace_id, reg_date)
                  VALUES (:bno, :pending, :vtype, :qscore, :priority, :ikey, :tid, SYSTIMESTAMP)
            """), {
                "bno": bno, "ikey": idempotency_key,
                "failed": QueueStatus.FAILED, "pending": QueueStatus.PENDING,
                "vtype": video_type,
                "qscore": float(req_data.get("quality_score", 5.0)),
                "priority": int(req_data.get("priority", 5)),
                "tid": trace_id
            })
            return True
    except Exception as e:
        logger.error(f"Queue prepare failed BNO={bno}: {e}", exc_info=True)
        return False
```

**Risk Level**: 🟡 MEDIUM — Atomic SQL change. Requires `idempotency_key` column from Java PR-03.

**Rollback Strategy**: Revert to original `_ensure_queue_ready`. Requires PR-03 (Flyway) to be deployed first for column existence.

**Validation**:
- Concurrent `POST /api/generate` calls with same `bno` → first creates row, second is MERGE no-op
- Failed `status=9` row with matching `idempotency_key` → reset to `status=0`
- New BNO → row created atomically

---

## PR-PY-09 — Worker/API Process Split

**Objective**: Separate `api_server.py` (HTTP) from video rendering (CPU-intensive). Rendering in a Flask request thread blocks the entire server for 30-120 seconds. Move rendering to a background worker process.

**Files/Modules Affected**:
- `api_server.py` — remove synchronous render call from `/api/generate`
- `worker.py` — new (extract from `main.py`)
- `main.py` — slim down to orchestration only

**api_server.py** — `/api/generate` becomes async job submission:
```python
@app.route('/api/generate', methods=['POST'])
@require_api_key
def generate_shorts():
    data = request.json
    bno = int(data['bno'])
    video_type = data.get('video_type', 'INFO')
    idempotency_key = data.get('idempotency_key', f"api-{bno}-{int(time.time()//300)}")
    
    with _generating_lock:
        if bno in _generating_bnos:
            raise ApiError(ErrorCode.QUEUE_CONFLICT, f"BNO={bno} already generating", 409)
        _generating_bnos.add(bno)
    
    # Queue the job — worker.py will pick it up
    success = _ensure_queue_ready(bno, video_type, data, g.trace_id)
    if not success:
        with _generating_lock:
            _generating_bnos.discard(bno)
        raise ApiError(ErrorCode.QUEUE_PREPARE_FAIL, f"Could not prepare queue for BNO={bno}")
    
    # Return 202 Accepted — caller polls /api/queue for completion
    return jsonify({
        "success": True,
        "accepted": True,
        "bno": bno,
        "trace_id": g.trace_id,
        "status_url": f"/api/queue/bno/{bno}"
    }), 202
```

**worker.py** — extracted render loop:
```python
#!/usr/bin/env python3
"""
Shorts production worker — runs as separate process.
Polls shorts_queue for status=0 rows and renders them.
"""
import time
import logging
from config import DB_CONNECTION_STRING
from db.queue_status import QueueStatus
from shorts_generator import get_target_by_bno, generate_script_with_openai, render_video_with_persona
import sqlalchemy

POLL_INTERVAL = int(os.environ.get("WORKER_POLL_INTERVAL", "30"))

def run_worker():
    engine = sqlalchemy.create_engine(DB_CONNECTION_STRING)
    logger.info("Worker started, polling shorts_queue...")
    while True:
        try:
            process_one_pending(engine)
        except Exception as e:
            logger.error(f"Worker cycle error: {e}", exc_info=True)
        time.sleep(POLL_INTERVAL)

def process_one_pending(engine):
    with engine.begin() as conn:
        # SELECT FOR UPDATE SKIP LOCKED — Oracle row-level lock, skip rows other workers hold
        row = conn.execute(sqlalchemy.text("""
            SELECT sq_no, bno, video_type, trace_id
            FROM shorts_queue
            WHERE status = :pending
              AND rownum = 1
            FOR UPDATE SKIP LOCKED
        """), {"pending": QueueStatus.PENDING}).fetchone()
        
        if not row:
            return  # Nothing to process
        
        sq_no, bno, video_type, trace_id = row
        logger.info(f"[trace={trace_id}] Processing sq_no={sq_no} bno={bno}")
        start_ms = int(time.time() * 1000)
        
        try:
            target = get_target_by_bno(bno)
            if not target:
                conn.execute(sqlalchemy.text(
                    "UPDATE shorts_queue SET status=:f, error_msg='BNO not found' WHERE sq_no=:sq"
                ), {"f": QueueStatus.FAILED, "sq": sq_no})
                return
            
            script = generate_script_with_openai(target, video_type)
            if not script:
                conn.execute(sqlalchemy.text(
                    "UPDATE shorts_queue SET status=:f, error_msg='Script generation failed' WHERE sq_no=:sq"
                ), {"f": QueueStatus.FAILED, "sq": sq_no})
                return
            
            result = render_video_with_persona(script, target)
            total_ms = int(time.time() * 1000) - start_ms
            
            if result:
                conn.execute(sqlalchemy.text("""
                    UPDATE shorts_queue 
                    SET status=:done, video_path=:vp, thumbnail_path=:tp,
                        completed_date=SYSTIMESTAMP, total_ms=:ms
                    WHERE sq_no=:sq
                """), {"done": QueueStatus.COMPLETED, "vp": result["video_path"],
                       "tp": result["thumbnail_path"], "ms": total_ms, "sq": sq_no})
                logger.info(f"[trace={trace_id}] Completed sq_no={sq_no} in {total_ms}ms")
            else:
                conn.execute(sqlalchemy.text(
                    "UPDATE shorts_queue SET status=:f, error_msg='Render returned None' WHERE sq_no=:sq"
                ), {"f": QueueStatus.FAILED, "sq": sq_no})
        except Exception as e:
            logger.error(f"[trace={trace_id}] Worker failed sq_no={sq_no}: {e}", exc_info=True)
            conn.execute(sqlalchemy.text(
                "UPDATE shorts_queue SET status=:f, error_msg=:msg WHERE sq_no=:sq"
            ), {"f": QueueStatus.FAILED, "msg": str(e)[:2000], "sq": sq_no})

if __name__ == "__main__":
    run_worker()
```

**`SELECT FOR UPDATE SKIP LOCKED`** is the key addition — allows multiple `worker.py` instances to run concurrently without conflicting.

**Deployment (systemd)**:
```ini
# /etc/systemd/system/naon-api.service
[Service]
ExecStart=/usr/bin/python3 /opt/naon/api_server.py
EnvironmentFile=/opt/naon/.env

# /etc/systemd/system/naon-worker.service
[Service]
ExecStart=/usr/bin/python3 /opt/naon/worker.py
EnvironmentFile=/opt/naon/.env
```

**Risk Level**: 🟠 HIGH — Changes `/api/generate` from synchronous (200 with result) to async (202 Accepted). Java `ShortsService` must handle 202 and poll for completion.

**Java ShortsService adaptation** (coordinate with this PR):
```java
// After 202, poll /api/queue/bno/{bno} for status=1
// Or, since scheduler now decoupled (PR-06), simply trust DB polling
```

**Rollback Strategy**: Revert `api_server.py` to synchronous render. Stop `naon-worker.service`.

**Validation**:
- `POST /api/generate` returns 202 immediately (< 200ms)
- `worker.py` process picks up `status=0` row within `POLL_INTERVAL` seconds
- `GET /api/queue` shows `status=1` after render completes
- Multiple `worker.py` instances: no double-processing of same `sq_no` (SKIP LOCKED)

---

## PR-PY-10 — Observability: Queue Health Endpoint + Timing Metrics

**Objective**: Add `/api/queue/bno/{bno}` status endpoint. Expose per-stage timing from `shorts_queue`. Enables Java to poll after async job submission (from PR-PY-09).

**Files/Modules Affected**:
- `api_server.py`
- `shorts_generator.py` (add timing instrumentation)

**api_server.py**:
```python
@app.route('/api/queue/bno/<int:bno>', methods=['GET'])
def get_queue_status_by_bno(bno: int):
    """Poll endpoint for async job status after POST /api/generate."""
    try:
        with DB_ENGINE.connect() as conn:
            row = conn.execute(sqlalchemy.text("""
                SELECT sq_no, status, video_path, thumbnail_path,
                       error_msg, trace_id, total_ms, reg_date, completed_date
                FROM shorts_queue
                WHERE bno = :bno
                ORDER BY sq_no DESC
                FETCH FIRST 1 ROW ONLY
            """), {"bno": bno}).fetchone()
        
        if not row:
            return jsonify({"success": False, "error_code": "BNO_NOT_FOUND"}), 404
        
        status_map = {0: "pending", 1: "completed", 9: "failed"}
        return jsonify({
            "success": True,
            "bno": bno,
            "sq_no": row[0],
            "status": status_map.get(row[1], "unknown"),
            "video_path": row[2],
            "thumbnail_path": row[3],
            "error_msg": row[4],
            "trace_id": row[5],
            "total_ms": row[6],
            "reg_date": str(row[7]),
            "completed_date": str(row[8]) if row[8] else None
        })
    except Exception as e:
        raise ApiError(ErrorCode.DB_ERROR, str(e))
```

**shorts_generator.py** — add timing context:
```python
def render_video_with_persona(script, target) -> Optional[dict]:
    timings = {}
    
    t0 = time.time()
    # ... TTS generation ...
    timings["tts_ms"] = int((time.time() - t0) * 1000)
    
    t1 = time.time()
    # ... video render ...
    timings["render_ms"] = int((time.time() - t1) * 1000)
    
    if result:
        result["timings"] = timings  # pass back to caller for DB update
    return result
```

**Risk Level**: 🟢 LOW — Additive endpoint only.

**Rollback Strategy**: Remove endpoint. No state change.

**Validation**:
- `GET /api/queue/bno/1` while `status=0` → `{"status": "pending"}`
- `GET /api/queue/bno/1` after completion → `{"status": "completed", "video_path": "...", "total_ms": 47230}`
- `GET /api/queue/bno/999` → 404 BNO_NOT_FOUND

---

## Deployment Order & Dependencies

```
PR-PY-01 (secrets/credentials)
  └─ PR-PY-02 (auth) — needs FACTORY_API_KEY from PR-PY-01
       └─ PR-PY-03 (init safety) — safe any time, but needs Java API stable
            └─ PR-PY-04 (error model) — foundation for all error handling
                 └─ PR-PY-05 (trace IDs) — parallel with PR-PY-04
                      └─ PR-PY-06 (Alembic) — independent, any time after PR-PY-01
                           └─ PR-PY-07 (path config) — independent, low risk
                                └─ PR-PY-08 (queue race fix) — requires Flyway idempotency_key column (Java PR-03)
                                     └─ PR-PY-09 (worker split) — major; coordinate with Java PR-06
                                          └─ PR-PY-10 (observability) — last step
```

---

## Regression Test Baseline

Before any PR:
```bash
# 1. Health check
curl http://localhost:5001/api/health

# 2. Status baseline
curl http://localhost:5001/api/status | python3 -m json.tool > baseline_status.json

# 3. Queue state
curl http://localhost:5001/api/queue | python3 -m json.tool > baseline_queue.json

# 4. Persona count (requires Java running)
curl http://localhost:5001/api/status | python3 -c "import sys,json; d=json.load(sys.stdin); print('personas:', d['data']['persona_count'])"
```

After each PR, verify:
- `/api/health` → 200
- Persona count unchanged
- Queue status matches baseline
- No new `ERROR` entries in `shorts_generator.log`

---

## Known Deferred Issues (Not in This Plan, Logged for Backlog)

| Issue | Location | Severity | Ticket |
|---|---|---|---|
| `twitter_bot.py` has no retry logic on Twitter API 429 | `twitter_bot.py:post_tweet` | LOW | backlog |
| `performance_tracker.py` uses `fetchall()` with no LIMIT — can OOM on large DB | `performance_tracker.py:get_performance_stats` | MEDIUM | backlog |
| `crawler.py` has no User-Agent rotation — will be blocked by Clien/PPOMPPU | `crawler.py` | MEDIUM | backlog |
| `upload_youtube.py` uses "Installed App" OAuth flow — will fail in headless server environment | `upload_youtube.py` | HIGH | backlog |
| No retry on `upload_youtube.py` if YouTube API 503 | `upload_youtube.py:upload_video` | HIGH | backlog |
| `make_shorts.py` purpose unclear — appears to duplicate `shorts_generator.py` | `make_shorts.py` | LOW | backlog — audit then remove |
