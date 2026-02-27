import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { useNavigate, useParams } from 'react-router-dom'
import Toast from '../components/Toast'
import { createTodayDoc, loadTodayDocs, saveTodayDocs, type TodayDoc } from '../lib/storage'
import type { TemplateKey } from '../lib/templates'

type SaveState = 'idle' | 'saving' | 'saved'
type FilterMode = 'all' | 'dirty' | 'saved'
type MenuPosition = { top: number; left: number }

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

function sortByUpdated(docs: TodayDoc[]): TodayDoc[] {
  return [...docs].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

function toSlug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'note'
}

function renderInline(text: string): ReactNode[] {
  const parts = text.split(/(`[^`]+`)/g)
  return parts.map((part, index) => {
    if (part.startsWith('`') && part.endsWith('`') && part.length > 1) {
      return (
        <code key={index} className="md-inline-code">
          {part.slice(1, -1)}
        </code>
      )
    }
    return <span key={index}>{part}</span>
  })
}

function renderMarkdown(content: string): ReactNode[] {
  const lines = content.replace(/\r\n/g, '\n').split('\n')
  const blocks: ReactNode[] = []
  let i = 0

  const isSpecial = (line: string): boolean => {
    const trimmed = line.trim()
    return (
      trimmed.startsWith('#') ||
      /^[-*]\s+/.test(trimmed) ||
      /^\d+\.\s+/.test(trimmed) ||
      /^- \[[ xX]\]\s+/.test(trimmed) ||
      trimmed.startsWith('```')
    )
  }

  while (i < lines.length) {
    const raw = lines[i]
    const trimmed = raw.trim()

    if (!trimmed) {
      i += 1
      continue
    }

    if (trimmed.startsWith('```')) {
      const language = trimmed.slice(3).trim()
      const codeLines: string[] = []
      i += 1
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i])
        i += 1
      }
      if (i < lines.length) i += 1
      blocks.push(
        <pre key={`code-${i}`} className="md-code-block" data-lang={language || undefined}>
          <code>{codeLines.join('\n')}</code>
        </pre>,
      )
      continue
    }

    const headingMatch = trimmed.match(/^(#{1,6})\s+(.*)$/)
    if (headingMatch) {
      const level = headingMatch[1].length
      const text = headingMatch[2]
      const Tag = `h${Math.min(level, 4)}` as 'h1' | 'h2' | 'h3' | 'h4'
      blocks.push(
        <Tag key={`h-${i}`} className={`md-heading md-heading-${level}`}>
          {renderInline(text)}
        </Tag>,
      )
      i += 1
      continue
    }

    if (/^- \[[ xX]\]\s+/.test(trimmed)) {
      const items: Array<{ checked: boolean; text: string }> = []
      while (i < lines.length && /^- \[[ xX]\]\s+/.test(lines[i].trim())) {
        const item = lines[i].trim().match(/^- \[([ xX])\]\s+(.*)$/)
        if (item) {
          items.push({ checked: item[1].toLowerCase() === 'x', text: item[2] })
        }
        i += 1
      }
      blocks.push(
        <ul key={`check-${i}`} className="md-list md-checklist">
          {items.map((item, index) => (
            <li key={index}>
              <input type="checkbox" checked={item.checked} readOnly />
              <span>{renderInline(item.text)}</span>
            </li>
          ))}
        </ul>,
      )
      continue
    }

    if (/^[-*]\s+/.test(trimmed)) {
      const items: string[] = []
      while (i < lines.length && /^[-*]\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^[-*]\s+/, ''))
        i += 1
      }
      blocks.push(
        <ul key={`ul-${i}`} className="md-list">
          {items.map((item, index) => (
            <li key={index}>{renderInline(item)}</li>
          ))}
        </ul>,
      )
      continue
    }

    if (/^\d+\.\s+/.test(trimmed)) {
      const items: string[] = []
      while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^\d+\.\s+/, ''))
        i += 1
      }
      blocks.push(
        <ol key={`ol-${i}`} className="md-list md-ordered">
          {items.map((item, index) => (
            <li key={index}>{renderInline(item)}</li>
          ))}
        </ol>,
      )
      continue
    }

    const paragraphLines: string[] = []
    while (i < lines.length && lines[i].trim() && !isSpecial(lines[i])) {
      paragraphLines.push(lines[i])
      i += 1
    }
    blocks.push(
      <p key={`p-${i}`} className="md-paragraph">
        {renderInline(paragraphLines.join(' '))}
      </p>,
    )
  }

  return blocks
}

function Today() {
  const [docs, setDocs] = useState<TodayDoc[]>(() => loadTodayDocs())
  const [search, setSearch] = useState('')
  const [filterMode, setFilterMode] = useState<FilterMode>('all')
  const [preview, setPreview] = useState(false)
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const [dirtyIds, setDirtyIds] = useState<Set<string>>(new Set())
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [lastSavedAt, setLastSavedAt] = useState('')
  const [menuDocId, setMenuDocId] = useState<string | null>(null)
  const [menuPosition, setMenuPosition] = useState<MenuPosition | null>(null)
  const [toast, setToast] = useState<{ message: string; tone: 'success' | 'error' | 'neutral' }>({
    message: '',
    tone: 'neutral',
  })

  const menuRef = useRef<HTMLDivElement | null>(null)
  const menuButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({})

  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()

  const currentDoc = useMemo(() => docs.find((doc) => doc.id === id) ?? null, [docs, id])
  const activeMenuDoc = useMemo(
    () => (menuDocId ? docs.find((doc) => doc.id === menuDocId) ?? null : null),
    [docs, menuDocId],
  )

  const setMenuTriggerRef = useCallback((docId: string, node: HTMLButtonElement | null) => {
    menuButtonRefs.current[docId] = node
  }, [])

  const computeMenuPosition = useCallback((docId: string) => {
    const trigger = menuButtonRefs.current[docId]
    if (!trigger) {
      setMenuPosition(null)
      return
    }

    const rect = trigger.getBoundingClientRect()
    const menuWidth = menuRef.current?.offsetWidth ?? 148
    const menuHeight = menuRef.current?.offsetHeight ?? 92
    const margin = 10

    const left = Math.min(
      Math.max(margin, rect.right - menuWidth),
      window.innerWidth - menuWidth - margin,
    )

    const placeBelow = rect.bottom + margin + menuHeight <= window.innerHeight - margin
    const top = placeBelow
      ? rect.bottom + margin
      : Math.max(margin, rect.top - menuHeight - margin)

    setMenuPosition({ top, left })
  }, [])

  const closeMenu = useCallback(() => {
    setMenuDocId(null)
    setMenuPosition(null)
  }, [])

  useLayoutEffect(() => {
    if (!menuDocId) return
    computeMenuPosition(menuDocId)

    const handleViewport = () => computeMenuPosition(menuDocId)
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Element | null
      if (!target) return
      const inMenu = menuRef.current?.contains(target)
      const inTrigger = target.closest(`[data-menu-trigger-id="${menuDocId}"]`)
      if (!inMenu && !inTrigger) closeMenu()
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMenu()
    }

    window.addEventListener('resize', handleViewport)
    window.addEventListener('scroll', handleViewport, true)
    window.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.removeEventListener('resize', handleViewport)
      window.removeEventListener('scroll', handleViewport, true)
      window.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [menuDocId, computeMenuPosition, closeMenu])

  const persistDocs = useCallback((nextDocs: TodayDoc[]) => {
    const sorted = sortByUpdated(nextDocs)
    setDocs(sorted)
    saveTodayDocs(sorted)
  }, [])

  const markDirty = useCallback((docId: string) => {
    setDirtyIds((prev) => {
      const next = new Set(prev)
      next.add(docId)
      return next
    })
    setSaveState('idle')
  }, [])

  const createFromTemplate = useCallback(
    (template: TemplateKey) => {
      const doc = createTodayDoc(template)
      persistDocs([doc, ...docs])
      navigate(`/today/${doc.id}`)
      setPreview(false)
      setInspectorOpen(true)
      setToast({ message: 'Created a new document.', tone: 'success' })
    },
    [docs, navigate, persistDocs],
  )

  const duplicateDoc = useCallback(
    (doc: TodayDoc) => {
      const now = new Date()
      const iso = now.toISOString()
      const suffix = Math.random().toString(36).slice(2, 8)
      const duplicate: TodayDoc = {
        ...doc,
        id: `${doc.date}-${suffix}`,
        title: `${doc.title || doc.date} Copy`,
        createdAt: iso,
        updatedAt: iso,
      }
      persistDocs([duplicate, ...docs])
      navigate(`/today/${duplicate.id}`)
      setToast({ message: 'Document duplicated.', tone: 'success' })
    },
    [docs, navigate, persistDocs],
  )

  const deleteDoc = useCallback(
    (doc: TodayDoc) => {
      const filtered = docs.filter((item) => item.id !== doc.id)
      persistDocs(filtered)
      setDirtyIds((prev) => {
        const next = new Set(prev)
        next.delete(doc.id)
        return next
      })
      if (id === doc.id) {
        navigate('/today')
      }
      setToast({ message: 'Document deleted.', tone: 'success' })
    },
    [docs, id, navigate, persistDocs],
  )

  const saveNow = useCallback((docId: string) => {
    const now = new Date().toISOString()
    setSaveState('saving')
    setDocs((prev) => {
      const updated = sortByUpdated(prev.map((doc) => (doc.id === docId ? { ...doc, updatedAt: now } : doc)))
      saveTodayDocs(updated)
      return updated
    })
    setDirtyIds((prev) => {
      const next = new Set(prev)
      next.delete(docId)
      return next
    })
    setSaveState('saved')
    setLastSavedAt(now)
  }, [])

  useEffect(() => {
    if (!currentDoc) return
    if (!dirtyIds.has(currentDoc.id)) return

    setSaveState('saving')
    const timer = window.setTimeout(() => saveNow(currentDoc.id), 800)
    return () => window.clearTimeout(timer)
  }, [currentDoc, dirtyIds, saveNow])

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (!event.metaKey || !currentDoc) return
      const key = event.key.toLowerCase()

      if (key === 's') {
        event.preventDefault()
        saveNow(currentDoc.id)
      }
      if (key === 'p') {
        event.preventDefault()
        setPreview((value) => !value)
      }
      if (key === 'd') {
        event.preventDefault()
        duplicateDoc(currentDoc)
      }
    }

    window.addEventListener('keydown', handleShortcut)
    return () => window.removeEventListener('keydown', handleShortcut)
  }, [currentDoc, duplicateDoc, saveNow])

  const filteredDocs = useMemo(() => {
    const query = search.trim().toLowerCase()
    return sortByUpdated(docs).filter((doc) => {
      const matchesSearch =
        !query ||
        doc.title.toLowerCase().includes(query) ||
        doc.content.toLowerCase().includes(query) ||
        doc.tags.some((tag) => tag.toLowerCase().includes(query))
      if (!matchesSearch) return false
      if (filterMode === 'dirty') return dirtyIds.has(doc.id)
      if (filterMode === 'saved') return !dirtyIds.has(doc.id)
      return true
    })
  }, [docs, search, filterMode, dirtyIds])

  const saveStatusText = useMemo(() => {
    if (!currentDoc) return 'No document selected'
    if (saveState === 'saving') return 'Saving...'
    if (saveState === 'saved') return `Saved · ${formatTime(lastSavedAt || currentDoc.updatedAt)}`
    if (dirtyIds.has(currentDoc.id)) return 'Unsaved changes'
    return `Saved · ${formatTime(currentDoc.updatedAt)}`
  }, [currentDoc, dirtyIds, saveState, lastSavedAt])

  const updateCurrentDoc = useCallback(
    (patch: Partial<TodayDoc>) => {
      if (!currentDoc) return
      setDocs((prev) => prev.map((doc) => (doc.id === currentDoc.id ? { ...doc, ...patch } : doc)))
      markDirty(currentDoc.id)
    },
    [currentDoc, markDirty],
  )

  const copyMarkdown = useCallback(async () => {
    if (!currentDoc) return
    try {
      await navigator.clipboard.writeText(currentDoc.content)
      setToast({ message: 'Markdown copied.', tone: 'success' })
    } catch {
      setToast({ message: 'Could not copy markdown.', tone: 'error' })
    }
  }, [currentDoc])

  const exportMarkdown = useCallback(() => {
    if (!currentDoc) return
    const blob = new Blob([currentDoc.content], { type: 'text/markdown;charset=utf-8' })
    const fileName = `${toSlug(currentDoc.title || currentDoc.date)}.md`
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = fileName
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)
    setToast({ message: 'Markdown exported.', tone: 'success' })
  }, [currentDoc])

  return (
    <div className="page-stack">
      <header className="page-head">
        <h1 className="page-title">Today</h1>
        <p className="page-subtitle">Daily writing board with URL-based detail navigation.</p>
      </header>

      <div className="today-workspace">
        <aside className="today-list panel">
          <div className="panel-top">
            <div className="template-actions" role="group" aria-label="Create document">
              <button className="segment-btn" type="button" onClick={() => createFromTemplate('today')}>
                New Today
              </button>
              <button className="segment-btn" type="button" onClick={() => createFromTemplate('blank')}>
                New Blank
              </button>
              <button className="segment-btn" type="button" onClick={() => createFromTemplate('ai-analysis')}>
                New AI Analysis
              </button>
            </div>

            <input
              className="list-search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search documents"
            />

            <select
              className="list-filter"
              value={filterMode}
              onChange={(event) => setFilterMode(event.target.value as FilterMode)}
            >
              <option value="all">All</option>
              <option value="dirty">Dirty</option>
              <option value="saved">Saved</option>
            </select>
          </div>

          <ul className="doc-list premium-doc-list">
            {filteredDocs.length > 0 ? (
              filteredDocs.map((doc) => {
                const isDirty = dirtyIds.has(doc.id)
                return (
                  <li key={doc.id}>
                    <div className={`doc-row${doc.id === id ? ' doc-row-active' : ''}`}>
                      <button
                        className="doc-row-main"
                        type="button"
                        onClick={() => {
                          navigate(`/today/${doc.id}`)
                          closeMenu()
                        }}
                      >
                        <span className="doc-row-title">{doc.title || doc.date}</span>
                        <span className="doc-row-meta">Updated {formatTime(doc.updatedAt)}</span>
                      </button>

                      <span
                        className={`doc-row-dot ${isDirty ? 'doc-row-dot-dirty' : 'doc-row-dot-saved'}`}
                        title={isDirty ? 'Dirty' : 'Saved'}
                      />

                      <button
                        className="doc-row-menu-trigger"
                        type="button"
                        aria-label="More"
                        data-menu-trigger-id={doc.id}
                        ref={(node) => setMenuTriggerRef(doc.id, node)}
                        onClick={() => {
                          if (menuDocId === doc.id) {
                            closeMenu()
                            return
                          }
                          setMenuDocId(doc.id)
                        }}
                      >
                        ...
                      </button>
                    </div>
                  </li>
                )
              })
            ) : (
              <li>
                <div className="empty-state">
                  <div className="empty-state-title">No documents yet</div>
                  <div className="empty-state-body">Create your first note to start tracking work.</div>
                  <div className="empty-state-actions">
                    <button className="btn btn-primary" type="button" onClick={() => createFromTemplate('today')}>
                      New Today
                    </button>
                  </div>
                </div>
              </li>
            )}
          </ul>
        </aside>

        <section className="today-editor panel">
          {currentDoc ? (
            <>
              <header className="editor-header">
                <h2 className="editor-title">{currentDoc.title || currentDoc.date}</h2>
                <div className="editor-tools" role="toolbar" aria-label="Editor actions">
                  <button
                    className="icon-tool"
                    type="button"
                    title="Save (Cmd+S)"
                    onClick={() => saveNow(currentDoc.id)}
                  >
                    S
                  </button>
                  <button
                    className="icon-tool"
                    type="button"
                    title="Toggle Preview (Cmd+P)"
                    onClick={() => setPreview((value) => !value)}
                  >
                    P
                  </button>
                  <button
                    className="icon-tool"
                    type="button"
                    title="Duplicate (Cmd+D)"
                    onClick={() => duplicateDoc(currentDoc)}
                  >
                    D
                  </button>
                  <button
                    className="icon-tool danger"
                    type="button"
                    title="Delete"
                    onClick={() => deleteDoc(currentDoc)}
                  >
                    X
                  </button>
                  <button
                    className="icon-tool inspector-toggle"
                    type="button"
                    title="Toggle Inspector"
                    onClick={() => setInspectorOpen((value) => !value)}
                  >
                    I
                  </button>
                </div>
              </header>

              <div className="save-line">{saveStatusText}</div>

              <div className="editor-body">
                {preview ? (
                  <article className="md-preview">{renderMarkdown(currentDoc.content)}</article>
                ) : (
                  <textarea
                    className="editor-textarea"
                    value={currentDoc.content}
                    onChange={(event) => updateCurrentDoc({ content: event.target.value })}
                    placeholder="Write markdown notes"
                  />
                )}
              </div>
            </>
          ) : (
            <div className="empty-state centered-empty">
              <div className="empty-state-title">Select a document</div>
              <div className="empty-state-body">Pick a note from the list or start a new template.</div>
              <div className="empty-state-actions">
                <button className="btn btn-primary" type="button" onClick={() => createFromTemplate('today')}>
                  New Today
                </button>
              </div>
            </div>
          )}
        </section>

        <aside
          className={`today-inspector panel${inspectorOpen ? ' inspector-open' : ''}`}
          aria-label="Inspector"
        >
          {currentDoc ? (
            <div className="inspector-stack">
              <h3 className="inspector-title">Inspector</h3>

              <label className="inspector-label" htmlFor="inspector-title">
                Title
              </label>
              <input
                id="inspector-title"
                className="inspector-input"
                value={currentDoc.title}
                onChange={(event) => updateCurrentDoc({ title: event.target.value })}
                placeholder="Document title"
              />

              <label className="inspector-label" htmlFor="inspector-date">
                Date
              </label>
              <input
                id="inspector-date"
                className="inspector-input"
                type="date"
                value={currentDoc.date}
                onChange={(event) => updateCurrentDoc({ date: event.target.value })}
              />

              <label className="inspector-label" htmlFor="inspector-tags">
                Tags
              </label>
              <input
                id="inspector-tags"
                className="inspector-input"
                value={currentDoc.tags.join(', ')}
                onChange={(event) =>
                  updateCurrentDoc({
                    tags: event.target.value
                      .split(',')
                      .map((tag) => tag.trim())
                      .filter(Boolean),
                  })
                }
                placeholder="ops, review"
              />

              <div className="inspector-meta">Created: {new Date(currentDoc.createdAt).toLocaleString()}</div>
              <div className="inspector-meta">Updated: {new Date(currentDoc.updatedAt).toLocaleString()}</div>

              <div className="inspector-actions">
                <button className="inspector-btn" type="button" onClick={copyMarkdown}>
                  Copy Markdown
                </button>
                <button className="inspector-btn" type="button" onClick={exportMarkdown}>
                  Export .md
                </button>
                <button className="inspector-btn" type="button" onClick={() => duplicateDoc(currentDoc)}>
                  Duplicate
                </button>
                <button className="inspector-btn danger" type="button" onClick={() => deleteDoc(currentDoc)}>
                  Delete
                </button>
              </div>
            </div>
          ) : (
            <div className="empty-state centered-empty">
              <div className="empty-state-title">Inspector is ready</div>
              <div className="empty-state-body">Select a document to edit metadata and quick actions.</div>
              <div className="empty-chip-row">
                <span className="empty-chip">Title</span>
                <span className="empty-chip">Date</span>
                <span className="empty-chip">Tags</span>
              </div>
            </div>
          )}
        </aside>
      </div>

      {menuDocId && menuPosition
        ? createPortal(
            <div
              className="context-menu"
              ref={menuRef}
              style={{ top: `${menuPosition.top}px`, left: `${menuPosition.left}px` }}
              role="menu"
              aria-label="Document actions"
            >
              <button
                className="context-menu-item"
                type="button"
                onClick={() => {
                  if (activeMenuDoc) duplicateDoc(activeMenuDoc)
                  closeMenu()
                }}
              >
                Duplicate
              </button>
              <button
                className="context-menu-item danger"
                type="button"
                onClick={() => {
                  if (activeMenuDoc) deleteDoc(activeMenuDoc)
                  closeMenu()
                }}
              >
                Delete
              </button>
            </div>,
            document.body,
          )
        : null}

      <Toast message={toast.message} tone={toast.tone} />
    </div>
  )
}

export default Today
