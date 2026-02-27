#!/usr/bin/env node
// ─── migrate_fix_source.js ────────────────────────────────────────────────────
// posts/*.json + candidates/*.json 마이그레이션:
//   1) source.url에 example.com 포함 → null 처리
//   2) legacy source_url에 example.com → null
//   3) level 없으면 title/tags/score 기반 추론
//   4) topic 없으면 title/tags 기반 추론
//   5) apply_to 없으면 기본값 2개
//   6) artifacts 없으면 checklist 기반 생성
//
// Usage:
//   node insider/tools/migrate_fix_source.js            # 실제 실행
//   node insider/tools/migrate_fix_source.js --dry-run  # 미리보기
// ─────────────────────────────────────────────────────────────────────────────

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUTPUT_BASE = path.resolve(__dirname, '../../naon.py/output/insider')
const POSTS_DIR = path.join(OUTPUT_BASE, 'posts')
const CANDIDATES_DIR = path.join(OUTPUT_BASE, 'candidates')
const DRY_RUN = process.argv.includes('--dry-run')

// ── URL 검증 ─────────────────────────────────────────────────────────────────

const PLACEHOLDER_DOMAINS = ['example.com', 'example.org', 'test.com', 'placeholder.com', 'localhost']

function isPlaceholder(url) {
    if (!url || typeof url !== 'string') return false
    return PLACEHOLDER_DOMAINS.some(d => url.includes(d))
}

// ── Topic 추론 ────────────────────────────────────────────────────────────────

function inferTopic(title, tags) {
    const text = `${title} ${(tags || []).join(' ')}`.toLowerCase()
    if (/prompt|프롬프트|context engineer/.test(text)) return 'prompt'
    if (/n8n|webhook|pipeline|ci\/cd|github.action|trigger/.test(text)) return 'automation'
    if (/claude\.md|memory|context window/.test(text)) return 'context-engineering'
    if (/\.md|template|템플릿|문서/.test(text)) return 'md-workflow'
    if (/boilerplate|scaffold|repo|monorepo/.test(text)) return 'repo-template'
    return 'tooling'
}

// ── Level 추론 ────────────────────────────────────────────────────────────────

function inferLevel(title, tags, score) {
    const text = `${title} ${(tags || []).join(' ')}`.toLowerCase()
    if (/kubernetes|k8s|terraform|microservice/.test(text) || score >= 88) return 'advanced'
    if (/docker|n8n|webhook|typescript|pipeline|mcp/.test(text) || score >= 70) return 'intermediate'
    return 'beginner'
}

// ── Apply To 기본값 ───────────────────────────────────────────────────────────

function inferApplyTo(title, topic) {
    const t = (title || '').toLowerCase()
    const items = new Set()
    if (/팀|team|협업/.test(t)) items.add('팀 개발 환경 세팅')
    if (/자동화|automation|배포|deploy/.test(t)) items.add('반복 작업 자동화')
    if (/claude|cursor|ai|vibe/.test(t)) items.add('AI 코딩 워크플로우 최적화')
    if (/n8n|webhook/.test(t)) items.add('n8n 워크플로우 구성')
    if (/docker|container/.test(t)) items.add('Docker 기반 로컬 환경')
    if (items.size < 2) { items.add('개인 개발 생산성 향상'); items.add('팀 온보딩 문서화') }
    return [...items].slice(0, 4)
}

// ── 디렉토리 처리 ─────────────────────────────────────────────────────────────

function processDir(dir, label) {
    if (!fs.existsSync(dir)) {
        console.log(`  (skip) ${label} not found: ${dir}`)
        return { changed: 0, skipped: 0 }
    }

    const jsonFiles = fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort()
    let changed = 0
    let skipped = 0

    for (const file of jsonFiles) {
        const fp = path.join(dir, file)
        let meta
        try { meta = JSON.parse(fs.readFileSync(fp, 'utf-8')) }
        catch { console.warn(`  WARN  ${file}: parse error, skipping`); skipped++; continue }

        const changes = []

        // 1) source.url: example.com → null (remove key)
        if (meta.source && isPlaceholder(meta.source.url)) {
            delete meta.source.url
            changes.push('source.url → null')
        }

        // 2) legacy source_url: example.com → null
        if (meta.source_url && isPlaceholder(meta.source_url)) {
            meta.source_url = null
            changes.push('source_url → null')
        }

        // 3) level 기본값
        if (!meta.level) {
            meta.level = inferLevel(meta.title, meta.tags, meta.score_total ?? 0)
            changes.push(`level → ${meta.level}`)
        }

        // 4) topic 기본값
        if (!meta.topic) {
            meta.topic = inferTopic(meta.title, meta.tags)
            changes.push(`topic → ${meta.topic}`)
        }

        // 5) apply_to 기본값
        if (!meta.apply_to || meta.apply_to.length === 0) {
            meta.apply_to = inferApplyTo(meta.title, meta.topic)
            changes.push(`apply_to → [${meta.apply_to.join(', ')}]`)
        }

        // 6) artifacts 기본값 (checklist 기반)
        if (!meta.artifacts) {
            const checklist = meta.checklist ?? []
            meta.artifacts = {
                snippets: [],
                checklist,
                templates: [],
                commands: [],
            }
            changes.push(`artifacts → {checklist: ${checklist.length} items}`)
        }

        if (changes.length === 0) {
            console.log(`  SKIP  [${label}] ${file}`)
            skipped++
            continue
        }

        console.log(`  ${DRY_RUN ? 'DRY ' : ''}WRITE  [${label}] ${file}`)
        for (const c of changes) console.log(`         → ${c}`)

        if (!DRY_RUN) {
            fs.writeFileSync(fp, JSON.stringify(meta, null, 2), 'utf-8')
        }
        changed++
    }

    return { changed, skipped }
}

// ── 메인 ─────────────────────────────────────────────────────────────────────

function main() {
    if (DRY_RUN) console.log('[DRY RUN] 파일 변경 없음.\n')

    const posts = processDir(POSTS_DIR, 'posts')
    console.log()
    const candidates = processDir(CANDIDATES_DIR, 'candidates')

    const totalChanged = posts.changed + candidates.changed
    const totalSkipped = posts.skipped + candidates.skipped
    console.log(`\n${DRY_RUN ? '[DRY RUN] ' : ''}Done. Changed: ${totalChanged}, Skipped: ${totalSkipped}`)
    console.log(`  posts:      changed=${posts.changed}, skipped=${posts.skipped}`)
    console.log(`  candidates: changed=${candidates.changed}, skipped=${candidates.skipped}`)
}

main()
