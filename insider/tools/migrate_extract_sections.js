#!/usr/bin/env node
// ─── migrate_extract_sections.js ─────────────────────────────────────────────
// MD 본문에서 Shorts/Source 섹션을 제거하고 meta JSON으로 이동.
// Usage:
//   node insider/tools/migrate_extract_sections.js           # 실제 실행
//   node insider/tools/migrate_extract_sections.js --dry-run # 미리보기만
// ─────────────────────────────────────────────────────────────────────────────

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const POSTS_DIR = path.resolve(__dirname, '../../naon.py/output/insider/posts')
const DRY_RUN = process.argv.includes('--dry-run')

if (DRY_RUN) console.log('[DRY RUN] 실제 파일 변경 없음.\n')

// ── Source 라인 파서 ──────────────────────────────────────────────────────────
// 대상: > **Score**: 71 | **Source**: [Name](url) | 2026. 2. 25.
function parseSourceLine(line) {
    // [NAME](URL) 형식
    const mLink = line.match(/\*\*Source\*\*:\s*\[([^\]]+)\]\(([^)]+)\)/)
    // 날짜: 마지막 | 이후
    const mDate = line.match(/\|\s*\*\*([^*]+)\*\*\s*$/) || line.match(/\|\s*([\d. \-]+)\s*$/)
    if (mLink) {
        return {
            name: mLink[1].trim(),
            url: mLink[2].trim(),
            date: mDate ? mDate[1].trim() : undefined,
        }
    }
    // 텍스트 형식 (URL 없음)
    const mPlain = line.match(/\*\*Source\*\*:\s*([^|]+)/)
    if (mPlain) {
        return {
            name: mPlain[1].trim().replace(/\*\*/g, ''),
            date: mDate ? mDate[1].trim() : undefined,
        }
    }
    return null
}

// ── MD 처리 ───────────────────────────────────────────────────────────────────
function processMd(mdContent) {
    const lines = mdContent.split('\n')

    let shortsHeaderIdx = -1
    let sourceLineIdx = -1
    let parsedSource = null

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i]

        // Source 라인 탐지 (blockquote with Score | Source)
        if (/\*\*Source\*\*/.test(line) && />\s*\*\*Score\*\*/.test(line)) {
            sourceLineIdx = i
            parsedSource = parseSourceLine(line)
        }

        // Shorts 섹션 시작 탐지
        if (
            /🎬/.test(line) ||
            /Shorts\s*(변환|Script)/i.test(line) ||
            /^#{1,4}\s*Shorts/i.test(line)
        ) {
            shortsHeaderIdx = i
            break
        }
    }

    // Shorts 텍스트 추출 + 잘라내기
    let extractedShorts = ''
    let cutIdx = lines.length

    if (shortsHeaderIdx !== -1) {
        // 헤더 다음 줄부터 EOF까지 = Shorts 스크립트 본문
        extractedShorts = lines.slice(shortsHeaderIdx + 1).join('\n').trim()
        cutIdx = shortsHeaderIdx

        // 바로 앞 --- 구분선도 제거
        if (cutIdx > 0 && lines[cutIdx - 1].trim() === '---') cutIdx--
        // 빈 줄도 제거
        while (cutIdx > 0 && lines[cutIdx - 1].trim() === '') cutIdx--
    }

    // Source 라인 제거 (cutIdx 이전 라인에서)
    let newLines = lines.slice(0, cutIdx)
    if (sourceLineIdx !== -1 && sourceLineIdx < cutIdx) {
        newLines = newLines.filter((_, i) => i !== sourceLineIdx)
    }

    // 연속 빈 줄 정리 (2개 이상 → 1개)
    const cleaned = []
    let prevBlank = false
    for (const line of newLines) {
        const isBlank = line.trim() === ''
        if (isBlank && prevBlank) continue
        cleaned.push(line)
        prevBlank = isBlank
    }
    // 맨 끝 빈 줄 제거
    while (cleaned.length > 0 && cleaned[cleaned.length - 1].trim() === '') cleaned.pop()

    return {
        newMd: cleaned.join('\n') + '\n',
        parsedSource,
        extractedShorts,
        changed: shortsHeaderIdx !== -1 || sourceLineIdx !== -1,
    }
}

// ── 메인 ─────────────────────────────────────────────────────────────────────
function main() {
    if (!fs.existsSync(POSTS_DIR)) {
        console.error(`POSTS_DIR not found: ${POSTS_DIR}`)
        process.exit(1)
    }

    const mdFiles = fs.readdirSync(POSTS_DIR).filter(f => f.endsWith('.md')).sort()
    let changed = 0
    let skipped = 0

    for (const mdFile of mdFiles) {
        const mdPath = path.join(POSTS_DIR, mdFile)
        const jsonPath = mdPath.replace(/\.md$/, '.json')

        const mdContent = fs.readFileSync(mdPath, 'utf-8')
        let meta = {}
        if (fs.existsSync(jsonPath)) {
            try { meta = JSON.parse(fs.readFileSync(jsonPath, 'utf-8')) }
            catch { console.warn(`  WARN  ${mdFile}: corrupt JSON, skipping meta update`) }
        }

        const { newMd, parsedSource, extractedShorts, changed: mdChanged } = processMd(mdContent)

        let metaChanged = false

        // shorts_script: 추출된 게 있고, 아직 JSON에 없을 때만 저장
        if (extractedShorts && !meta.shorts_script) {
            meta.shorts_script = extractedShorts
            metaChanged = true
        }

        // source: 파싱 결과가 있고, JSON에 아직 없을 때만 저장
        if (parsedSource && !meta.source) {
            meta.source = {
                name: parsedSource.name,
                ...(parsedSource.url ? { url: parsedSource.url } : {}),
                ...(parsedSource.date ? { date: parsedSource.date } : {}),
            }
            metaChanged = true
        }

        // 레거시 source_url/source_site → meta.source 마이그레이션
        if (!meta.source && (meta.source_url || meta.source_site)) {
            meta.source = {
                name: meta.source_site || 'Unknown',
                ...(meta.source_url ? { url: meta.source_url } : {}),
            }
            metaChanged = true
        }

        if (!mdChanged && !metaChanged) {
            console.log(`  SKIP  ${mdFile}`)
            skipped++
            continue
        }

        const tags = []
        if (mdChanged) tags.push('MD')
        if (metaChanged) tags.push('JSON')
        console.log(`  ${DRY_RUN ? 'DRY ' : ''}WRITE  ${mdFile} [${tags.join(', ')}]`)
        if (metaChanged) {
            const src = meta.source
            if (src) console.log(`         → source: ${src.name}${src.url ? ' ' + src.url : ''}`)
            if (meta.shorts_script) console.log(`         → shorts_script: ${meta.shorts_script.slice(0, 60)}…`)
        }

        if (!DRY_RUN) {
            if (mdChanged) fs.writeFileSync(mdPath, newMd, 'utf-8')
            if (metaChanged) fs.writeFileSync(jsonPath, JSON.stringify(meta, null, 2), 'utf-8')
        }
        changed++
    }

    console.log(`\n${DRY_RUN ? '[DRY RUN] ' : ''}Done. Changed: ${changed}, Skipped: ${skipped}`)
}

main()
