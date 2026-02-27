// ─── Anthropic News (Mock Adapter) ───────────────────────────────────────────
// Returns mock articles about Anthropic/Claude announcements.
// Replace with real HTTP scraping in Phase 2.
// ─────────────────────────────────────────────────────────────────────────────

export const name = 'anthropic-news'

export async function fetch() {
    const now = new Date()
    return [
        {
            title: 'Anthropic, Claude 4 Opus 발표: "사고의 깊이"에 집중한 차세대 모델',
            content: `Anthropic이 Claude 4 Opus를 발표했습니다. 이번 모델은 단순한 속도나 크기 경쟁 대신 "깊은 추론(deep reasoning)"에 초점을 맞췄습니다.

무슨 일이 있었나:
Claude 4 Opus는 복잡한 수학 문제, 장문의 법률 문서 분석, 다단계 코드 디버깅에서 기존 모델 대비 현저한 성능 향상을 보여줍니다. Anthropic은 이를 "extended thinking"이라는 기능으로 구현했으며, 모델이 답변 전에 내부적으로 사고 과정을 더 오래 거칩니다.

왜 중요한가:
AI 업계가 단순히 "빠르고 큰 모델"에서 "더 정확하고 신중한 모델" 방향으로 전환하고 있음을 보여주는 신호입니다. 실무에서는 복잡한 버그를 찾거나, 대규모 코드 리뷰를 할 때 더 정확한 답변을 기대할 수 있습니다.

앞으로 어떻게 될까:
"생각하는 시간을 더 주면 더 좋은 답이 나온다"는 접근이 업계 표준이 될 가능성이 있습니다. 결과적으로 사용자는 "빠른 응답"과 "정확한 응답" 중 선택하는 옵션을 갖게 될 것입니다.

쉽게 이해하기:
시험을 볼 때 30분 안에 빠르게 푸는 것과, 2시간 동안 천천히 정확하게 푸는 것의 차이입니다. Claude 4 Opus는 후자를 선택한 모델입니다.`,
            source_url: 'https://anthropic.com/blog/claude-4-opus',
            source_site: 'Anthropic Blog',
            published_at: new Date(now.getTime() - 12 * 60 * 60 * 1000).toISOString(),
        },
        {
            title: 'Claude, MCP(Model Context Protocol) 생태계 100개 서버 돌파',
            content: `Anthropic의 MCP(Model Context Protocol) 생태계에 등록된 공식 서버가 100개를 넘었습니다.

무슨 일이 있었나:
MCP는 AI 모델과 외부 도구/서비스를 연결하는 표준 프로토콜입니다. GitHub, Slack, PostgreSQL, 파일시스템 등 다양한 서비스를 AI에 연결할 수 있게 해줍니다. 3개월 만에 커뮤니티 기여 서버가 폭발적으로 늘었습니다.

왜 중요한가:
AI가 "대화만 하는 도구"에서 "실제로 작업을 수행하는 도구"로 진화하고 있음을 보여주는 핵심 지표입니다. DB 조회, 파일 수정, API 호출 등을 AI가 직접 수행할 수 있는 시대가 본격적으로 열리고 있습니다.

앞으로 어떻게 될까:
MCP가 업계 표준으로 자리잡으면 모든 SaaS 서비스가 MCP 서버를 제공하는 것이 당연해질 것입니다. OpenAI도 유사한 프로토콜을 채택하거나 MCP를 지원할 가능성이 높습니다.

쉽게 이해하기:
스마트폰의 앱스토어처럼, AI에게 "기능을 추가할 수 있는 플러그인 가게"가 생긴 것입니다. 지금 100개의 기능이 올라왔고, 앞으로 수천 개로 늘어날 것입니다.`,
            source_url: 'https://anthropic.com/mcp-ecosystem',
            source_site: 'Anthropic Blog',
            published_at: new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000).toISOString(),
        },
        {
            title: '짧은 뉴스: Anthropic 사무실 이전',
            content: `Anthropic이 사무실을 이전했습니다.`,
            source_url: 'https://example.com/anthropic-office',
            source_site: 'TechCrunch',
            published_at: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString(),
        },
    ]
}
