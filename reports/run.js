#!/usr/bin/env node
// ─── AI Reports CLI Runner ──────────────────────────────────────────────────
// Usage: node reports/run.js
//
// Flow: Load state → Collect all adapters → Filter → Generate reports → Update state
// ─────────────────────────────────────────────────────────────────────────────

import fs from 'fs/promises'
import path from 'path'
import { collectAll } from './adapters/index.js'
import { generateReport } from './generator/generator.js'
import {
    loadState, saveState, resetIfNewDay,
    canPublish, isDuplicate, markPublished, markRun,
} from './state/state.js'

const LOG_DIR = '/Users/changwan2450/Antigravity WorkSpace/AI_SYSTEM/naon.py/output/reports/logs'
const MIN_CONTENT_LENGTH = 200

async function appendLog(message) {
    await fs.mkdir(LOG_DIR, { recursive: true })
    const logFile = path.join(LOG_DIR, 'reports.log')
    const ts = new Date().toISOString()
    await fs.appendFile(logFile, `[${ts}] ${message}\n`, 'utf-8')
}

async function main() {
    console.log('')
    console.log('╔══════════════════════════════════════╗')
    console.log('║       AI REPORTS – Phase 1 Run       ║')
    console.log('╚══════════════════════════════════════╝')
    console.log('')

    // ── 1. Load & reset state ──
    let state = await loadState()
    state = resetIfNewDay(state)
    console.log(`[STATE] today_count: ${state.today_count}/3 | last_run: ${state.last_run || 'never'} | last_publish: ${state.last_publish || 'never'}`)

    // ── 2. Collect ──
    console.log('[COLLECT] Running all adapters...')
    const rawItems = await collectAll()
    console.log(`[COLLECT] Collected ${rawItems.length} raw items`)
    console.log('')

    // ── 3. Filter & Generate ──
    let generated = 0
    let skipped = 0
    let discarded = 0

    for (const item of rawItems) {
        // Discard: content too short
        if (item.content.length < MIN_CONTENT_LENGTH) {
            console.log(`  ❌ [DISCARD] "${item.title}" (content too short: ${item.content.length} chars)`)
            discarded++
            continue
        }

        // Skip: daily limit reached
        if (!canPublish(state)) {
            console.log(`  ⏭  [SKIP] "${item.title}" (daily limit reached)`)
            skipped++
            continue
        }

        // Skip: duplicate title in 24h
        if (isDuplicate(state, item.title)) {
            console.log(`  ⏭  [SKIP] "${item.title}" (duplicate)`)
            skipped++
            continue
        }

        // Generate report
        try {
            const result = await generateReport(item)
            console.log(`  ✅ [GENERATED] ${result.basename}`)
            state = markPublished(state, item.title)
            generated++
        } catch (err) {
            console.error(`  ❌ [ERROR] "${item.title}":`, err.message)
            skipped++
        }
    }

    // ── 4. Update state ──
    state = markRun(state)
    await saveState(state)

    // ── 5. Log ──
    const logMsg = `Generated: ${generated} | Skipped: ${skipped} | Discarded: ${discarded}`
    await appendLog(logMsg)

    // ── 6. Summary ──
    console.log('')
    console.log('┌──────────────────────────────────────┐')
    console.log('│       [REPORTS] Run Complete          │')
    console.log('├──────────────────────────────────────┤')
    console.log(`│  Generated:   ${String(generated).padStart(3)}                   │`)
    console.log(`│  Skipped:     ${String(skipped).padStart(3)}                   │`)
    console.log(`│  Discarded:   ${String(discarded).padStart(3)}                   │`)
    console.log('└──────────────────────────────────────┘')
    console.log('')
}

main().catch(err => {
    console.error('[REPORTS] Fatal error:', err)
    process.exit(1)
})
