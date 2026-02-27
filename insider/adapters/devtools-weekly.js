// ─── DevTools Weekly (Mock Adapter) ──────────────────────────────────────────
// Returns mock articles about frontend/dev tooling.
// Replace with real HTTP scraping in Phase 2.
// ─────────────────────────────────────────────────────────────────────────────

export const name = 'devtools-weekly'

export async function fetch() {
    const now = new Date()
    return [
        {
            title: 'Tailwind v4 마이그레이션 체크리스트: 5가지 핵심 변경점',
            content: `Tailwind CSS v4로 업그레이드할 때 반드시 확인해야 할 5가지를 정리했습니다.

1. @config 지시자가 @import 기반으로 변경
2. 색상 시스템이 OKLCH 기반으로 전환
3. 플러그인 API가 CSS-first로 변경
4. content 설정이 자동 감지로 전환
5. darkMode 설정 방식 변경

바로 써먹기:
1. npx @tailwindcss/upgrade 실행
2. tailwind.config.js → CSS @theme으로 이전
3. 커스텀 플러그인 있으면 CSS 방식으로 재작성
4. 빌드 후 시각적 변경 없는지 스크린샷 비교

추가 팁:
- @tailwindcss/vite 플러그인으로 PostCSS 불필요
- v3와 v4 동시 운영은 권장하지 않음
- 마이그레이션 전 git branch 분리 필수`,
            source_url: null,
            source_site: 'DevTools Weekly',
            published_at: new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000).toISOString(),
        },
        {
            title: 'Vite 7 성능 벤치마크: 빌드 속도 40% 향상',
            content: `Vite 7이 출시되면서 빌드 성능이 대폭 개선되었습니다.

주요 개선점:
- Rolldown 기반 번들러로 전환
- HMR 속도 2배 향상
- 청크 분할 알고리즘 최적화

바로 써먹기:
1. package.json에서 vite 버전 "^7.0.0"으로 업데이트
2. npm install 실행
3. vite.config.ts에서 deprecated 옵션 제거
4. npm run build로 정상 빌드 확인`,
            source_url: null,
            source_site: 'Frontend Focus',
            published_at: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString(),
        },
    ]
}
