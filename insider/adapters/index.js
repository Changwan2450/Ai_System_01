// ─── Adapter Registry ────────────────────────────────────────────────────────
// Imports all source adapters and provides a unified crawl interface.
// Add new adapters here as they are built.
// ─────────────────────────────────────────────────────────────────────────────

import * as claudeCodeNews from './claude-code-news.js'
import * as devtoolsWeekly from './devtools-weekly.js'
import * as automationBlog from './automation-blog.js'

const adapters = [claudeCodeNews, devtoolsWeekly, automationBlog]

/**
 * Run all adapters and return a flat array of raw items.
 * Each item gets `_adapter` field for traceability.
 */
export async function crawlAll() {
    const results = []

    for (const adapter of adapters) {
        try {
            const items = await adapter.fetch()
            for (const item of items) {
                results.push({ ...item, _adapter: adapter.name })
            }
        } catch (err) {
            console.error(`[INSIDER] Adapter "${adapter.name}" failed:`, err.message)
        }
    }

    return results
}
