// ─── Publisher ───────────────────────────────────────────────────────────────
// Phase 5: Vibe Coding 특화 MD Engine
// - MD 본문 only (Shorts/Source 완전 분리)
// - meta JSON: level/topic/apply_to/artifacts/shorts_script/source
// - placeholder URL (example.com) 저장 금지
// ─────────────────────────────────────────────────────────────────────────────

import fs from 'fs/promises'
import path from 'path'

const OUTPUT_BASE = '/Users/changwan2450/Antigravity WorkSpace/AI_SYSTEM/naon.py/output/insider'
const POSTS_DIR = path.join(OUTPUT_BASE, 'posts')
const CANDIDATES_DIR = path.join(OUTPUT_BASE, 'candidates')

// ── URL 검증 ─────────────────────────────────────────────────────────────────

const PLACEHOLDER_DOMAINS = ['example.com', 'example.org', 'test.com', 'placeholder.com', 'localhost']

function isRealUrl(url) {
    if (!url || typeof url !== 'string') return false
    if (!url.startsWith('http')) return false
    return !PLACEHOLDER_DOMAINS.some(d => url.includes(d))
}

// ── Slug / Timestamp ──────────────────────────────────────────────────────────

function slugify(title) {
    return title
        .replace(/[^a-zA-Z0-9가-힣\s-]/g, '')
        .replace(/\s+/g, '-')
        .toLowerCase()
        .slice(0, 60)
}

function timestamp() {
    const d = new Date()
    return [
        d.getFullYear(),
        String(d.getMonth() + 1).padStart(2, '0'),
        String(d.getDate()).padStart(2, '0'),
    ].join('') + '-' + [
        String(d.getHours()).padStart(2, '0'),
        String(d.getMinutes()).padStart(2, '0'),
    ].join('')
}

// ── Text Helpers ──────────────────────────────────────────────────────────────

function extractChecklist(content) {
    const lines = (content || '').split('\n')
    const checks = []
    for (const line of lines) {
        const t = line.trim()
        if (/^\d+[\.)]/.test(t) && t.length > 5) {
            checks.push(t.replace(/^\d+[\.)\s]*/, '').trim())
        }
    }
    return checks.slice(0, 8)
}

function extractSection(content, keyword) {
    const lines = (content || '').split('\n')
    const out = []
    let capturing = false
    for (const line of lines) {
        if (line.toLowerCase().includes(keyword.toLowerCase())) { capturing = true; continue }
        if (capturing) {
            if (line.trim() === '' && out.length > 0) break
            if (out.length > 10) break
            out.push(line)
        }
    }
    return out.join('\n').trim()
}

// ── Meta: topic / level / apply_to / artifacts ────────────────────────────────

function inferTopic(text) {
    const t = text.toLowerCase()
    if (/prompt|프롬프트|context engineer|system prompt|instruction/.test(t)) return 'prompt'
    if (/n8n|webhook|pipeline|ci\/cd|github action|trigger|cronjob/.test(t)) return 'automation'
    if (/claude\.md|memory|context window|컨텍스트 설계|context engineering/.test(t)) return 'context-engineering'
    if (/\.md|template|템플릿|문서 구조|document structure/.test(t)) return 'md-workflow'
    if (/boilerplate|scaffold|starter|repo|monorepo|프로젝트 구조/.test(t)) return 'repo-template'
    return 'tooling'
}

function inferLevel(content, score) {
    const t = content.toLowerCase()
    if (/kubernetes|k8s|terraform|microservice|distributed|orchestrat/.test(t) || score >= 88) return 'advanced'
    if (/docker|n8n|webhook|typescript|async|pipeline|api|sdk|mcp/.test(t) || score >= 70) return 'intermediate'
    return 'beginner'
}

function inferApplyTo(content, title, topic) {
    const t = `${title} ${content}`.toLowerCase()
    const items = new Set()
    if (/팀|team|협업|onboard/.test(t)) items.add('팀 개발 환경 세팅')
    if (/프로토타입|prototype|빠른|rapid/.test(t)) items.add('빠른 프로토타이핑')
    if (/자동화|automation|배포|deploy/.test(t)) items.add('반복 작업 자동화')
    if (/ci\/cd|pipeline|github action/.test(t)) items.add('CI/CD 파이프라인 구성')
    if (/claude|cursor|copilot|ai 코딩|vibe/.test(t)) items.add('AI 코딩 워크플로우 최적화')
    if (/n8n|webhook|노드/.test(t)) items.add('n8n 워크플로우 구성')
    if (/docker|container/.test(t)) items.add('Docker 기반 로컬 환경')
    if (items.size < 2) { items.add('개인 개발 생산성 향상'); items.add('팀 온보딩 문서화') }
    return [...items].slice(0, 4)
}

function extractArtifacts(content) {
    // snippets: 코드 블록
    const snippets = []
    const codeRe = /```[\s\S]*?```/g
    let m
    while ((m = codeRe.exec(content)) !== null) snippets.push(m[0].trim())

    // commands: CLI 명령어 패턴 라인
    const commands = []
    for (const line of content.split('\n')) {
        const t = line.trim().replace(/^\$\s*/, '')
        if (/^(npm|npx|git|docker|node|curl|pm2|bash|sh|pip|python|yarn|brew|n8n)\s/.test(t)) {
            commands.push(t)
        }
    }

    const checklist = extractChecklist(content)
    return {
        snippets: snippets.slice(0, 3),
        checklist,
        templates: [],
        commands: [...new Set(commands)].slice(0, 10),
    }
}

// ── §1: 요약 (3줄 고정) ──────────────────────────────────────────────────────

function generateSummary(content) {
    const sentences = (content || '')
        .replace(/```[\s\S]*?```/g, '')
        .split(/[.\n]/)
        .map(s => s.trim())
        .filter(s => s.length > 20 && !/^(```|#|>|-|\d)/.test(s))
    const picked = sentences.slice(0, 3)
    while (picked.length < 3) picked.push(picked[picked.length - 1] || '본문 내용을 확인하세요')
    return picked.map(s => `- ${s}`).join('\n')
}

// ── §2: 왜 중요한가 (3문단) ──────────────────────────────────────────────────

function generateImportance(content, title) {
    const raw = extractSection(content, '왜') || extractSection(content, '주요') || ''
    const sentences = (content || '').split(/[.\n]/).map(s => s.trim()).filter(s => s.length > 12)

    const para1 = raw.length > 30
        ? raw
        : `**핵심**: ${title}은(는) 반복 작업을 자동화하고 팀 생산성을 직접적으로 끌어올려요. 한 번 세팅해두면 매번 손으로 하던 작업이 사라집니다.`

    const scenarioHint = sentences.find(s =>
        /실제|프로젝트|팀|배포|운영|prod/.test(s)
    )
    const para2 = scenarioHint
        ? `**실전 시나리오**: ${scenarioHint}. 이 패턴을 적용하면 디버깅 사이클이 크게 단축돼요.`
        : `**실전 시나리오**: 새 프로젝트 셋업, 레거시 리팩토링, CI/CD 파이프라인 구성 시 효과가 특히 두드러져요. 팀 규모가 커질수록 일관된 패턴 적용의 가치가 커집니다.`

    const para3 = `**언제 써야 하고 언제 조심해야 할까**: 빠른 프로토타이핑, 반복 자동화, 팀 온보딩에 적극 추천해요. 보안 요구가 높은 프로덕션이나 레거시 시스템 심층 통합 시엔 충분히 검증 후 적용하세요.`

    return [para1, para2, para3].join('\n\n')
}

// ── §3: 바로 써먹기 (체크리스트 + 💡) ───────────────────────────────────────

function generateChecklist(content) {
    const checks = extractChecklist(content)
    if (checks.length === 0) {
        return '- [ ] 본문에서 단계 정보를 추출할 수 없어요. 원문을 직접 확인하세요.'
    }
    const reasons = [
        '기본 환경이 정확해야 이후 단계 오류가 줄어요.',
        '핵심 의존성 먼저 확인하면 디버깅 시간을 아껴요.',
        '이 단계를 건너뛰면 런타임 에러로 돌아와요.',
        '설정 검증으로 배포 시 문제를 사전에 막아요.',
        '테스트를 먼저 돌리면 회귀 버그를 즉시 발견해요.',
        '문서화해두면 팀원 온보딩이 확 빨라져요.',
        '최종 점검으로 프로덕션 안정성을 확보해요.',
        '모니터링 설정으로 장기 유지보수가 수월해져요.',
    ]
    return checks.map((c, i) => {
        const reason = reasons[i] || '이 단계는 전체 워크플로우 안정성을 높여요.'
        return `- [ ] ${c}\n  > _💡 ${reason}_`
    }).join('\n')
}

// ── §4: 예시 (완성 코드 + 주석) ──────────────────────────────────────────────

function generateExample(content) {
    const raw = extractSection(content, '예시') || extractSection(content, 'example') || ''
    if (raw.length > 30) return raw

    // content에서 코드 블록 직접 추출
    const codeMatch = content.match(/```[\s\S]*?```/)
    if (codeMatch) return codeMatch[0]

    return `\`\`\`bash
# 1) 의존성 설치
npm install

# 2) 환경 변수 설정
cp .env.example .env
# .env 파일에서 필요한 값 입력

# 3) 실행
npm run dev
# → http://localhost:3000 확인
\`\`\`

> 위 예시는 일반 패턴이에요. 실제 프로젝트에 맞게 수정하세요.`
}

// ── §5: 실전 트러블 (문제→해결 2개) ─────────────────────────────────────────

function generateTroubles(content) {
    const raw = extractSection(content, '트러블') || extractSection(content, '추가 팁') || extractSection(content, '팁') || ''
    if (raw.length > 50) return raw

    return `**트러블 ① 설정 파일이 적용 안 될 때**
서버를 재시작해도 반영이 안 되면 캐시 문제가 대부분이에요. \`node_modules/.cache\` 삭제 후 재시작해보세요. 그래도 안 되면 \`dotenv.config()\`가 진입점 최상단에 있는지 확인하세요.

**트러블 ② 의존성 버전 충돌**
\`npm install\` 후 peer deps 에러가 뜨면 \`npm install --legacy-peer-deps\` 먼저 시도해요. 해결 안 되면 \`package-lock.json\` 삭제 후 재설치가 제일 빨라요. \`npm ls\`로 충돌 패키지를 직접 찾아 버전 고정도 가능해요.`
}

// ── Shorts 스크립트 (구어체, ~입니다 금지) ────────────────────────────────────

function generateShortsScript(item) {
    const title = item.title || ''
    const checks = extractChecklist(item.content)
    const hook = checks[0] || title
    const steps = checks.slice(0, 3)
    const stepText = steps.length > 0
        ? steps.map((s, i) => `${i + 1}. ${s}`).join('\n')
        : '핵심만 딱 짚어드릴게요.'

    return `[Hook – 3초]
"이거 모르면 진짜 손해예요."

[공감 – 5초]
"${hook}… 매번 검색하다 지치지 않았나요?"

[핵심 – 20초]
"방법은 간단해요.
${stepText}
이게 끝이에요. 진짜로."

[실전 예시 – 10초]
"실제로 해보면—
${steps[0] || title} 세팅하고 바로 확인 가능해요."

[마무리 – 5초]
"이런 실전 팁, 매일 올라와요.
AI Insider 확인해보세요. 🔥"`
}

// ── Tags ──────────────────────────────────────────────────────────────────────

function inferTags(item) {
    const text = `${item.title || ''} ${item.content || ''}`.toLowerCase()
    const tagMap = {
        'claude': 'claude-code', 'cursor': 'cursor', 'codex': 'codex',
        'n8n': 'n8n', 'github actions': 'github-actions', 'docker': 'docker',
        'tailwind': 'tailwind', 'vite': 'vite', 'react': 'react',
        'pm2': 'pm2', 'mcp': 'mcp', 'deploy': 'deployment',
        'playwright': 'playwright', 'express': 'express',
        '자동화': 'automation', 'automation': 'automation',
        'vibe': 'vibe-coding', 'ai': 'ai',
    }
    const tags = new Set()
    for (const [kw, tag] of Object.entries(tagMap)) {
        if (text.includes(kw)) tags.add(tag)
    }
    if (tags.size === 0) tags.add('general')
    return [...tags]
}

// ── Main functions ────────────────────────────────────────────────────────────

export async function ensureDirs() {
    await fs.mkdir(POSTS_DIR, { recursive: true })
    await fs.mkdir(CANDIDATES_DIR, { recursive: true })
}

/**
 * Publish: MD(본문 only) + JSON(meta 전체)
 */
export async function publishItem(item) {
    await ensureDirs()

    const ts = timestamp()
    const slug = slugify(item.title)
    const basename = `${ts}-${slug}`
    const mdPath = path.join(POSTS_DIR, `${basename}.md`)
    const jsonPath = path.join(POSTS_DIR, `${basename}.json`)

    const summary = generateSummary(item.content)
    const importance = generateImportance(item.content, item.title)
    const checklistMd = generateChecklist(item.content)
    const example = generateExample(item.content)
    const troubles = generateTroubles(item.content)
    const shortsScript = generateShortsScript(item)
    const tags = inferTags(item)
    const artifacts = extractArtifacts(item.content)
    const text = `${item.title || ''} ${item.content || ''}`
    const topic = inferTopic(text)
    const apply_to = inferApplyTo(item.content, item.title, topic)

    // ── URL 검증: placeholder 저장 금지 ──
    const rawUrl = item.url || item.link || item.canonical_url || item.source_url || null
    const sourceUrl = isRealUrl(rawUrl) ? rawUrl : null

    const source = {
        name: item.source_name || item.source_site || 'Unknown',
        ...(sourceUrl ? { url: sourceUrl } : {}),
        ...(item.source_date ? { date: item.source_date } : {}),
    }

    // ── Markdown: 본문 only ──
    const md = `# ${item.title}

---

## 1. 요약 (3줄)

${summary}

## 2. 왜 중요한가

${importance}

## 3. 바로 써먹기

${checklistMd}

## 4. 예시

${example}

## 5. 실전 트러블

${troubles}
`

    // ── JSON meta ──
    const scoreTotal = item.score_total ?? 0
    const meta = {
        title: item.title,
        published_at: new Date().toISOString(),
        score_total: scoreTotal,
        score_breakdown: item.score_breakdown,
        tags,
        level: inferLevel(item.content, scoreTotal),
        topic,
        apply_to,
        artifacts,
        shorts_script: shortsScript,
        shorts_eligible: (item.score_breakdown?.shorts_quality ?? 0) >= 6,
        source,
    }

    await fs.writeFile(mdPath, md, 'utf-8')
    await fs.writeFile(jsonPath, JSON.stringify(meta, null, 2), 'utf-8')

    return { mdPath, jsonPath, basename }
}

/**
 * Save candidate as JSON only.
 */
export async function saveCandidate(item) {
    await ensureDirs()

    const ts = timestamp()
    const slug = slugify(item.title)
    const basename = `${ts}-${slug}`
    const jsonPath = path.join(CANDIDATES_DIR, `${basename}.json`)

    const rawUrl = item.url || item.link || item.canonical_url || item.source_url || null
    const sourceUrl = isRealUrl(rawUrl) ? rawUrl : null

    const meta = {
        title: item.title,
        published_at: item.published_at,
        score_total: item.score_total,
        score_breakdown: item.score_breakdown,
        tags: inferTags(item),
        topic: inferTopic(`${item.title || ''} ${item.content || ''}`),
        source: {
            name: item.source_name || item.source_site || 'Unknown',
            ...(sourceUrl ? { url: sourceUrl } : {}),
        },
        _adapter: item._adapter,
    }

    await fs.writeFile(jsonPath, JSON.stringify(meta, null, 2), 'utf-8')
    return { jsonPath, basename }
}
