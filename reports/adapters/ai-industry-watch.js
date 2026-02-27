// ─── AI Industry Watch (Mock Adapter) ────────────────────────────────────────
// Returns mock articles about broader AI industry trends.
// Replace with real HTTP scraping in Phase 2.
// ─────────────────────────────────────────────────────────────────────────────

export const name = 'ai-industry-watch'

export async function fetch() {
    const now = new Date()
    return [
        {
            title: 'AI 코딩 도구 시장, 2026년 100억 달러 돌파 전망',
            content: `시장조사 기관 Gartner의 최신 보고서에 따르면, AI 코딩 도구 시장 규모가 2026년 100억 달러(약 14조 원)를 넘어설 것으로 전망됩니다.

무슨 일이 있었나:
GitHub Copilot, Cursor, Claude Code 등 AI 코딩 어시스턴트의 기업 도입률이 전년 대비 280% 증가했습니다. 특히 중소기업에서의 채택이 두드러지며, "AI 없이 코딩하는 것이 오히려 비효율적"이라는 인식이 확산되고 있습니다.

왜 중요한가:
AI 코딩 도구가 "선택"에서 "필수"로 전환되는 시점입니다. 기업의 개발팀 채용 공고에서 "AI 코딩 도구 활용 경험"이 우대 조건에서 필수 조건으로 바뀌고 있습니다.

앞으로 어떻게 될까:
2027년까지 전체 코드의 50% 이상이 AI와의 협업으로 작성될 것이라는 전망이 있습니다. 개발자의 역할이 "코드 작성자"에서 "AI 감독자 + 아키텍트"로 변화할 것입니다.

쉽게 이해하기:
계산기가 나왔을 때 회계사가 사라지지 않았듯이, AI 코딩 도구도 개발자를 대체하는 게 아닙니다. 다만, 계산기를 안 쓰는 회계사를 찾기 어려워진 것처럼, AI를 안 쓰는 개발자도 그렇게 될 것입니다.`,
            source_url: 'https://example.com/ai-coding-market-2026',
            source_site: 'Gartner Research',
            published_at: new Date(now.getTime() - 4 * 60 * 60 * 1000).toISOString(),
        },
        {
            title: 'EU AI Act 시행 1년: 개발자에게 실제로 달라진 것',
            content: `EU AI Act가 시행된 지 1년이 지났습니다. 실제로 개발 현장에서 무엇이 달라졌는지 정리했습니다.

무슨 일이 있었나:
고위험 AI 시스템에 대한 투명성 요구가 강화되면서, 기업들은 AI 모델의 학습 데이터 출처와 의사결정 과정을 문서화하기 시작했습니다. 개발자들은 모델 카드(Model Card)를 필수로 작성해야 합니다.

왜 중요한가:
미국과 아시아에서도 유사한 규제가 논의 중이며, EU의 사례가 글로벌 표준의 기초가 될 가능성이 높습니다. 지금부터 규제 대응 체계를 갖추는 것이 장기적으로 유리합니다.

앞으로 어떻게 될까:
2027년까지 대부분의 국가에서 AI 관련 규제 프레임워크가 마련될 것으로 예상됩니다. 오픈소스 AI에 대한 예외 조항이 쟁점이 될 것입니다.

쉽게 이해하기:
자동차에 안전벨트와 에어백이 필수가 된 것처럼, AI에도 "안전 장치"를 설계 단계부터 넣어야 하는 시대가 온 것입니다.`,
            source_url: 'https://example.com/eu-ai-act-year-one',
            source_site: 'AI Regulation Monitor',
            published_at: new Date(now.getTime() - 8 * 60 * 60 * 1000).toISOString(),
        },
    ]
}
