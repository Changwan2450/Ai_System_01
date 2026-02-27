// ─── OpenAI Updates (Mock Adapter) ───────────────────────────────────────────
// Returns mock articles about OpenAI product/model announcements.
// Replace with real HTTP scraping in Phase 2.
// ─────────────────────────────────────────────────────────────────────────────

export const name = 'openai-updates'

export async function fetch() {
    const now = new Date()
    return [
        {
            title: 'GPT-5 공식 발표: 추론 속도 3배, 컨텍스트 윈도우 1M 토큰',
            content: `OpenAI가 GPT-5를 공식 발표했습니다. 가장 주목할 만한 변화는 추론 속도가 GPT-4o 대비 약 3배 빨라졌다는 점과, 컨텍스트 윈도우가 100만 토큰으로 확장되었다는 것입니다.

무슨 일이 있었나:
OpenAI는 블로그를 통해 GPT-5의 주요 사양을 공개했습니다. 새 모델은 기존 GPT-4o의 아키텍처를 기반으로 하되, 추론 엔진을 완전히 재설계했습니다. 특히 긴 문서 처리와 코드 생성에서 큰 성능 향상을 보여주고 있습니다.

왜 중요한가:
100만 토큰 컨텍스트는 실무에서 전체 코드베이스를 한 번에 분석할 수 있다는 의미입니다. 기존에는 파일 단위로 잘라서 넣어야 했던 작업이 이제 프로젝트 전체를 넣고 리팩토링 요청을 할 수 있는 수준이 됩니다.

앞으로 어떻게 될까:
Anthropic, Google 등 경쟁사들도 비슷한 수준의 컨텍스트 확장을 발표할 가능성이 높습니다. 개발 도구 생태계에서는 더 큰 파일을 다루는 에이전트 기반 워크플로가 표준이 될 것으로 보입니다.

쉽게 이해하기:
지금까지 AI에게 "책 한 쪽"씩 보여주며 질문했다면, 이제는 "책 전체"를 한 번에 건네고 물어볼 수 있게 된 것입니다.`,
            source_url: 'https://openai.com/blog/gpt-5',
            source_site: 'OpenAI Blog',
            published_at: new Date(now.getTime() - 6 * 60 * 60 * 1000).toISOString(),
        },
        {
            title: 'OpenAI, Codex CLI 오픈소스 공개: 터미널에서 직접 AI 코딩',
            content: `OpenAI가 Codex CLI를 오픈소스로 공개했습니다. 터미널 환경에서 자연어 명령으로 코드를 생성하고 실행할 수 있는 도구입니다.

무슨 일이 있었나:
GitHub에 공개된 Codex CLI는 Node.js 기반으로 동작하며, OpenAI API 키만 있으면 바로 사용할 수 있습니다. 파일 읽기/쓰기, 명령어 실행, 코드 리팩토링 등을 자연어로 지시할 수 있습니다.

왜 중요한가:
Claude Code, Cursor 등 기존 AI 코딩 도구가 유료 구독 모델인 반면, Codex CLI는 오픈소스로 제공되어 커뮤니티 생태계가 빠르게 확장될 수 있습니다. API 비용만 부담하면 되므로 소규모 개발자에게 특히 유리합니다.

앞으로 어떻게 될까:
터미널 기반 AI 코딩이 표준 워크플로로 자리잡을 가능성이 높습니다. IDE 의존도가 줄어들고, 자동화 스크립트와의 통합이 쉬워질 것입니다.

쉽게 이해하기:
프로그래밍을 모르는 사람도 컴퓨터의 "명령 창"을 열고, 한국어로 "이 폴더에 있는 파일 이름을 전부 바꿔줘"라고 말하면 AI가 대신 해주는 도구가 무료로 공개된 겁니다.`,
            source_url: 'https://github.com/openai/codex-cli',
            source_site: 'GitHub / OpenAI',
            published_at: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString(),
        },
    ]
}
