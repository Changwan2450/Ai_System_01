import { createTemplateContent, type TemplateKey } from './templates'

export const TODAY_DOCS_KEY = 'factory_today_docs'
const LEGACY_DAILY_DOCS_KEY = 'factory_daily_docs'

export type TodayDoc = {
  id: string
  title: string
  content: string
  date: string
  tags: string[]
  createdAt: string
  updatedAt: string
}

function normalizeDate(value: unknown): string {
  const raw = typeof value === 'string' && value.trim() ? value : ''
  if (raw) return raw.slice(0, 10)
  return new Date().toISOString().slice(0, 10)
}

function normalizeTags(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item) => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
}

function normalizeDoc(value: unknown): TodayDoc | null {
  const raw = (value ?? {}) as Record<string, unknown>
  const id = typeof raw.id === 'string' ? raw.id : ''
  if (!id) return null

  const createdAt = typeof raw.createdAt === 'string' ? raw.createdAt : new Date().toISOString()
  const updatedAt = typeof raw.updatedAt === 'string' ? raw.updatedAt : createdAt
  const title = typeof raw.title === 'string' ? raw.title : ''
  const content = typeof raw.content === 'string' ? raw.content : ''

  return {
    id,
    title,
    content,
    date: normalizeDate(raw.date),
    tags: normalizeTags(raw.tags),
    createdAt,
    updatedAt,
  }
}

function parseDocs(raw: string | null): TodayDoc[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .map(normalizeDoc)
      .filter((doc): doc is TodayDoc => Boolean(doc))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  } catch {
    return []
  }
}

export function loadTodayDocs(): TodayDoc[] {
  const current = parseDocs(localStorage.getItem(TODAY_DOCS_KEY))
  if (current.length > 0) return current

  const legacy = parseDocs(localStorage.getItem(LEGACY_DAILY_DOCS_KEY))
  if (legacy.length > 0) {
    saveTodayDocs(legacy)
    localStorage.removeItem(LEGACY_DAILY_DOCS_KEY)
    return legacy
  }

  return []
}

export function saveTodayDocs(docs: TodayDoc[]) {
  localStorage.setItem(TODAY_DOCS_KEY, JSON.stringify(docs))
}

export function createTodayDoc(template: TemplateKey): TodayDoc {
  const now = new Date()
  const iso = now.toISOString()
  const date = iso.slice(0, 10)
  const rand = Math.random().toString(36).slice(2, 8)
  return {
    id: `${date}-${rand}`,
    title: template === 'blank' ? '' : `${date} Notes`,
    content: createTemplateContent(template, now),
    date,
    tags: [],
    createdAt: iso,
    updatedAt: iso,
  }
}
