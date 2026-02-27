// ─── State Manager ───────────────────────────────────────────────────────────
// Manages state.json for daily publish limits and dedup tracking.
// ─────────────────────────────────────────────────────────────────────────────

import fs from 'fs/promises'
import path from 'path'

const OUTPUT_BASE = '/Users/changwan2450/Antigravity WorkSpace/AI_SYSTEM/naon.py/output/reports'
const STATE_FILE = path.join(OUTPUT_BASE, 'state.json')
const MAX_DAILY = 3

const DEFAULT_STATE = {
    last_run: null,
    last_publish: null,
    today_count: 0,
    today_date: null,
    published_titles: [],  // for 24h dedup
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
 * Get today's date as YYYY-MM-DD string.
 */
function todayStr() {
    return new Date().toISOString().slice(0, 10)
}

/**
 * Reset daily count if date has changed.
 */
export function resetIfNewDay(state) {
    const today = todayStr()
    if (state.today_date !== today) {
        return {
            ...state,
            today_count: 0,
            today_date: today,
            published_titles: [],
        }
    }
    return { ...state }
}

/**
 * Check if we can publish more today.
 */
export function canPublish(state) {
    return state.today_count < MAX_DAILY
}

/**
 * Check if title was already published in the last 24 hours.
 */
export function isDuplicate(state, title) {
    const normalised = title.toLowerCase().trim()
    return state.published_titles.some(t => t.toLowerCase().trim() === normalised)
}

/**
 * Mark a title as published.
 */
export function markPublished(state, title) {
    return {
        ...state,
        today_count: state.today_count + 1,
        last_publish: new Date().toISOString(),
        published_titles: [...state.published_titles, title],
    }
}

/**
 * Update last_run timestamp.
 */
export function markRun(state) {
    return {
        ...state,
        last_run: new Date().toISOString(),
    }
}
