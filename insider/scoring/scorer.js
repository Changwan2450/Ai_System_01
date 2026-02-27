// ─── Scoring Engine ──────────────────────────────────────────────────────────
// Phase 5: Vibe Coding 특화 가중치
//   실행 가능성(30) + 복붙 가능성(20) + 자동화 연결성(20)
//   + MD 구조 완성도(15) + AI 활용 깊이(15) = 100
//
// 하드 탈락: 500자 미만 | 코드블록·체크리스트 모두 없음
// >=70 → publish | 50-69 → candidate | <50 → discard
// ─────────────────────────────────────────────────────────────────────────────

// ── Keyword sets ──────────────────────────────────────────────────────────────

const EXEC_KEYWORDS = [
    'npm', 'npx', 'git', 'docker', 'node', 'curl', 'bash', 'sh',
    'pip', 'python', 'yarn', 'pnpm', 'brew', 'apt', 'chmod', 'mkdir',
    '명령어', '실행', '설치', 'install', 'run', 'deploy', 'start',
]

const COPYPASTE_MARKERS = [
    '```', 'yaml', 'json', 'dockerfile', 'nginx.conf', '.env',
    'docker-compose', 'package.json', 'tsconfig', '.config.',
    '설정 파일', '템플릿', 'template', 'snippet', 'config',
]

const AUTOMATION_KEYWORDS = [
    'n8n', 'github actions', 'github action', 'webhook', 'pipeline', 'cron',
    'deploy', '배포', 'ci/cd', 'cicd', 'trigger', 'workflow',
    'automation', '자동화', 'pm2', 'nginx', 'ssl', 'certbot',
    'scheduler', 'crontab', 'make ', 'makefile',
]

const AI_DEPTH_KEYWORDS = [
    'claude', 'cursor', 'copilot', 'mcp', 'llm', 'gpt', 'gemini',
    'prompt', '프롬프트', 'context', 'agent', 'vibe coding',
    'claude.md', 'system prompt', 'instruction', 'anthropic',
    'context engineering', '컨텍스트', 'tool use', 'function calling',
]

const SPAM_KEYWORDS = [
    '광고', 'sponsored', 'top 10', 'top10', '최고의', '베스트',
    '가격 비교', 'pricing', '할인', '구매', 'buy now',
]

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractChecklist(content) {
    return (content || '').split('\n')
        .map(l => l.trim())
        .filter(l => /^\d+[\.)]/.test(l) && l.length > 5)
}

function countCodeBlocks(content) {
    return ((content || '').match(/```/g) || []).length / 2 | 0
}

function countSections(content) {
    return ((content || '').match(/^##\s+/gm) || []).length
}

// ── Score ─────────────────────────────────────────────────────────────────────

export function scoreItem(item) {
    const title = item.title || ''
    const content = item.content || ''
    const text = `${title} ${content}`.toLowerCase()

    // ── Hard discard conditions ──
    const codeBlockCount = countCodeBlocks(content)
    const checklistCount = extractChecklist(content).length
    const hasArtifacts = codeBlockCount > 0 || checklistCount > 0
    const isTooShort = content.length < 500
    const spamHits = SPAM_KEYWORDS.filter(kw => text.includes(kw))
    const isSpam = spamHits.length >= 2

    // ── 1) 실행 가능성 (0-30) ──
    let executability = 0
    const execHits = EXEC_KEYWORDS.filter(kw => text.includes(kw.toLowerCase()))
    executability = Math.min(20, execHits.length * 3)
    if (codeBlockCount >= 1) executability += 5
    if (codeBlockCount >= 2) executability += 3
    if (content.match(/^\$\s|\bnpm\s|\bdocker\s|\bgit\s/m)) executability += 2
    executability = Math.min(30, executability)

    // ── 2) 복붙 가능성 (0-20) ──
    let copyPaste = 0
    const cpHits = COPYPASTE_MARKERS.filter(kw => text.includes(kw.toLowerCase()))
    copyPaste = Math.min(12, cpHits.length * 2)
    if (codeBlockCount >= 1) copyPaste += 4
    if (content.includes('.env') || content.includes('docker-compose')) copyPaste += 4
    copyPaste = Math.min(20, copyPaste)

    // ── 3) 자동화 연결성 (0-20) ──
    let automation = 0
    const autoHits = AUTOMATION_KEYWORDS.filter(kw => text.includes(kw.toLowerCase()))
    automation = Math.min(20, autoHits.length * 4)

    // ── 4) MD 구조 완성도 (0-15) ──
    let mdStructure = 0
    const sectionCount = countSections(content)
    mdStructure += Math.min(6, sectionCount * 2)
    if (checklistCount >= 3) mdStructure += 4
    if (codeBlockCount >= 1) mdStructure += 3
    if (content.includes('추가 팁') || content.includes('트러블')) mdStructure += 2
    mdStructure = Math.min(15, mdStructure)

    // ── 5) AI 활용 깊이 (0-15) ──
    let aiDepth = 0
    const aiHits = AI_DEPTH_KEYWORDS.filter(kw => text.includes(kw.toLowerCase()))
    aiDepth = Math.min(15, aiHits.length * 3)

    // ── Spam 패널티 ──
    const spamPenalty = Math.min(30, spamHits.length * 10)

    const score_total = Math.max(0, executability + copyPaste + automation + mdStructure + aiDepth - spamPenalty)
    const score_breakdown = {
        executability,
        copyPaste,
        automation,
        mdStructure,
        aiDepth,
        spamPenalty,
        codeBlocks: codeBlockCount,
        checklists: checklistCount,
    }

    // ── Decision ──
    let decision
    if (isTooShort || !hasArtifacts || isSpam) {
        decision = 'discard'
    } else if (score_total >= 70) {
        decision = 'publish'
    } else if (score_total >= 50) {
        decision = 'candidate'
    } else {
        decision = 'discard'
    }

    return { score_total, score_breakdown, decision }
}

export function scoreAll(items) {
    return items.map(item => {
        const { score_total, score_breakdown, decision } = scoreItem(item)
        return { ...item, score_total, score_breakdown, decision }
    })
}
