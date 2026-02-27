// ─── Claude Code News (Mock Adapter) ─────────────────────────────────────────
// Returns mock articles about Claude Code / AI coding assistants.
// Replace with real HTTP scraping in Phase 2.
// ─────────────────────────────────────────────────────────────────────────────

export const name = 'claude-code-news'

export async function fetch() {
    const now = new Date()
    return [
        {
            title: 'Claude Code에서 MCP 서버 3분 만에 연결하는 법',
            content: `Claude Code의 최신 업데이트에서 MCP(Model Context Protocol) 서버를 로컬에서 바로 붙일 수 있게 됐습니다.
설정 파일 하나만 추가하면 3분 안에 연결 완료.

바로 써먹기:
1. .claude/mcp.json 파일을 프로젝트 루트에 생성
2. mcpServers 키에 서버 이름과 command/args 지정
3. Claude Code 재시작 후 /mcp 명령으로 연결 확인

예시 설정:
{
  "mcpServers": {
    "my-tools": {
      "command": "node",
      "args": ["./mcp-server.js"]
    }
  }
}

추가 팁:
- stdio 전송 방식 외에 SSE도 지원 예정
- 디버깅 시 MCP_DEBUG=1 환경변수 활용
- 여러 서버를 동시에 연결하면 도구가 합쳐져 사용 가능`,
            source_url: null,
            source_site: 'Claude Code Blog',
            published_at: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString(),
        },
        {
            title: 'Cursor vs Claude Code: 2026년 실전 비교',
            content: `두 AI 코딩 도구를 실제 프로젝트에서 2주간 사용한 결과를 정리했습니다.

Cursor는 IDE 내장형이라 세팅이 간편하고, Claude Code는 터미널 기반이라 자동화에 강합니다.
생산성 측면에서는 큰 차이가 없었지만, 대규모 리팩토링에서는 Claude Code의 컨텍스트 윈도우가 유리했습니다.

바로 써먹기:
1. 빠른 코드 작성 → Cursor 추천
2. 파일 여러 개 동시 편집 → Claude Code 추천
3. 팀 협업 → Cursor (IDE 공유 편의)

실전에서는 둘 다 설치해두고 상황에 따라 전환하는 것이 최선입니다.`,
            source_url: null,
            source_site: 'DevTools Weekly',
            published_at: new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000).toISOString(),
        },
        {
            title: '오래된 글: AI 코딩의 미래 예측',
            content: `2024년에 작성된 AI 코딩 전망 글입니다. 예측 위주로 실전 내용이 없습니다.
일반적인 미래 전망만 다루고 있어 실무에 바로 적용하기 어렵습니다.`,
            source_url: null,
            source_site: 'TechBlog',
            published_at: new Date(now.getTime() - 120 * 24 * 60 * 60 * 1000).toISOString(),
        },
    ]
}
