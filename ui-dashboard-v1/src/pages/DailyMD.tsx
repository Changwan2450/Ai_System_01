import { useCallback, useEffect, useState } from 'react'
import Header from '../components/Header'

// ─── Types ───────────────────────────────────────────────────────────────────
interface DailyFile {
    id: string
    filename: string
    mtimeISO: string
    timeHHMM: string
}

// ─── Toast ───────────────────────────────────────────────────────────────────
function Toast({ message, visible }: { message: string; visible: boolean }) {
    if (!visible) return null
    return (
        <div className="fixed bottom-6 right-6 z-[110] px-4 py-2.5 rounded-lg text-xs font-medium text-white/90 bg-emerald-600/90 border border-emerald-400/30 shadow-lg">
            {message}
        </div>
    )
}

// ─── Main ────────────────────────────────────────────────────────────────────
export default function DailyMD() {
    const [files, setFiles] = useState<DailyFile[]>([])
    const [activeId, setActiveId] = useState<string | null>(null)
    const [content, setContent] = useState('')
    const [saving, setSaving] = useState(false)
    const [toast, setToast] = useState({ visible: false, message: '' })
    const [loading, setLoading] = useState(true)

    const showToast = useCallback((msg: string) => {
        setToast({ visible: true, message: msg })
        setTimeout(() => setToast({ visible: false, message: '' }), 2500)
    }, [])

    // ── Fetch file list ──
    const fetchList = useCallback(async () => {
        try {
            const r = await fetch('/api/daily/list')
            if (!r.ok) throw new Error('fail')
            const data: DailyFile[] = await r.json()
            setFiles(data)
        } catch { setFiles([]) }
        finally { setLoading(false) }
    }, [])

    // ── Fetch one file ──
    const loadFile = useCallback(async (id: string) => {
        setActiveId(id)
        try {
            const r = await fetch(`/api/daily/${id}`)
            const d = await r.json()
            setContent(d.content ?? '')
        } catch {
            setContent('')
        }
    }, [])

    // ── Save ──
    const handleSave = async () => {
        if (!activeId) return
        setSaving(true)
        try {
            await fetch('/api/daily/save', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: activeId, content }),
            })
            showToast(`Saved ${activeId}.md`)
            await fetchList()
        } catch { showToast('Save failed') }
        finally { setSaving(false) }
    }

    // ── Delete ──
    const handleDelete = async () => {
        if (!activeId) return
        if (!confirm(`Delete ${activeId}.md?`)) return
        try {
            await fetch(`/api/daily/${activeId}`, { method: 'DELETE' })
            showToast(`Deleted ${activeId}.md`)
            setActiveId(null)
            setContent('')
            await fetchList()
        } catch { showToast('Delete failed') }
    }

    // ── New file ──
    const handleNew = async () => {
        const today = new Date().toISOString().slice(0, 10)
        const skeleton = `# ${today}\n\n## Tasks\n- [ ] \n\n## Notes\n\n`
        try {
            await fetch('/api/daily/save', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: today, content: skeleton }),
            })
            showToast(`Created ${today}.md`)
            await fetchList()
            loadFile(today)
        } catch { showToast('Create failed') }
    }

    // ── Keyboard shortcut ──
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 's') {
                e.preventDefault()
                handleSave()
            }
        }
        window.addEventListener('keydown', handler)
        return () => window.removeEventListener('keydown', handler)
    })

    useEffect(() => { fetchList() }, [fetchList])

    return (
        <div className="min-h-screen flex flex-col">
            <Header apiOnline />

            <div className="flex flex-1 overflow-hidden">

                {/* ── Left sidebar: file list ── */}
                <aside className="w-[280px] shrink-0 border-r border-white/8 flex flex-col bg-white/[0.015]">
                    {/* Header */}
                    <div className="px-4 py-3 border-b border-white/8 flex items-center justify-between">
                        <div>
                            <h2 className="text-sm font-semibold text-white/80">📝 Daily Notes</h2>
                            <p className="text-[10px] text-white/30 mt-0.5">{files.length} files</p>
                        </div>
                        <button
                            onClick={handleNew}
                            className="px-2.5 py-1 rounded text-[10px] font-semibold text-cyan-400 bg-cyan-500/10 border border-cyan-500/20 hover:bg-cyan-500/20 transition-colors"
                        >
                            + New
                        </button>
                    </div>

                    {/* File list */}
                    <div className="flex-1 overflow-y-auto">
                        {loading && <p className="px-4 py-6 text-xs text-white/30 text-center">Loading…</p>}
                        {!loading && files.length === 0 && (
                            <p className="px-4 py-6 text-xs text-white/30 text-center">No files yet.</p>
                        )}
                        {files.map(f => (
                            <button
                                key={f.id}
                                onClick={() => loadFile(f.id)}
                                className={`w-full text-left px-4 py-2.5 border-b border-white/[0.04] transition-colors ${activeId === f.id
                                        ? 'bg-cyan-500/10 border-l-2 border-l-cyan-400'
                                        : 'hover:bg-white/5 border-l-2 border-l-transparent'
                                    }`}
                            >
                                <p className={`text-xs font-medium ${activeId === f.id ? 'text-cyan-400' : 'text-white/70'}`}>
                                    {f.id}
                                </p>
                                <p className="text-[10px] text-white/25 mt-0.5">{f.timeHHMM}</p>
                            </button>
                        ))}
                    </div>
                </aside>

                {/* ── Right: editor ── */}
                <main className="flex-1 flex flex-col">
                    {activeId ? (
                        <>
                            {/* Editor toolbar */}
                            <div className="px-4 py-2.5 border-b border-white/8 flex items-center justify-between bg-white/[0.015]">
                                <div>
                                    <span className="text-xs font-medium text-white/70">{activeId}.md</span>
                                    <span className="text-[10px] text-white/25 ml-2">⌘S to save</span>
                                </div>
                                <div className="flex gap-2">
                                    <button
                                        onClick={handleDelete}
                                        className="px-3 py-1 rounded text-[10px] font-medium text-red-400 bg-red-500/10 border border-red-500/20 hover:bg-red-500/20 transition-colors"
                                    >
                                        Delete
                                    </button>
                                    <button
                                        onClick={handleSave}
                                        disabled={saving}
                                        className="px-3 py-1 rounded text-[10px] font-medium text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 hover:bg-emerald-500/20 transition-colors disabled:opacity-40"
                                    >
                                        {saving ? 'Saving…' : 'Save'}
                                    </button>
                                </div>
                            </div>

                            {/* Textarea */}
                            <textarea
                                value={content}
                                onChange={e => setContent(e.target.value)}
                                className="flex-1 w-full bg-transparent p-5 text-sm text-white/80 font-mono leading-relaxed resize-none focus:outline-none"
                                placeholder="Write your notes here…"
                                spellCheck={false}
                            />
                        </>
                    ) : (
                        <div className="flex-1 flex items-center justify-center">
                            <div className="text-center">
                                <span className="text-3xl block mb-3">📝</span>
                                <p className="text-sm text-white/40">Select a file or create a new one</p>
                            </div>
                        </div>
                    )}
                </main>
            </div>

            <Toast message={toast.message} visible={toast.visible} />
        </div>
    )
}
