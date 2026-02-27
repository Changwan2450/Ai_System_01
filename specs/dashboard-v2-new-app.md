# Dashboard v2 (New App) Spec

## Goal
완전 신규 운영 대시보드 앱 구축 (기존 /factory와 분리)

## Structure
- ui-dashboard-v1/ (React + Vite)
- Python에 GET /api/dashboard/status 추가 (read-only)
- nginx 유지

## Widgets (v1)
- Server 상태
- ACP Queue 상태
- n8n 상태
- Deploy 정보

## Constraints
- DB 스키마 변경 금지
- 기존 Shorts 로직 수정 금지
- read-only 대시보드

## Acceptance Criteria
- /dashboard 접속 시 4개 위젯 렌더
- aggregator 단일 endpoint 사용
- 500 발생 금지
