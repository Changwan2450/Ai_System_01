# Design: ui-dashboard-v1

> PDCA Phase: Design
> Created: 2026-02-27
> Plan Reference: `docs/01-plan/features/ui-dashboard-v1.plan.md`
> Status: Draft

---

## Change Log from Plan

| 변경 항목 | Plan | Design (확정) |
|-----------|------|--------------|
| n8n 위젯 | Health polling (내부 API 호출) | 외부 링크 버튼만 (`https://n8n.noa-on.com/`) |
| 위젯 수 | 4개 (Server, ACP, n8n, Deploy) | 3개 data 위젯 + 1개 link 버튼 |
| Python aggregator | 4개 collect 함수 | 3개 collect 함수 (n8n 제거) |

---

## 1. Widget Specification

### 1.1 레이아웃 개요

```
┌────────────────────────────────────────────────────────┐
│  AI_SYSTEM  Infra Dashboard          [Last: 14:32:05]  │
├──────────────┬───────────────┬───────────────┬─────────┤
│  W1 Server   │  W2 ACP/Queue │  W3 Deploy    │  n8n ↗  │
│  Status      │  Status       │  Status       │  link   │
├──────────────┼───────────────┼───────────────┴─────────┤
│  CPU  42%    │  Java  UP     │  Python   UP  14h 22m   │
│  Mem  61%    │  Queue        │  Java     UP   9h 05m   │
│  DB   OK     │  Pending:  3  │  DB       OK            │
│  Python UP   │  Done:   148  │  nginx    UP            │
│              │  Failed:   0  │                         │
└──────────────┴───────────────┴─────────────────────────┘
```

> n8n 버튼: 우측 상단 독립 버튼. 클릭 시 `https://n8n.noa-on.com/` 새 탭 열기.
> 데이터 없음 — API 호출 없음.

---

### 1.2 W1 — Server Status

**목적**: Python 서버 호스트 자원 + DB 연결 상태

| 표시 항목 | 데이터 소스 | 표시 형식 |
|----------|------------|----------|
| CPU 사용률 | `psutil.cpu_percent()` | `42%` (>80% → 빨강) |
| 메모리 사용률 | `psutil.virtual_memory().percent` | `61%` (>85% → 빨강) |
| DB 연결 | `SELECT 1` via SQLAlchemy | `OK` / `ERROR` |
| Python 프로세스 | 프로세스 존재 여부 | `UP` / `DOWN` |

**상태 배지**: `OK` (전체 정상) / `WARN` (CPU>80% 또는 Mem>85%) / `ERROR` (DB 실패)

---

### 1.3 W2 — ACP / Queue Status

**목적**: Java AI Content Pipeline 상태 + DB 큐 처리 현황

| 표시 항목 | 데이터 소스 | 표시 형식 |
|----------|------------|----------|
| Java 헬스 | `GET http://127.0.0.1:9090/api/health` (timeout 3s) | `UP` / `DOWN` |
| Queue Pending | `SELECT COUNT(*) FROM shorts_queue WHERE status=0` | 숫자 |
| Queue Done | `SELECT COUNT(*) FROM shorts_queue WHERE status=1` | 숫자 |
| Queue Failed | `SELECT COUNT(*) FROM shorts_queue WHERE status=9` | 숫자 (>0 → 주황) |

**상태 배지**: Java DOWN → `ERROR` / Failed>0 → `WARN` / 그 외 → `OK`

> Java actuator 비활성 시 폴백: `GET http://127.0.0.1:9090/` — HTTP 200이면 `UP`

---

### 1.4 W3 — Deploy Status

**목적**: 핵심 서비스 프로세스 uptime 요약

| 표시 항목 | 데이터 소스 | 표시 형식 |
|----------|------------|----------|
| Python (api_server) | `psutil` 프로세스 검색 + create_time | `UP 14h 22m` / `DOWN` |
| Java (java -jar) | `psutil` 프로세스 검색 + create_time | `UP 9h 05m` / `DOWN` |
| DB 연결 | W1과 공유 (재사용) | `OK` / `ERROR` |
| nginx | `psutil` 프로세스 검색 | `UP` / `DOWN` |

**상태 배지**: 1개 이상 DOWN → `WARN` / 전체 정상 → `OK`

> Uptime 표시: `Xd Xh Xm` 형식. 1일 미만이면 `Xh Xm`.

---

### 1.5 n8n Link Button

**위치**: 헤더 우측 또는 위젯 그리드 4번째 칸
**동작**: `<a href="https://n8n.noa-on.com/" target="_blank" rel="noopener">n8n ↗</a>`
**스타일**: 카드 형태 버튼. hover 시 강조. 데이터 없음, API 호출 없음.

---

## 2. API Contract

### `GET /api/dashboard`

Python Flask endpoint. X-API-Key 불필요.

#### Response Schema

```json
{
  "ok": true,
  "ts": "2026-02-27T14:32:05Z",
  "server": {
    "cpu_pct": 42.1,
    "mem_pct": 61.3,
    "db": "ok",
    "status": "ok"
  },
  "acp": {
    "java": "up",
    "queue": {
      "pending": 3,
      "done": 148,
      "failed": 0
    },
    "status": "ok"
  },
  "deploy": {
    "python_uptime_sec": 51720,
    "java_uptime_sec": 32700,
    "nginx": "up",
    "db": "ok",
    "status": "ok"
  }
}
```

#### Error Response

```json
{
  "ok": false,
  "ts": "2026-02-27T14:32:05Z",
  "error": "db connection failed"
}
```

**상태값 규칙**:

| `status` 값 | 조건 |
|------------|------|
| `"ok"` | 모든 항목 정상 |
| `"warn"` | 부분 이상 (Java DOWN, Failed>0, CPU>80% 등) |
| `"error"` | 치명적 이상 (DB 연결 실패 등) |

**Timeout 규칙**: Java 헬스 체크 3초. 초과 시 `java: "timeout"` (→ warn 처리).

---

## 3. File Structure (확정)

```
ui-dashboard-v1/
├── index.html          # 진입점: 3 위젯 카드 + n8n 링크 버튼
├── style.css           # 카드 그리드, 상태 배지 색상, 반응형
└── dashboard.js        # fetch /api/dashboard, DOM 업데이트, 30s 폴링

naon.py/
└── dashboard_api.py    # 신규 모듈: collect_server(), collect_acp(), collect_deploy()

naon.py/api_server.py   # 기존 — 하단에 2줄 추가만
                        #   from dashboard_api import collect_dashboard
                        #   @app.route('/api/dashboard')
```

---

## 4. Module Design: `dashboard_api.py`

```python
# naon.py/dashboard_api.py
# 의존: psutil, requests, sqlalchemy (모두 기존 or 설치 필요)

def collect_server(db_engine) -> dict:
    """CPU/Mem/DB/Python 프로세스 상태"""

def collect_acp(db_engine) -> dict:
    """Java 헬스(HTTP) + shorts_queue counts(DB SELECT)"""

def collect_deploy() -> dict:
    """psutil로 프로세스 uptime 수집 (Python/Java/nginx)"""

def collect_dashboard(db_engine) -> dict:
    """3개 collector 호출 + 타임스탬프 조합 → 최종 응답 dict"""
```

**에러 격리 원칙**: 각 collector는 독립 try/except. 1개 실패해도 나머지 반환.

```python
def collect_dashboard(db_engine) -> dict:
    result = {"ok": True, "ts": utcnow()}
    for key, fn in [("server", collect_server), ("acp", collect_acp), ("deploy", collect_deploy)]:
        try:
            result[key] = fn(db_engine) if key != "deploy" else fn()
        except Exception as e:
            result[key] = {"status": "error", "error": str(e)}
    return result
```

---

## 5. `api_server.py` 변경 (최소 2줄)

```python
# api_server.py 하단 기존 route 아래에 추가

from dashboard_api import collect_dashboard  # 추가 (1)

@app.route('/api/dashboard', methods=['GET'])
def get_dashboard():
    return jsonify(collect_dashboard(DB_ENGINE))  # 추가 (2)
```

> import는 try/except로 감싸 실패해도 기존 서비스 무영향:
> ```python
> try:
>     from dashboard_api import collect_dashboard
>     @app.route('/api/dashboard', methods=['GET'])
>     def get_dashboard():
>         return jsonify(collect_dashboard(DB_ENGINE))
> except ImportError:
>     pass
> ```

---

## 6. Frontend Design

### `index.html` 구조

```html
<body>
  <header>
    <h1>AI_SYSTEM Dashboard</h1>
    <span id="last-updated">--</span>
    <a href="https://n8n.noa-on.com/" target="_blank" rel="noopener" class="n8n-link">
      n8n ↗
    </a>
  </header>
  <main class="grid">
    <div class="card" id="card-server">...</div>
    <div class="card" id="card-acp">...</div>
    <div class="card" id="card-deploy">...</div>
  </main>
</body>
```

### `dashboard.js` 동작

```
1. DOMContentLoaded → fetchDashboard() 즉시 호출
2. setInterval(fetchDashboard, 30_000)
3. fetchDashboard():
   a. fetch('/api/dashboard')
   b. renderServer(data.server)
   c. renderAcp(data.acp)
   d. renderDeploy(data.deploy)
   e. #last-updated 갱신
   f. 오류 시 카드에 "연결 오류" 표시 (폴링 유지)
```

### 상태 배지 색상

| status | 배경색 | 텍스트 |
|--------|--------|--------|
| `ok` | `#22c55e` (녹색) | `OK` |
| `warn` | `#f59e0b` (주황) | `WARN` |
| `error` | `#ef4444` (빨강) | `ERROR` |

### `style.css` 핵심 규칙

```css
.grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1rem; }
.card { background: #1e1e2e; border-radius: 8px; padding: 1.5rem; }
.badge { border-radius: 4px; padding: 2px 8px; font-weight: bold; }
.n8n-link { /* 버튼 스타일, hover 강조 */ }
@media (max-width: 768px) { .grid { grid-template-columns: 1fr; } }
```

---

## 7. nginx 변경 (확정)

```nginx
# 기존 nginx.conf server 블록 내부에 추가

location /dashboard/ {
    alias /path/to/ui-dashboard-v1/;
    index index.html;
    try_files $uri $uri/ /dashboard/index.html;
}

location /api/dashboard {
    proxy_pass http://127.0.0.1:5001/api/dashboard;
    proxy_set_header Host $host;
    proxy_read_timeout 10s;
}
```

> `/path/to/ui-dashboard-v1/` → 실제 경로로 교체 필요 (배포 단계에서 확정).

---

## 8. Dependencies

| 라이브러리 | 현재 상태 | 용도 |
|-----------|----------|------|
| `psutil` | 미설치 가능 | CPU/Mem, 프로세스 uptime |
| `requests` | 설치 여부 확인 필요 | Java 헬스 HTTP 호출 |
| `flask`, `sqlalchemy` | 기존 설치됨 | 기존 사용 중 |

```bash
pip install psutil requests
```

---

## 9. Acceptance Criteria (확정)

| # | 조건 | 검증 방법 |
|---|------|----------|
| AC1 | `/dashboard/` → 3 카드 + n8n 링크 버튼 렌더링 | 브라우저 수동 확인 |
| AC2 | 30초 자동 갱신 | Network 탭 타이밍 확인 |
| AC3 | `curl localhost:5001/api/dashboard` → `{"ok":true,...}` | curl 응답 확인 |
| AC4 | Java 프로세스 중단 → ACP 위젯 `WARN/ERROR` | 프로세스 kill 후 확인 |
| AC5 | n8n 링크 클릭 → `https://n8n.noa-on.com/` 새 탭 | 수동 클릭 확인 |
| AC6 | 기존 `/api/health`, `/api/status` 정상 유지 | curl 재확인 |
| AC7 | Java 코드 변경 없음 | AI-Insidier 디렉토리 변경 없음 |
| AC8 | DB 스키마 변경 없음 | DDL 변경 없음 |
| AC9 | Python 임포트 실패해도 기존 서비스 정상 기동 | import 오류 삽입 후 재시작 테스트 |

---

## 10. Implementation Order

```
Step 1  naon.py/dashboard_api.py 작성
        - collect_server(), collect_acp(), collect_deploy(), collect_dashboard()

Step 2  naon.py/api_server.py 수정
        - 하단에 try/except import + route 2줄 추가

Step 3  curl 검증
        curl http://localhost:5001/api/dashboard

Step 4  ui-dashboard-v1/index.html 작성
        - 헤더(타이틀 + n8n 링크) + 3 카드 그리드

Step 5  ui-dashboard-v1/style.css 작성
        - 다크 테마, 카드, 배지, n8n 버튼, 반응형

Step 6  ui-dashboard-v1/dashboard.js 작성
        - fetch + render 함수 + 30s 폴링

Step 7  nginx.conf location 2개 추가
        nginx -t && nginx -s reload

Step 8  E2E 확인
        브라우저 /dashboard/ 접근, 카드 3개 + n8n 링크 확인
```

---

*Plan [Plan] ✅ → [Design] ✅ → [Do] → [Check] → [Act]*
*Next: `/pdca do ui-dashboard-v1`*
