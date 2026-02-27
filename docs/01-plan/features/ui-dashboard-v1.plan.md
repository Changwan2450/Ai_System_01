# Plan: ui-dashboard-v1

> PDCA Phase: Plan
> Created: 2026-02-27
> Status: Draft

---

## 1. Overview

**Feature**: Standalone Infra Dashboard
**Project**: AI_SYSTEM — 쇼츠 자동화 시스템
**Goal**: 운영팀이 브라우저에서 4개 인프라 위젯을 한눈에 확인할 수 있는 읽기 전용 대시보드 구축

### Background

현재 운영 시스템(Java 9090 + Python 5001 + Oracle DB)은 터미널이나 개별 서비스 URL을 통해서만 상태를 확인할 수 있다. 단일 UI로 서버·ACP·n8n·배포 상태를 통합 조회하는 대시보드가 없어 장애 초기 감지가 어렵다.

---

## 2. Scope

### In Scope

| # | Widget | 데이터 소스 | 설명 |
|---|--------|------------|------|
| W1 | **Server Status** | Python `/api/dashboard` | CPU/Mem, Python 프로세스 상태, DB 연결 |
| W2 | **ACP Status** | Python `/api/dashboard` | Java(9090) 헬스 결과, shorts_queue 처리율 |
| W3 | **n8n Status** | Python `/api/dashboard` | n8n 헬스 엔드포인트 프록시 |
| W4 | **Deploy Status** | Python `/api/dashboard` | 최근 deploy 이벤트, 서비스 uptime |

### Out of Scope

- AI 게시판(AI_BOARD) UI
- 쇼츠 자동화 조작/트리거 버튼
- 사용자 인증(Auth)
- DB 스키마 변경
- 실시간 스트리밍(WebSocket)

---

## 3. Constraints

| 항목 | 규칙 |
|------|------|
| nginx | 기존 설정 유지, 새 location 블록만 추가 가능 |
| DB | 스키마 변경 금지 — SELECT만 허용 |
| Python | 파일 1개 추가 (`dashboard_api.py`), 기존 파일 최소 수정 |
| Java | 변경 금지 (ACP 상태는 Python이 Java 헬스 API를 HTTP 호출하여 수집) |
| 대시보드 | 읽기 전용 — 어떤 액션 버튼도 없음 |
| 인증 | MVP는 X-API-Key 없음 (nginx 내부망 접근 제한으로 대체) |

---

## 4. Architecture

```
Browser (8080/dashboard)
        │  nginx proxy
        ▼
ui-dashboard-v1/  (정적 HTML/CSS/JS)
        │  fetch every 30s
        ▼
Python /api/dashboard  (새 엔드포인트, api_server.py에 등록)
        │
        ├── psutil             → Server CPU/Mem
        ├── DB SELECT          → shorts_queue counts (read-only)
        ├── HTTP GET 9090/actuator/health  → ACP(Java) 상태
        └── HTTP GET n8n:5678/healthz      → n8n 상태
```

### 포트 / URL 매핑

| 서비스 | 내부 포트 | 대시보드 접근 경로 |
|--------|-----------|------------------|
| 대시보드 정적 파일 | nginx 8080 | `/dashboard/` |
| Python aggregator | 5001 | `/api/dashboard` (nginx proxy_pass) |
| Java ACP | 9090 | 내부 호출만 (직접 노출 안 함) |
| n8n | 5678 | 내부 호출만 |

---

## 5. Deliverables

### 5.1 파일 목록

```
ui-dashboard-v1/
├── index.html                  # 대시보드 진입점 (4 위젯 레이아웃)
├── style.css                   # 위젯 카드 스타일
└── dashboard.js                # fetch /api/dashboard, DOM 업데이트, 30s 폴링

naon.py/
└── dashboard_api.py            # 신규: aggregator 함수 모음 (server/acp/n8n/deploy)

naon.py/api_server.py           # 기존 파일 — @app.route('/api/dashboard') 1줄 등록

docs/
├── 01-plan/features/
│   └── ui-dashboard-v1.plan.md         ← 현재 문서
├── 02-design/features/
│   └── ui-dashboard-v1.design.md       (다음 단계)
└── 03-analysis/
    └── ui-dashboard-v1.analysis.md     (Check 단계)

specs/
└── dashboard-v1.md             # 기존 스펙 (이 Plan으로 대체/보완)
```

### 5.2 nginx 변경 (최소)

```nginx
# 기존 nginx.conf에 추가할 location 블록 2개
location /dashboard/ {
    alias /path/to/ui-dashboard-v1/;
    index index.html;
}

location /api/dashboard {
    proxy_pass http://127.0.0.1:5001/api/dashboard;
}
```

---

## 6. Acceptance Criteria

| # | 조건 | 검증 방법 |
|---|------|----------|
| AC1 | 브라우저에서 `/dashboard/` 접근 시 4개 위젯 렌더링 | 수동 확인 |
| AC2 | 30초마다 데이터 자동 갱신 | 브라우저 Network 탭 |
| AC3 | Python `/api/dashboard` → JSON 200 응답 | `curl localhost:5001/api/dashboard` |
| AC4 | Java 다운 시 ACP 위젯 "DOWN" 표시 | Java 중단 후 확인 |
| AC5 | 기존 `/api/health`, `/api/status` 정상 작동 유지 | curl 재확인 |
| AC6 | DB 스키마 변경 없음 | `diff` 없음 |
| AC7 | Java 코드 변경 없음 | git diff AI-Insidier → 0 |

---

## 7. Risk & Rollback

### 7.1 위험 목록

| ID | 위험 | 확률 | 영향 | 대응 |
|----|------|------|------|------|
| R1 | Python 프로세스에 psutil 미설치 | 중 | 중 | `pip install psutil` — 기존 앱 무영향 |
| R2 | Java `/actuator/health` 비활성화 | 중 | 중 | Java 9090 루트 또는 `/api/health` 폴백 사용 |
| R3 | n8n 포트/경로 불명확 | 중 | 낮 | n8n 기본 포트 5678 시도, 실패 시 "UNKNOWN" 표시 |
| R4 | nginx reload 시 기존 서비스 순간 중단 | 낮 | 높 | `nginx -t` 검증 후 reload (restart 금지) |
| R5 | `api_server.py` import 오류로 Python 재시작 실패 | 낮 | 높 | `dashboard_api.py`를 별도 모듈로 분리, try/except 래핑 |
| R6 | CORS_ORIGINS 미포함으로 대시보드 fetch 차단 | 낮 | 중 | nginx proxy를 통하면 CORS 불필요 (same-origin) |

### 7.2 롤백 플랜

```
롤백 단계 (5분 이내 완료 가능):

1. nginx: 추가한 location 2개 블록 삭제 → nginx -t && nginx -s reload
2. api_server.py: dashboard import 1줄 + route 1줄 삭제 → Python 재시작
3. dashboard_api.py: 파일 삭제 (기존 기능 무관)
4. ui-dashboard-v1/: 디렉토리 존재 무방 (nginx가 서비스 안 하면 노출 안 됨)

→ 기존 Java, DB, 쇼츠 자동화 로직에 영향 없음
```

---

## 8. Implementation Order (Preview)

```
Phase 1 — Backend (Python)
  1. dashboard_api.py 작성 (4개 collect 함수)
  2. api_server.py에 route 등록 (1 line import + 1 route)
  3. curl 검증

Phase 2 — Frontend
  4. index.html 4 위젯 레이아웃
  5. style.css 카드 스타일
  6. dashboard.js fetch + 폴링

Phase 3 — nginx
  7. nginx.conf location 2개 추가
  8. nginx -t && nginx -s reload
  9. 브라우저 E2E 확인
```

---

## 9. Open Questions

| # | 질문 | 결정 필요자 |
|---|------|------------|
| Q1 | n8n 실제 포트/경로는? (기본값: 5678/healthz 가정) | 운영팀 |
| Q2 | Java actuator 활성화 여부? (대안: 9090 루트 GET) | 운영팀 |
| Q3 | Deploy 상태 — 어떤 지표? (프로세스 uptime? 최근 git tag?) | 운영팀 |
| Q4 | 대시보드 nginx 포트 — 8080인가 별도 포트인가? | 운영팀 |

---

*Next: `/pdca design ui-dashboard-v1`*
