import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import Header from '../components/Header'
import type { ProjectItem } from '../types/dashboard'

// ─── Types ───────────────────────────────────────────────────────────────────
type ListItem = Record<string, unknown>

// ─── Main ────────────────────────────────────────────────────────────────────
export default function ProjectPage() {
    const { id } = useParams<{ id: string }>()
    const navigate = useNavigate()

    const [project, setProject] = useState<ProjectItem | null>(null)
    const [items, setItems] = useState<ListItem[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        if (!id) return
        let cancelled = false

        ;(async () => {
            try {
                const r = await fetch('/api/projects')
                if (!r.ok) throw new Error('projects API failed')
                const data: { projects: ProjectItem[] } = await r.json()
                const found = data.projects.find(p => p.id === id) ?? null
                if (cancelled) return
                setProject(found)

                if (!found) { setLoading(false); return }

                const r2 = await fetch(found.listApi)
                if (!r2.ok) throw new Error(`listApi (${found.listApi}) returned ${r2.status}`)
                const list: unknown = await r2.json()
                if (cancelled) return
                setItems(Array.isArray(list) ? (list as ListItem[]) : [])
            } catch (e) {
                if (!cancelled) setError(e instanceof Error ? e.message : 'Unknown error')
            } finally {
                if (!cancelled) setLoading(false)
            }
        })()

        return () => { cancelled = true }
    }, [id])

    return (
        <div className="min-h-screen pb-12">
            <Header apiOnline={true} />

            <main className="w-full px-4 py-8 max-w-4xl mx-auto space-y-6">
                {/* Breadcrumb */}
                <div className="flex items-center gap-2 text-xs">
                    <button
                        onClick={() => navigate('/')}
                        className="text-white/40 hover:text-white/80 transition-colors"
                    >
                        ← Dashboard
                    </button>
                    <span className="text-white/20">/</span>
                    <span className="text-white/50">{project?.label ?? id}</span>
                </div>

                {/* Content Panel */}
                <div className="glass-section p-6 space-y-4">
                    {/* Header */}
                    <div className="flex items-center gap-3 flex-wrap">
                        <span className="text-lg">🗂️</span>
                        <h1 className="text-base font-semibold text-white/90">{project?.label ?? id}</h1>
                        {project && (
                            <span className="badge badge-info ml-auto">{project.listApi}</span>
                        )}
                    </div>

                    {project && (
                        <p className="text-[10px] text-white/25 font-mono">id: {project.id}</p>
                    )}

                    {/* States */}
                    {loading && (
                        <p className="text-xs text-white/30 animate-pulse">Loading…</p>
                    )}
                    {error && (
                        <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</p>
                    )}
                    {!loading && !error && !project && (
                        <p className="text-xs text-amber-400">Project "{id}" not found in registry.</p>
                    )}
                    {!loading && !error && project && items.length === 0 && (
                        <p className="text-xs text-white/30">No items returned from {project.listApi}.</p>
                    )}

                    {/* List */}
                    {!loading && items.length > 0 && (
                        <ul className="space-y-1.5">
                            {items.map((item, i) => {
                                const title = String(item.title ?? item.label ?? item.id ?? `Item ${i + 1}`)
                                const sub = String(item.timeHHMM ?? item.published_at ?? item.category ?? item.mtimeISO ?? '')
                                return (
                                    <li
                                        key={i}
                                        className="flex items-center justify-between px-3 py-2 rounded-lg bg-white/[0.03] border border-white/[0.06] hover:border-white/[0.12] transition-colors"
                                    >
                                        <span className="text-xs text-white/80 truncate flex-1">{title}</span>
                                        {sub && <span className="text-[10px] text-white/30 ml-3 shrink-0">{sub}</span>}
                                    </li>
                                )
                            })}
                        </ul>
                    )}
                </div>
            </main>
        </div>
    )
}
