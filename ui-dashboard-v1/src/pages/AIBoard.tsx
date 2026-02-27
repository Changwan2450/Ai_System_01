import { useCallback, useEffect, useState } from 'react'
import Header from '../components/Header'

// ─── Types ───────────────────────────────────────────────────────────────────
interface InsiderPost {
    id: string
    mdFile: string
    title: string
    score_total: number | null
    tags: string[]
    published_at: string
    timeHHMM: string
}

interface InsiderStatus {
    last_run: string | null
    last_publish: string | null
    paused: boolean
    postsCount: number
    candidatesCount: number
}

interface PostSource {
    name: string
    url?: string | null
    date?: string
}

interface PostArtifacts {
    snippets?: string[]
    checklist?: string[]
    templates?: string[]
    commands?: string[]
}

interface PostMeta {
    title?: string
    score_total?: number
    tags?: string[]
    shorts_script?: string
    checklist?: string[]
    source?: PostSource
    source_url?: string   // legacy
    source_site?: string  // legacy
    level?: 'beginner' | 'intermediate' | 'advanced'
    topic?: string
    apply_to?: string[]
    artifacts?: PostArtifacts
}

interface PreviewData {
    html: string
    meta: PostMeta | null
}

interface SourceEntry {
    name: string
    count: number
    url: string | null
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function timeAgo(iso: string | null): string {
    if (!iso) return 'Never'
    const diff = Date.now() - new Date(iso).getTime()
    const mins = Math.floor(diff / 60000)
    if (mins < 1) return 'Just now'
    if (mins < 60) return `${mins}m ago`
    const hrs = Math.floor(mins / 60)
    if (hrs < 24) return `${hrs}h ago`
    return `${Math.floor(hrs / 24)}d ago`
}

function postSlug(post: InsiderPost): string {
    return post.mdFile.replace(/\.md$/i, '').replace(/[^a-zA-Z0-9가-힣-]/g, '-')
}

function showToast(msg: string) {
    const el = document.createElement('div')
    el.textContent = msg
    Object.assign(el.style, {
        position: 'fixed', bottom: '24px', left: '50%', transform: 'translateX(-50%)',
        padding: '8px 20px', borderRadius: '8px', fontSize: '13px', fontWeight: '600',
        background: 'rgba(34,211,238,0.15)', border: '1px solid rgba(34,211,238,0.3)',
        color: '#22d3ee', backdropFilter: 'blur(12px)', zIndex: '9999',
        transition: 'opacity 0.4s', opacity: '1',
    })
    document.body.appendChild(el)
    setTimeout(() => { el.style.opacity = '0' }, 1600)
    setTimeout(() => el.remove(), 2100)
}

async function sharePost(post: InsiderPost) {
    const url = `${window.location.origin}/ai-board?post=${encodeURIComponent(postSlug(post))}`
    if (navigator.share) {
        try { await navigator.share({ title: post.title, text: `AI Insider – ${post.title}`, url }); return }
        catch { /* cancelled */ }
    }
    try { await navigator.clipboard.writeText(url); showToast('🔗 Copied!') }
    catch {
        const ta = document.createElement('textarea')
        ta.value = url; document.body.appendChild(ta); ta.select()
        document.execCommand('copy'); document.body.removeChild(ta)
        showToast('🔗 Copied!')
    }
}

// ── Badge helpers ─────────────────────────────────────────────────────────────
const LEVEL_STYLE: Record<string, string> = {
    beginner: 'bg-emerald-500/15 border-emerald-500/25 text-emerald-400',
    intermediate: 'bg-cyan-500/15 border-cyan-500/25 text-cyan-400',
    advanced: 'bg-purple-500/15 border-purple-500/25 text-purple-400',
}
const TOPIC_STYLE: Record<string, string> = {
    automation: 'bg-amber-500/15 border-amber-500/25 text-amber-400',
    prompt: 'bg-blue-500/15 border-blue-500/25 text-blue-400',
    'md-workflow': 'bg-pink-500/15 border-pink-500/25 text-pink-400',
    tooling: 'bg-slate-500/15 border-slate-500/25 text-slate-400',
    'context-engineering': 'bg-violet-500/15 border-violet-500/25 text-violet-400',
    'repo-template': 'bg-orange-500/15 border-orange-500/25 text-orange-400',
}

function hasArtifactContent(a?: PostArtifacts): boolean {
    if (!a) return false
    return (a.snippets?.length ?? 0) > 0 || (a.commands?.length ?? 0) > 0 || (a.checklist?.length ?? 0) > 0
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function AIBoard() {
    const [posts, setPosts] = useState<InsiderPost[]>([])
    const [status, setStatus] = useState<InsiderStatus | null>(null)
    const [activeId, setActiveId] = useState<string | null>(null)
    const [preview, setPreview] = useState<PreviewData | null>(null)
    const [previewLoading, setPreviewLoading] = useState(false)
    const [loading, setLoading] = useState(true)
    const [running, setRunning] = useState(false)

    // Panels
    const [shortsOpen, setShortsOpen] = useState(false)
    const [sourceOpen, setSourceOpen] = useState(false)
    const [allSourcesOpen, setAllSourcesOpen] = useState(false)
    const [artifactsOpen, setArtifactsOpen] = useState(false)
    const [applyToOpen, setApplyToOpen] = useState(false)
    const [allSources, setAllSources] = useState<SourceEntry[]>([])
    const [sourcesLoading, setSourcesLoading] = useState(false)

    const resetPanels = () => {
        setShortsOpen(false); setSourceOpen(false); setAllSourcesOpen(false)
        setArtifactsOpen(false); setApplyToOpen(false)
    }

    // ── Fetch status ──
    const fetchStatus = useCallback(async () => {
        try {
            const r = await fetch('/api/insider/status')
            if (r.ok) setStatus(await r.json())
        } catch { /* offline */ }
    }, [])

    // ── Load preview ──
    const loadPreview = async (mdFile: string, id: string) => {
        setActiveId(id); setPreviewLoading(true); resetPanels()
        try {
            const r = await fetch(`/api/insider/preview?file=${encodeURIComponent(mdFile)}`)
            if (!r.ok) throw new Error()
            setPreview(await r.json())
        } catch { setPreview(null) }
        finally { setPreviewLoading(false) }
    }

    // ── Fetch posts ──
    const fetchPosts = useCallback(async () => {
        setLoading(true)
        try {
            const r = await fetch('/api/insider/list')
            if (!r.ok) throw new Error()
            const data: InsiderPost[] = await r.json()
            setPosts(data)
            const params = new URLSearchParams(window.location.search)
            const postParam = params.get('post')
            if (postParam) {
                const match = data.find(p => postSlug(p) === postParam)
                if (match) { loadPreview(match.mdFile, match.id); return }
            }
            if (data.length > 0) loadPreview(data[0].mdFile, data[0].id)
        } catch { setPosts([]) }
        finally { setLoading(false) }
    }, [])

    // ── Fetch all sources ──
    const fetchAllSources = useCallback(async () => {
        setSourcesLoading(true)
        try {
            const r = await fetch('/api/insider/sources')
            if (r.ok) { const d: { sources: SourceEntry[] } = await r.json(); setAllSources(d.sources ?? []) }
        } catch { /* offline */ }
        finally { setSourcesLoading(false) }
    }, [])

    // ── Run pipeline ──
    const handleRun = async () => {
        setRunning(true)
        try {
            await fetch('/api/insider/run', { method: 'POST' })
            setTimeout(() => { fetchStatus(); fetchPosts() }, 3000)
        } catch { /* silent */ }
        finally { setTimeout(() => setRunning(false), 3000) }
    }

    const openInNewTab = (mdFile: string) => {
        window.open(`/api/insider/view?file=${encodeURIComponent(mdFile)}`, '_blank')
    }

    useEffect(() => { fetchStatus(); fetchPosts() }, [fetchStatus, fetchPosts])

    // ── Derived ──
    const activePost = posts.find(p => p.id === activeId)
    const meta = preview?.meta ?? null

    // Source: new structure OR legacy fallback
    const resolvedSource: PostSource | null = meta?.source ?? (
        (meta?.source_url || meta?.source_site)
            ? { name: meta?.source_site || 'Source', url: meta?.source_url ?? null }
            : null
    )
    const sourceHasUrl = !!(resolvedSource?.url && !resolvedSource.url.includes('example.com'))

    const hasShorts = !!(meta?.shorts_script)
    const hasSource = !!resolvedSource
    const hasApplyTo = (meta?.apply_to?.length ?? 0) > 0
    const hasArtifacts = hasArtifactContent(meta?.artifacts)

    const statusBadge = status?.paused
        ? { label: 'PAUSED', cls: 'bg-amber-500/15 border-amber-500/25 text-amber-400' }
        : { label: 'ACTIVE', cls: 'bg-emerald-500/15 border-emerald-500/25 text-emerald-400' }

    return (
        <div className="min-h-screen flex flex-col">
            <Header apiOnline />

            {/* ── Global toolbar ── */}
            <div className="px-4 py-2.5 border-b border-white/[0.08] flex items-center justify-between bg-white/[0.015]">
                <div className="flex items-center gap-3">
                    <span className="text-base">🧠</span>
                    <span className="text-sm font-semibold text-white/80">AI Insider</span>
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${statusBadge.cls}`}>
                        {statusBadge.label}
                    </span>
                    {status && (
                        <>
                            <span className="text-[10px] text-white/25">
                                {status.postsCount} posts · {status.candidatesCount} candidates
                            </span>
                            <span className="text-[10px] text-white/20">
                                Last run: {timeAgo(status.last_run)}
                            </span>
                        </>
                    )}
                </div>
                <button
                    onClick={handleRun} disabled={running}
                    className="px-3 py-1 rounded text-[10px] font-medium text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 hover:bg-emerald-500/20 transition-colors disabled:opacity-40"
                >
                    {running ? 'Running…' : '▶ Run Pipeline'}
                </button>
            </div>

            {/* ── 2-column layout ── */}
            <div className="flex flex-1 overflow-hidden">

                {/* Left: posts list */}
                <aside className="w-[300px] shrink-0 border-r border-white/[0.08] flex flex-col bg-white/[0.015]">
                    <div className="px-4 py-3 border-b border-white/[0.08]">
                        <h2 className="text-xs font-semibold text-white/60 uppercase tracking-wider">Posts</h2>
                    </div>
                    <div className="flex-1 overflow-y-auto">
                        {loading && <p className="px-4 py-6 text-xs text-white/30 text-center">Loading…</p>}
                        {!loading && posts.length === 0 && (
                            <div className="px-4 py-8 text-center">
                                <span className="text-2xl block mb-2">📭</span>
                                <p className="text-xs text-white/30">No posts yet.</p>
                                <p className="text-[10px] text-white/20 mt-1">Run the pipeline to generate content.</p>
                            </div>
                        )}
                        {posts.map(p => (
                            <button
                                key={p.id}
                                onClick={() => loadPreview(p.mdFile, p.id)}
                                className={`w-full text-left px-4 py-3 border-b border-white/[0.04] transition-colors ${activeId === p.id
                                    ? 'bg-cyan-500/10 border-l-2 border-l-cyan-400'
                                    : 'hover:bg-white/5 border-l-2 border-l-transparent'
                                    }`}
                            >
                                <p className={`text-xs font-medium leading-snug ${activeId === p.id ? 'text-cyan-400' : 'text-white/70'}`}>
                                    {p.title}
                                </p>
                                <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                                    {p.score_total !== null && (
                                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-400 border border-purple-500/20 font-semibold">
                                            {p.score_total}pt
                                        </span>
                                    )}
                                    {p.tags.slice(0, 2).map(t => (
                                        <span key={t} className="text-[9px] text-white/25">#{t}</span>
                                    ))}
                                    <span className="text-[9px] text-white/20 ml-auto">{p.timeHHMM}</span>
                                </div>
                            </button>
                        ))}
                    </div>
                </aside>

                {/* Right: preview panel */}
                <main className="flex-1 flex flex-col overflow-hidden">
                    {activeId && preview ? (
                        <>
                            {/* Preview toolbar */}
                            <div className="px-4 py-2 border-b border-white/[0.08] flex items-center justify-between bg-white/[0.015] gap-2">
                                {/* Left: title + badges */}
                                <div className="flex items-center gap-2 min-w-0 flex-wrap">
                                    <span className="text-xs font-medium text-white/70 truncate max-w-[240px]">
                                        {activePost?.title || activeId}
                                    </span>
                                    {meta?.score_total != null && (
                                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-400 border border-purple-500/20 font-semibold shrink-0">
                                            {meta.score_total}pt
                                        </span>
                                    )}
                                    {meta?.level && (
                                        <span className={`text-[9px] px-1.5 py-0.5 rounded border font-semibold uppercase shrink-0 ${LEVEL_STYLE[meta.level] ?? 'bg-white/10 border-white/20 text-white/50'}`}>
                                            {meta.level}
                                        </span>
                                    )}
                                    {meta?.topic && (
                                        <span className={`text-[9px] px-1.5 py-0.5 rounded border font-semibold uppercase shrink-0 ${TOPIC_STYLE[meta.topic] ?? 'bg-white/10 border-white/20 text-white/50'}`}>
                                            {meta.topic}
                                        </span>
                                    )}
                                </div>

                                {/* Right: action buttons */}
                                <div className="flex items-center gap-1 shrink-0 flex-wrap justify-end">
                                    {activePost && (
                                        <button onClick={() => sharePost(activePost)}
                                            className="px-2 py-1 rounded text-[10px] font-medium text-white/50 bg-white/5 border border-white/[0.08] hover:bg-white/10 hover:text-white/80 transition-colors">
                                            Share
                                        </button>
                                    )}
                                    {hasShorts && (
                                        <button onClick={() => setShortsOpen(o => !o)}
                                            className={`px-2 py-1 rounded text-[10px] font-medium border transition-colors ${shortsOpen
                                                ? 'text-amber-300 bg-amber-500/15 border-amber-500/25'
                                                : 'text-white/50 bg-white/5 border-white/[0.08] hover:bg-amber-500/10 hover:text-amber-300 hover:border-amber-500/20'
                                                }`}>
                                            🎬 Shorts
                                        </button>
                                    )}
                                    {hasSource && (
                                        <button onClick={() => setSourceOpen(o => !o)}
                                            disabled={!sourceHasUrl && !resolvedSource?.name}
                                            className={`px-2 py-1 rounded text-[10px] font-medium border transition-colors ${sourceOpen
                                                ? 'text-cyan-300 bg-cyan-500/15 border-cyan-500/25'
                                                : sourceHasUrl
                                                    ? 'text-white/50 bg-white/5 border-white/[0.08] hover:bg-cyan-500/10 hover:text-cyan-300 hover:border-cyan-500/20'
                                                    : 'text-white/20 bg-white/5 border-white/[0.05] cursor-not-allowed'
                                                }`}>
                                            🔗 Source{!sourceHasUrl && resolvedSource ? ' (no link)' : ''}
                                        </button>
                                    )}
                                    {hasArtifacts && (
                                        <button onClick={() => setArtifactsOpen(o => !o)}
                                            className={`px-2 py-1 rounded text-[10px] font-medium border transition-colors ${artifactsOpen
                                                ? 'text-emerald-300 bg-emerald-500/15 border-emerald-500/25'
                                                : 'text-white/50 bg-white/5 border-white/[0.08] hover:bg-emerald-500/10 hover:text-emerald-300 hover:border-emerald-500/20'
                                                }`}>
                                            📦 Artifacts
                                        </button>
                                    )}
                                    {hasApplyTo && (
                                        <button onClick={() => setApplyToOpen(o => !o)}
                                            className={`px-2 py-1 rounded text-[10px] font-medium border transition-colors ${applyToOpen
                                                ? 'text-violet-300 bg-violet-500/15 border-violet-500/25'
                                                : 'text-white/50 bg-white/5 border-white/[0.08] hover:bg-violet-500/10 hover:text-violet-300 hover:border-violet-500/20'
                                                }`}>
                                            🧠 Apply To
                                        </button>
                                    )}
                                    <button onClick={() => { if (activePost) openInNewTab(activePost.mdFile) }}
                                        className="px-2 py-1 rounded text-[10px] font-medium text-cyan-400 bg-cyan-500/10 border border-cyan-500/20 hover:bg-cyan-500/20 transition-colors">
                                        New tab ↗
                                    </button>
                                </div>
                            </div>

                            {/* ── Collapsible panels ── */}

                            {/* Source panel */}
                            {sourceOpen && resolvedSource && (
                                <div className="px-4 py-3 border-b border-white/[0.06] bg-white/[0.02]">
                                    <div className="flex items-start justify-between gap-4">
                                        <div className="space-y-0.5 min-w-0">
                                            <p className="text-xs font-medium text-white/75">{resolvedSource.name}</p>
                                            {resolvedSource.date && <p className="text-[10px] text-white/30">{resolvedSource.date}</p>}
                                            {!sourceHasUrl && <p className="text-[10px] text-white/20 italic">원문 링크 없음 (mock data)</p>}
                                        </div>
                                        <div className="flex items-center gap-2 shrink-0">
                                            {sourceHasUrl && resolvedSource.url && (
                                                <a href={resolvedSource.url} target="_blank" rel="noopener noreferrer"
                                                    className="text-[10px] text-cyan-400 hover:text-cyan-300 transition-colors">
                                                    Open Source ↗
                                                </a>
                                            )}
                                            <button
                                                onClick={() => { if (!allSourcesOpen) fetchAllSources(); setAllSourcesOpen(o => !o) }}
                                                className="text-[10px] text-white/30 hover:text-white/60 border border-white/[0.08] rounded px-2 py-0.5 transition-colors">
                                                All Sources {allSourcesOpen ? '▾' : '▸'}
                                            </button>
                                        </div>
                                    </div>
                                    {/* All Sources */}
                                    {allSourcesOpen && (
                                        <div className="mt-3 pt-3 border-t border-white/[0.06]">
                                            {sourcesLoading ? (
                                                <p className="text-[10px] text-white/30">Loading…</p>
                                            ) : allSources.length === 0 ? (
                                                <p className="text-[10px] text-white/30">No sources found.</p>
                                            ) : (
                                                <div className="flex flex-wrap gap-1.5">
                                                    {allSources.map(s => (
                                                        <div key={s.name}
                                                            className="flex items-center gap-1.5 px-2 py-1 rounded bg-white/[0.04] border border-white/[0.07]">
                                                            {s.url ? (
                                                                <a href={s.url} target="_blank" rel="noopener noreferrer"
                                                                    className="text-[10px] text-white/60 hover:text-cyan-400 transition-colors">
                                                                    {s.name}
                                                                </a>
                                                            ) : (
                                                                <span className="text-[10px] text-white/50">{s.name}</span>
                                                            )}
                                                            <span className="text-[9px] text-white/25 font-mono">{s.count}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Shorts panel */}
                            {shortsOpen && meta?.shorts_script && (
                                <div className="px-4 py-3 border-b border-white/[0.06] bg-amber-500/[0.03]">
                                    <p className="text-[9px] text-amber-400/60 uppercase font-semibold tracking-wider mb-2">🎬 Shorts Script</p>
                                    <pre className="text-xs text-white/60 whitespace-pre-wrap leading-relaxed font-mono">
                                        {meta.shorts_script}
                                    </pre>
                                </div>
                            )}

                            {/* Artifacts panel */}
                            {artifactsOpen && meta?.artifacts && (
                                <div className="px-4 py-3 border-b border-white/[0.06] bg-emerald-500/[0.03] space-y-3">
                                    <p className="text-[9px] text-emerald-400/60 uppercase font-semibold tracking-wider">📦 Artifacts</p>
                                    {(meta.artifacts.commands?.length ?? 0) > 0 && (
                                        <div>
                                            <p className="text-[9px] text-white/30 mb-1.5 font-mono">COMMANDS</p>
                                            <div className="space-y-1">
                                                {meta.artifacts.commands!.map((cmd, i) => (
                                                    <div key={i} className="flex items-center gap-2 px-3 py-1.5 rounded bg-white/[0.04] border border-white/[0.06] font-mono text-[11px] text-emerald-300">
                                                        <span className="text-white/20 select-none">$</span>
                                                        <span className="flex-1 truncate">{cmd}</span>
                                                        <button onClick={() => { navigator.clipboard.writeText(cmd).catch(() => {}); showToast('Copied!') }}
                                                            className="text-[9px] text-white/20 hover:text-white/60 transition-colors shrink-0">copy</button>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                    {(meta.artifacts.checklist?.length ?? 0) > 0 && (
                                        <div>
                                            <p className="text-[9px] text-white/30 mb-1.5 font-mono">CHECKLIST</p>
                                            {meta.artifacts.checklist!.map((item, i) => (
                                                <div key={i} className="flex items-start gap-2 text-xs text-white/60 mb-1">
                                                    <span className="text-emerald-400 mt-0.5 shrink-0">✓</span>
                                                    <span>{item}</span>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                    {(meta.artifacts.snippets?.length ?? 0) > 0 && (
                                        <p className="text-[10px] text-white/30">{meta.artifacts.snippets!.length} code snippet(s) — open "New tab ↗" for full view</p>
                                    )}
                                </div>
                            )}

                            {/* Apply To panel */}
                            {applyToOpen && (meta?.apply_to?.length ?? 0) > 0 && (
                                <div className="px-4 py-3 border-b border-white/[0.06] bg-violet-500/[0.03]">
                                    <p className="text-[9px] text-violet-400/60 uppercase font-semibold tracking-wider mb-2">🧠 Apply To</p>
                                    <div className="flex flex-wrap gap-2">
                                        {meta!.apply_to!.map((item, i) => (
                                            <span key={i}
                                                className="text-[11px] px-2.5 py-1 rounded-full bg-white/[0.05] border border-white/[0.09] text-white/60">
                                                {item}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* HTML content */}
                            {previewLoading ? (
                                <div className="flex-1 flex items-center justify-center">
                                    <div className="w-6 h-6 border-2 border-cyan-400/30 border-t-cyan-400 rounded-full animate-spin" />
                                </div>
                            ) : (
                                <div className="flex-1 overflow-y-auto p-6">
                                    {/* MD 본문만 렌더 */}
                                    <div className="prose-insider" dangerouslySetInnerHTML={{ __html: preview.html }} />
                                    {/* Tags */}
                                    {meta?.tags && meta.tags.length > 0 && (
                                        <div className="mt-8 flex flex-wrap gap-2">
                                            {meta.tags.map(t => (
                                                <span key={t} className="text-[10px] px-2 py-0.5 rounded-full bg-white/5 border border-white/[0.08] text-white/40">
                                                    #{t}
                                                </span>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}
                        </>
                    ) : (
                        <div className="flex-1 flex items-center justify-center">
                            <div className="text-center">
                                <span className="text-3xl block mb-3">🧠</span>
                                <p className="text-sm text-white/40">Select a post to preview</p>
                            </div>
                        </div>
                    )}
                </main>
            </div>
        </div>
    )
}
