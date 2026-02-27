import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import { MOCK_VIDEOS, MOCK_DOCUMENTS } from '../data/mockData'
import type { VideoItem, ProjectItem } from '../types/dashboard'
import type { ReportItem } from '../components/widgets/TodayDocuments'
import Header from '../components/Header'
import RecentVideos from '../components/widgets/RecentVideos'
import TodayDocuments from '../components/widgets/TodayDocuments'

// ─── Animation variants ──────────────────────────────────────────────────────
const stagger = {
    hidden: {},
    show: { transition: { staggerChildren: 0.09, delayChildren: 0.12 } },
}
const fadeUp = {
    hidden: { opacity: 0, y: 22 },
    show: { opacity: 1, y: 0, transition: { type: 'spring' as const, stiffness: 280, damping: 26 } },
}
const fadeUpReduced = {
    hidden: { opacity: 0 },
    show: { opacity: 1, transition: { duration: 0.3 } },
}

// ─── Modal ───────────────────────────────────────────────────────────────────
function ModalOverlay({ open, onClose, title, children }: {
    open: boolean; onClose: () => void; title: string; children: React.ReactNode
}) {
    return (
        <AnimatePresence>
            {open && (
                <motion.div className="fixed inset-0 z-[100] flex items-center justify-center"
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
                    <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
                    <motion.div className="relative z-10 w-full max-w-lg mx-4 rounded-xl border border-white/10 bg-[#141821] p-6 shadow-2xl"
                        initial={{ scale: 0.95, y: 10 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, y: 10 }} transition={{ duration: 0.18 }}>
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-sm font-semibold text-white/90">{title}</h3>
                            <button onClick={onClose} className="text-white/30 hover:text-white/70 transition-colors text-lg leading-none">✕</button>
                        </div>
                        {children}
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    )
}

// ─── Toast ───────────────────────────────────────────────────────────────────
function Toast({ message, visible }: { message: string; visible: boolean }) {
    return (
        <AnimatePresence>
            {visible && (
                <motion.div className="fixed bottom-6 right-6 z-[110] px-4 py-2.5 rounded-lg text-xs font-medium text-white/90 bg-emerald-600/90 border border-emerald-400/30 shadow-lg"
                    initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }}>
                    {message}
                </motion.div>
            )}
        </AnimatePresence>
    )
}

// ─── Types ───────────────────────────────────────────────────────────────────
interface VideoSummary {
    queueSize: number; failed: number; recent: VideoItem[]
    paths: { outputDir: string; videosDir: string; failedDirs: string[] }
}
interface InsiderStatus {
    postsCount: number; paused: boolean; last_run: string | null
}

// ─── Main ────────────────────────────────────────────────────────────────────
export default function Dashboard() {
    const navigate = useNavigate()
    const shouldReduceMotion = useReducedMotion()
    const aFU = shouldReduceMotion ? fadeUpReduced : fadeUp

    const [summary, setSummary] = useState<VideoSummary | null>(null)
    const [apiOnline, setApiOnline] = useState(false)
    const [reports, setReports] = useState<ReportItem[]>([])
    const [reportsLoading, setReportsLoading] = useState(true)
    const [insiderStatus, setInsiderStatus] = useState<InsiderStatus | null>(null)

    const [projects, setProjects] = useState<ProjectItem[]>([])

    const [folderModal, setFolderModal] = useState(false)
    const [toast, setToast] = useState({ visible: false, message: '' })
    const [cleaning, setCleaning] = useState(false)

    const showToast = useCallback((msg: string) => {
        setToast({ visible: true, message: msg })
        setTimeout(() => setToast({ visible: false, message: '' }), 2500)
    }, [])

    const fetchSummary = useCallback(async () => {
        try {
            const r = await fetch('/api/videos/summary')
            if (!r.ok) throw new Error()
            setSummary(await r.json())
            setApiOnline(true)
        } catch { setApiOnline(false) }
    }, [])

    const fetchReports = useCallback(async () => {
        setReportsLoading(true)
        try {
            const r = await fetch('/api/reports/today')
            if (!r.ok) throw new Error()
            setReports(await r.json())
        } catch { setReports([]) }
        finally { setReportsLoading(false) }
    }, [])

    const fetchInsiderStatus = useCallback(async () => {
        try {
            const r = await fetch('/api/insider/status')
            if (r.ok) setInsiderStatus(await r.json())
        } catch { /* offline */ }
    }, [])

    const fetchProjects = useCallback(async () => {
        try {
            const r = await fetch('/api/projects')
            if (!r.ok) throw new Error()
            const data: { projects: ProjectItem[] } = await r.json()
            setProjects(data.projects ?? [])
        } catch { setProjects([]) }
    }, [])

    useEffect(() => { fetchSummary(); fetchReports(); fetchInsiderStatus(); fetchProjects() }, [fetchSummary, fetchReports, fetchInsiderStatus, fetchProjects])

    const handleCleanFailed = async () => {
        setCleaning(true)
        try {
            const d = await (await fetch('/api/videos/clean-failed', { method: 'POST' })).json()
            showToast(`Cleaned ${d.deleted} failed file(s)`)
            await fetchSummary()
        } catch { showToast('Clean failed') }
        finally { setCleaning(false) }
    }

    const handleCopyPath = async (p: string) => {
        try { await navigator.clipboard.writeText(p); showToast('Path copied!') }
        catch { showToast('Copy failed') }
    }

    const handleOpenReport = (filePath: string) => {
        const fileName = filePath.split('/').pop() || ''
        window.open(`/api/reports/view?file=${encodeURIComponent(fileName)}`, '_blank')
    }

    const queueSize = summary?.queueSize ?? 0
    const failedCount = summary?.failed ?? 0
    const videosDir = summary?.paths?.videosDir ?? '/Users/changwan2450/Antigravity WorkSpace/AI_SYSTEM/naon.py/output'
    const recentVideos: VideoItem[] = (summary?.recent?.length) ? summary.recent : MOCK_VIDEOS

    return (
        <div className="min-h-screen pb-12">
            <Header apiOnline={apiOnline} />

            <main className="w-full px-4 py-8 space-y-6">
                {/* Top 3 Cards */}
                <motion.div variants={stagger} initial="hidden" animate="show" className="grid grid-cols-1 md:grid-cols-3 gap-6">

                    {/* Card A: Work Queue */}
                    <motion.div variants={aFU} className="glass-panel p-5 h-full flex flex-col justify-between">
                        <div>
                            <div className="flex items-center gap-2 mb-3">
                                <span className="text-lg">🎬</span>
                                <h3 className="text-sm font-semibold text-white/90">Work Queue (Videos)</h3>
                                {apiOnline && <span className="ml-auto text-[9px] text-emerald-400/60 font-mono">LIVE</span>}
                            </div>
                            <div className="flex gap-4 mb-4">
                                <div><p className="text-xs text-white/40 mb-1">Queue Size</p><p className="text-2xl font-bold text-cyan-400">{queueSize}</p></div>
                                <div><p className="text-xs text-white/40 mb-1">Failed</p><p className="text-2xl font-bold text-red-400">{failedCount}</p></div>
                            </div>
                        </div>
                        <div className="flex gap-2 mt-auto">
                            <button onClick={() => setFolderModal(true)} className="flex-1 bg-white/5 hover:bg-white/10 border border-white/10 rounded-md py-1.5 text-xs font-medium text-white/70 transition-colors">Open Folder</button>
                            <button onClick={handleCleanFailed} disabled={cleaning || failedCount === 0} className="flex-1 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 rounded-md py-1.5 text-xs font-medium text-red-400 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">{cleaning ? 'Cleaning…' : 'Clean Failed'}</button>
                        </div>
                    </motion.div>

                    {/* Card B: Daily Notes */}
                    <motion.div variants={aFU} className="glass-panel p-5 h-full flex flex-col justify-between">
                        <div>
                            <div className="flex items-center gap-2 mb-3">
                                <span className="text-lg">📝</span>
                                <h3 className="text-sm font-semibold text-white/90">Daily Notes</h3>
                            </div>
                            <p className="text-xs text-white/50 leading-relaxed mb-4">
                                Create, edit, and manage daily markdown notes. Full CRUD with file browser.
                            </p>
                        </div>
                        <div className="mt-auto">
                            <button onClick={() => navigate('/daily')} className="w-full bg-purple-500/10 hover:bg-purple-500/20 border border-purple-500/20 rounded-md py-1.5 text-xs font-medium text-purple-400 transition-colors flex items-center justify-center gap-1.5">
                                Open Daily Notes
                                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M1 9L9 1M9 1H3.5M9 1V6.5" /></svg>
                            </button>
                        </div>
                    </motion.div>

                    {/* Card C: AI Insider */}
                    <motion.div variants={aFU} className="glass-panel p-5 h-full flex flex-col justify-between">
                        <div>
                            <div className="flex items-center gap-2 mb-3">
                                <span className="text-lg">🧠</span>
                                <h3 className="text-sm font-semibold text-white/90">AI Insider</h3>
                                {insiderStatus && (
                                    <span className={`ml-auto text-[9px] font-mono ${insiderStatus.paused ? 'text-amber-400/60' : 'text-emerald-400/60'}`}>
                                        {insiderStatus.paused ? 'PAUSED' : 'ACTIVE'}
                                    </span>
                                )}
                            </div>
                            <p className="text-xs text-white/50 leading-relaxed mb-2">
                                Vibe Coding tips, tool reviews, and workflow insights — auto-crawled & scored.
                            </p>
                            {insiderStatus && (
                                <p className="text-[10px] text-white/25">
                                    {insiderStatus.postsCount} posts · Last run: {insiderStatus.last_run ? new Date(insiderStatus.last_run).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }) : 'Never'}
                                </p>
                            )}
                        </div>
                        <div className="mt-auto">
                            <button onClick={() => navigate('/ai-board')} className="w-full bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/20 rounded-md py-1.5 text-xs font-medium text-cyan-400 transition-colors flex items-center justify-center gap-1.5">
                                Open AI Insider
                                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M1 9L9 1M9 1H3.5M9 1V6.5" /></svg>
                            </button>
                        </div>
                    </motion.div>
                </motion.div>

                {/* Recent Videos */}
                <motion.div initial="hidden" animate="show" variants={aFU} transition={{ delay: 0.1 }}>
                    <RecentVideos videos={recentVideos} />
                </motion.div>

                {/* Today Documents */}
                <motion.div initial="hidden" animate="show" variants={aFU} transition={{ delay: 0.2 }}>
                    <TodayDocuments documents={MOCK_DOCUMENTS} reports={reports} loading={reportsLoading} onOpenReport={handleOpenReport} />
                </motion.div>

                {/* Projects Hub */}
                <motion.div initial="hidden" animate="show" variants={aFU} transition={{ delay: 0.3 }}>
                    <div className="glass-section p-6">
                        <div className="flex items-center gap-2 mb-4">
                            <span className="text-lg">🗂️</span>
                            <h2 className="text-sm font-semibold text-white/90">Projects Hub</h2>
                            <span className="ml-auto text-[9px] font-mono text-white/30">{projects.length} projects</span>
                        </div>
                        {projects.length === 0 ? (
                            <p className="text-xs text-white/30">No projects registered.</p>
                        ) : (
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                {projects.map(p => (
                                    <button
                                        key={p.id}
                                        onClick={() => navigate(`/project/${p.id}`)}
                                        className="text-left flex flex-col gap-2 p-4 rounded-xl border border-white/[0.08] bg-white/[0.03] hover:border-white/[0.18] hover:bg-white/[0.06] transition-all group"
                                    >
                                        <div className="flex items-start justify-between gap-2">
                                            <span className="text-sm font-semibold text-white/90 group-hover:text-white transition-colors">{p.label}</span>
                                            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" className="text-white/30 group-hover:text-cyan-400 transition-colors mt-0.5 shrink-0"><path d="M1 9L9 1M9 1H3.5M9 1V6.5" /></svg>
                                        </div>
                                        <span className="text-[10px] text-white/30 font-mono">{p.id}</span>
                                        <span className="badge badge-info mt-auto self-start">{p.listApi}</span>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                </motion.div>
            </main>

            {/* Folder Path Modal */}
            <ModalOverlay open={folderModal} onClose={() => setFolderModal(false)} title="📁 Video Output Folder">
                <div className="space-y-3">
                    <div className="bg-white/5 rounded-lg p-3 border border-white/10">
                        <p className="text-xs text-white/70 font-mono break-all leading-relaxed">{videosDir}</p>
                    </div>
                    <button onClick={() => handleCopyPath(videosDir)} className="w-full bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/20 rounded-md py-2 text-xs font-medium text-cyan-400 transition-colors">Copy Path to Clipboard</button>
                    <p className="text-[10px] text-white/30 text-center">Paste into Finder → Go → Go to Folder</p>
                </div>
            </ModalOverlay>

            <Toast message={toast.message} visible={toast.visible} />
        </div>
    )
}
