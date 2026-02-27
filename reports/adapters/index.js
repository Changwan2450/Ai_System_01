// ─── Adapter Registry ────────────────────────────────────────────────────────
// Imports all report source adapters and provides a unified collect interface.
// Add new adapters here as they are built.
// ─────────────────────────────────────────────────────────────────────────────

import * as openaiUpdates from './openai-updates.js'
import * as anthropicNews from './anthropic-news.js'
import * as aiIndustryWatch from './ai-industry-watch.js'

const adapters = [openaiUpdates, anthropicNews, aiIndustryWatch]

/**
 * Run all adapters and return a flat array of raw items.
 */
export async function collectAll() {
    const results = []

    for (const adapter of adapters) {
        try {
            const items = await adapter.fetch()
            for (const item of items) {
                results.push({ ...item, _adapter: adapter.name })
            }
        } catch (err) {
            console.error(`[REPORTS] Adapter "${adapter.name}" failed:`, err.message)
        }
    }

    return results
}
