// ─── Automation Blog (Mock Adapter) ──────────────────────────────────────────
// Returns mock articles about automation tools (n8n, GitHub Actions, etc).
// Replace with real HTTP scraping in Phase 2.
// ─────────────────────────────────────────────────────────────────────────────

export const name = 'automation-blog'

export async function fetch() {
    const now = new Date()
    return [
        {
            title: 'n8n으로 GitHub PR 머지 시 자동 배포 파이프라인 만들기',
            content: `n8n 웹훅과 GitHub Actions를 연결해서 PR 머지 → 자동 배포를 구현하는 방법입니다.

전체 흐름:
GitHub PR 머지 → Webhook → n8n → SSH 명령 → PM2 재시작

바로 써먹기:
1. n8n에서 Webhook 노드 생성 (POST)
2. GitHub 리포지토리 Settings → Webhooks에서 위 URL 등록
3. n8n에서 SSH 노드 추가: git pull && npm run build && pm2 restart
4. 테스트 PR 머지 후 배포 확인

예시 n8n 워크플로:
Webhook Trigger → IF (branch === main) → SSH Execute → Slack 알림

추가 팁:
- Slack/Discord 알림 노드 추가하면 배포 실패 즉시 감지
- 롤백용 이전 빌드 백업 스크립트 추가 추천
- n8n self-hosted 기준, 클라우드 버전도 동일 로직 가능`,
            source_url: null,
            source_site: 'Automation Weekly',
            published_at: new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000).toISOString(),
        },
        {
            title: 'PM2 모니터링 대시보드 5분 만에 세팅하기',
            content: `PM2의 내장 모니터링 기능과 웹 대시보드를 빠르게 세팅하는 방법입니다.

바로 써먹기:
1. pm2 install pm2-server-monit
2. pm2 web으로 JSON API 활성화
3. 브라우저에서 http://localhost:9615 접속

추가로 pm2 plus를 사용하면 원격 모니터링도 가능합니다.`,
            source_url: null,
            source_site: 'DevOps Tips',
            published_at: new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000).toISOString(),
        },
        {
            title: '광고성 글: 최고의 자동화 플랫폼 TOP 10',
            content: `이 글은 여러 자동화 플랫폼을 나열만 하고 있습니다. 실전 예시나 구체적인 설정 방법은 포함되어 있지 않습니다. 각 플랫폼의 가격 비교와 마케팅 문구 위주입니다.`,
            source_url: null,
            source_site: 'SponsoredTech',
            published_at: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString(),
        },
        {
            title: 'Docker Compose로 로컬 개발 환경 한 방에 띄우기',
            content: `프로젝트마다 Node, Python, Redis, Postgres 등 환경이 달라서 고생한 적 있으신가요?
Docker Compose 하나로 전부 해결하는 실전 가이드입니다.

바로 써먹기:
1. docker-compose.yml 파일 생성
2. services에 app, db, redis 등록
3. docker compose up -d 실행
4. 개발 후 docker compose down으로 정리

예시:
services:
  app:
    build: .
    ports: ["3000:3000"]
    volumes: ["./src:/app/src"]
  db:
    image: postgres:16
    environment:
      POSTGRES_PASSWORD: dev

이렇게 하면 팀원 누구나 같은 환경에서 개발 가능합니다.`,
            source_url: null,
            source_site: 'Container Weekly',
            published_at: new Date(now.getTime() - 4 * 24 * 60 * 60 * 1000).toISOString(),
        },
    ]
}
