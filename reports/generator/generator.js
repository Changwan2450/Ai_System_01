// ─── Report Generator ────────────────────────────────────────────────────────
// Generates fixed 5-section analytical report MD files.
// Tone: 분석가 스타일, 비전공자도 이해 가능, 자극적 표현 금지.
// ─────────────────────────────────────────────────────────────────────────────

import fs from 'fs/promises'
import path from 'path'

const OUTPUT_BASE = '/Users/changwan2450/Antigravity WorkSpace/AI_SYSTEM/naon.py/output/reports'
const POSTS_DIR = path.join(OUTPUT_BASE, 'posts')

// ── Helpers ──────────────────────────────────────────────────────────────────

function slugify(title) {
    return title
        .replace(/[^a-zA-Z0-9가-힣\s-]/g, '')
        .replace(/\s+/g, '-')
        .toLowerCase()
        .slice(0, 60)
}

function timestamp() {
    const d = new Date()
    const YYYY = d.getFullYear()
    const MM = String(d.getMonth() + 1).padStart(2, '0')
    const DD = String(d.getDate()).padStart(2, '0')
    const HH = String(d.getHours()).padStart(2, '0')
    const mm = String(d.getMinutes()).padStart(2, '0')
    return `${YYYY}${MM}${DD}-${HH}${mm}`
}

function extractNamedSection(content, ...keywords) {
    const lines = content.split('\n')
    const results = []
    let capturing = false
    for (const line of lines) {
        const lower = line.toLowerCase()
        if (keywords.some(kw => lower.includes(kw.toLowerCase()))) {
            capturing = true
            // Don't include the section header itself if it's just a label
            if (line.trim().endsWith(':') || line.trim().endsWith('?')) continue
            continue
        }
        if (capturing) {
            // Stop at blank line or next section header
            if (line.trim() === '' && results.length > 0) {
                // Allow one blank line
                if (results[results.length - 1] === '') break
            }
            if (results.length > 15) break
            results.push(line)
        }
    }
    return results.join('\n').trim()
}

function generateSummary(content) {
    const sentences = content
        .split(/[.\n]/)
        .map(s => s.trim())
        .filter(s => s.length > 15)
        .slice(0, 3)
    return sentences.map(s => `- ${s}`).join('\n')
}

// ── Main ─────────────────────────────────────────────────────────────────────

export async function ensureDirs() {
    await fs.mkdir(POSTS_DIR, { recursive: true })
}

/**
 * Generate a report markdown file for a collected item.
 * @returns {{ mdPath, basename }} or null if skipped
 */
export async function generateReport(item) {
    await ensureDirs()

    const ts = timestamp()
    const slug = slugify(item.title)
    const basename = `${ts}-${slug}`
    const mdPath = path.join(POSTS_DIR, `${basename}.md`)

    // Extract sections from content (adapters provide structured content)
    const summary = generateSummary(item.content)
    const whatHappened = extractNamedSection(item.content, '무슨 일이', '일이 있었나') || item.content.split('\n').slice(0, 3).join('\n')
    const whyImportant = extractNamedSection(item.content, '왜 중요', '중요한가') || '(본문 참조)'
    const outlook = extractNamedSection(item.content, '앞으로', '어떻게 될까') || '(분석 중)'
    const easyExplain = extractNamedSection(item.content, '쉽게 이해', '이해하기') || '(추후 보완)'

    const pubDate = new Date(item.published_at).toLocaleDateString('ko-KR', {
        year: 'numeric', month: 'long', day: 'numeric',
    })

    const md = `# ${item.title}

> **Source**: [${item.source_site}](${item.source_url})
> **Published**: ${pubDate}

---

## 1. 한 줄 요약
${summary}

## 2. 무슨 일이 있었나
${whatHappened}

## 3. 왜 중요한가
${whyImportant}

## 4. 앞으로 어떻게 될까
${outlook}

## 5. 쉽게 이해하기
${easyExplain}
`

    await fs.writeFile(mdPath, md, 'utf-8')
    return { mdPath, basename }
}
