#!/usr/bin/env node
// ─── AI Insider CLI Runner ──────────────────────────────────────────────────
// Usage: node insider/run.js
//
// Flow: Load state → Crawl all adapters → Score → Publish/Save → Update state
// ─────────────────────────────────────────────────────────────────────────────

import fs from 'fs/promises'
import path from 'path'
import { crawlAll } from './adapters/index.js'
import { scoreAll } from './scoring/scorer.js'
import { publishItem, saveCandidate } from './publisher/publisher.js'
import { loadState, saveState, updateAfterRun } from './state/state.js'

const LOG_DIR = '/Users/changwan2450/Antigravity WorkSpace/AI_SYSTEM/naon.py/output/insider/logs'

async function appendLog(message) {
    await fs.mkdir(LOG_DIR, { recursive: true })
    const logFile = path.join(LOG_DIR, 'insider.log')
    const ts = new Date().toISOString()
    await fs.appendFile(logFile, `[${ts}] ${message}\n`, 'utf-8')
}

async function main() {
    console.log('')
    console.log('╔══════════════════════════════════════╗')
    console.log('║       AI INSIDER – Phase 1 Run       ║')
    console.log('╚══════════════════════════════════════╝')
    console.log('')

    // ── 1. Load state ──
    const state = await loadState()
    console.log(`[STATE] paused: ${state.paused} | last_run: ${state.last_run || 'never'} | last_publish: ${state.last_publish || 'never'}`)

    // ── 2. Crawl ──
    console.log('[CRAWL] Running all adapters...')
    const rawItems = await crawlAll()
    console.log(`[CRAWL] Collected ${rawItems.length} raw items`)

    // ── 3. Score ──
    console.log('[SCORE] Scoring items...')
    const scoredItems = scoreAll(rawItems)

    const toPublish = scoredItems.filter(i => i.decision === 'publish')
    const toCandidates = scoredItems.filter(i => i.decision === 'candidate')
    const toDiscard = scoredItems.filter(i => i.decision === 'discard')

    console.log(`[SCORE] Results: publish=${toPublish.length} candidate=${toCandidates.length} discard=${toDiscard.length}`)
    console.log('')

    // ── 4. Score details ──
    for (const item of scoredItems) {
        const b = item.score_breakdown
        const icon = item.decision === 'publish' ? '✅' : item.decision === 'candidate' ? '🟡' : '❌'
        console.log(`  ${icon} [${item.score_total}] ${item.title}`)
        console.log(`     practical=${b.practical} trust=${b.trust} recency=${b.recency} vibe=${b.vibe_fit} shorts=${b.shorts}`)
    }
    console.log('')

    // ── 5. Publish ──
    let publishedCount = 0

    if (state.paused && toPublish.length === 0) {
        console.log('[PUBLISH] ⏸  System is PAUSED (no >=70 items found). Skipping publish.')
    } else {
        for (const item of toPublish) {
            try {
                const result = await publishItem(item)
                console.log(`[PUBLISH] ✅ ${result.basename}`)
                publishedCount++
            } catch (err) {
                console.error(`[PUBLISH] ❌ Failed to publish "${item.title}":`, err.message)
            }
        }
    }

    // ── 6. Save candidates ──
    for (const item of toCandidates) {
        try {
            const result = await saveCandidate(item)
            console.log(`[CANDIDATE] 🟡 ${result.basename}`)
        } catch (err) {
            console.error(`[CANDIDATE] ❌ Failed to save "${item.title}":`, err.message)
        }
    }

    // ── 7. Update state ──
    const newState = updateAfterRun(state, publishedCount)
    await saveState(newState)

    // ── 8. Log ──
    const logMsg = `Published: ${publishedCount} | Candidates: ${toCandidates.length} | Discarded: ${toDiscard.length} | Paused: ${newState.paused}`
    await appendLog(logMsg)

    // ── 9. Summary ──
    console.log('')
    console.log('┌──────────────────────────────────────┐')
    console.log('│       [INSIDER] Run Complete          │')
    console.log('├──────────────────────────────────────┤')
    console.log(`│  Published:   ${String(publishedCount).padStart(3)}                   │`)
    console.log(`│  Candidates:  ${String(toCandidates.length).padStart(3)}                   │`)
    console.log(`│  Discarded:   ${String(toDiscard.length).padStart(3)}                   │`)
    console.log(`│  Paused:      ${String(newState.paused).padStart(5)}                 │`)
    console.log('└──────────────────────────────────────┘')
    console.log('')
}

main().catch(err => {
    console.error('[INSIDER] Fatal error:', err)
    process.exit(1)
})
