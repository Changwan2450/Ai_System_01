// ─── State Manager ───────────────────────────────────────────────────────────
// Manages state.json for auto-stop/resume and run tracking.
// ─────────────────────────────────────────────────────────────────────────────

import fs from 'fs/promises'
import path from 'path'

const OUTPUT_BASE = '/Users/changwan2450/Antigravity WorkSpace/AI_SYSTEM/naon.py/output/insider'
const STATE_FILE = path.join(OUTPUT_BASE, 'state.json')
const PAUSE_THRESHOLD_HOURS = 72

const DEFAULT_STATE = {
    last_run: null,
    last_publish: null,
    paused: false,
}

export async function ensureDir() {
    await fs.mkdir(OUTPUT_BASE, { recursive: true })
}

/**
 * Load state from disk. Returns default if missing.
 */
export async function loadState() {
    await ensureDir()
    try {
        const raw = await fs.readFile(STATE_FILE, 'utf-8')
        return { ...DEFAULT_STATE, ...JSON.parse(raw) }
    } catch {
        return { ...DEFAULT_STATE }
    }
}

/**
 * Save state to disk.
 */
export async function saveState(state) {
    await ensureDir()
    await fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2), 'utf-8')
}

/**
 * Check if auto-pause should trigger.
 * Pauses if last_publish was >72 hours ago (or never happened).
 */
export function shouldPause(state) {
    if (!state.last_publish) return false // Don't pause on first ever run
    const lastPub = new Date(state.last_publish)
    const hoursSince = (Date.now() - lastPub.getTime()) / (1000 * 60 * 60)
    return hoursSince >= PAUSE_THRESHOLD_HOURS
}

/**
 * Update state after a run.
 * @param {object} state - Current state
 * @param {number} publishedCount - Number of items published this run
 * @returns {object} Updated state
 */
export function updateAfterRun(state, publishedCount) {
    const updated = { ...state }
    updated.last_run = new Date().toISOString()

    if (publishedCount > 0) {
        updated.last_publish = new Date().toISOString()
        updated.paused = false // Auto-resume if we published something
    } else {
        // Check pause condition
        if (shouldPause(updated)) {
            updated.paused = true
        }
    }

    return updated
}
