import { useCallback, useEffect, useState } from 'react'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import { MOCK_DASHBOARD, MOCK_VIDEOS, MOCK_DOCUMENTS } from '../data/mockData'
import type { VideoItem } from '../types/dashboard'
import type { ReportItem } from './widgets/TodayDocuments'
import RecentVideos from './widgets/RecentVideos'
import TodayDocuments from './widgets/TodayDocuments'

// ─── Animation variants ──────────────────────────────────────────────────────
const stagger = {
  hidden: {},
  show: {
    transition: { staggerChildren: 0.09, delayChildren: 0.12 },
  },
}

const fadeUp = {
  hidden: { opacity: 0, y: 22 },
  show: { opacity: 1, y: 0, transition: { type: 'spring' as const, stiffness: 280, damping: 26 } },
}

const fadeUpReduced = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { duration: 0.3 } },
}

// ─── StatusDot component ─────────────────────────────────────────────────────
function StatusDot({ label, status }: { label: string; status: 'ok' | 'warn' | 'error' }) {
  const colorMap = {
    ok: { dot: 'bg-emerald-400', ping: 'bg-emerald-400' },
    warn: { dot: 'bg-amber-400', ping: 'bg-amber-400' },
    error: { dot: 'bg-red-400', ping: 'bg-red-400' },
  }
  const c = colorMap[status]
  return (
    <div className="flex items-center gap-2">
      <span className="relative flex items-center justify-center w-2.5 h-2.5">
        <span className={`absolute inline-flex h-full w-full rounded-full opacity-70 ${c.ping} ping-ring`} />
        <span className={`relative inline-flex rounded-full w-2 h-2 ${c.dot}`} />
      </span>
      <span className="text-xs text-white/40 hidden sm:block tracking-wide">{label}</span>
    </div>
  )
}

// ─── Modal overlay ───────────────────────────────────────────────────────────
function ModalOverlay({ open, onClose, title, children }: {
  open: boolean; onClose: () => void; title: string; children: React.ReactNode
}) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[100] flex items-center justify-center"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
        >
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
          <motion.div
            className="relative z-10 w-full max-w-lg mx-4 rounded-xl border border-white/10 bg-[#141821] p-6 shadow-2xl"
            initial={{ scale: 0.95, y: 10 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, y: 10 }}
            transition={{ duration: 0.18 }}
          >
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
        <motion.div
          className="fixed bottom-6 right-6 z-[110] px-4 py-2.5 rounded-lg text-xs font-medium text-white/90 bg-emerald-600/90 border border-emerald-400/30 shadow-lg"
          initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }}
        >
          {message}
        </motion.div>
      )}
    </AnimatePresence>
  )
}

// ─── Types ───────────────────────────────────────────────────────────────────
interface VideoSummary {
  queueSize: number
  failed: number
  recent: VideoItem[]
  paths: { outputDir: string; videosDir: string; failedDirs: string[] }
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function Dashboard() {
  const data = MOCK_DASHBOARD
  const [clock, setClock] = useState(new Date())
  const shouldReduceMotion = useReducedMotion()
  const activeFadeUp = shouldReduceMotion ? fadeUpReduced : fadeUp

  // ── API state ──
  const [summary, setSummary] = useState<VideoSummary | null>(null)
  const [mdContent, setMdContent] = useState('')
  const [mdPath, setMdPath] = useState('')
  const [apiOnline, setApiOnline] = useState(false)

  // ── Reports state ──
  const [reports, setReports] = useState<ReportItem[]>([])
  const [reportsLoading, setReportsLoading] = useState(true)

  // ── Modal state ──
  const [folderModal, setFolderModal] = useState(false)
  const [mdModal, setMdModal] = useState(false)
  const [mdDraft, setMdDraft] = useState('')
  const [toast, setToast] = useState({ visible: false, message: '' })
  const [cleaning, setCleaning] = useState(false)

  // ── Toast helper ──
  const showToast = useCallback((msg: string) => {
    setToast({ visible: true, message: msg })
    setTimeout(() => setToast({ visible: false, message: '' }), 2500)
  }, [])

  // ── Fetch helpers ──
  const fetchSummary = useCallback(async () => {
    try {
      const r = await fetch('/api/videos/summary')
      if (!r.ok) throw new Error('fetch failed')
      const d: VideoSummary = await r.json()
      setSummary(d)
      setApiOnline(true)
    } catch {
      setApiOnline(false)
    }
  }, [])

  const fetchMd = useCallback(async () => {
    try {
      const r = await fetch('/api/md/today')
      if (!r.ok) throw new Error('fetch failed')
      const d = await r.json()
      setMdContent(d.content ?? '')
      setMdPath(d.path ?? '')
    } catch { /* ignore */ }
  }, [])

  const fetchReports = useCallback(async () => {
    setReportsLoading(true)
    try {
      const r = await fetch('/api/reports/today')
      if (!r.ok) throw new Error('fetch failed')
      const d: ReportItem[] = await r.json()
      setReports(d)
    } catch {
      setReports([])
    } finally {
      setReportsLoading(false)
    }
  }, [])

  // ── Clock ──
  useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 1_000)
    return () => clearInterval(t)
  }, [])

  // ── Initial data fetch ──
  useEffect(() => {
    fetchSummary()
    fetchMd()
    fetchReports()
  }, [fetchSummary, fetchMd, fetchReports])

  // ── Actions ──
  const handleCleanFailed = async () => {
    setCleaning(true)
    try {
      const r = await fetch('/api/videos/clean-failed', { method: 'POST' })
      const d = await r.json()
      showToast(`Cleaned ${d.deleted} failed file(s)`)
      await fetchSummary()
    } catch {
      showToast('Clean failed: backend offline')
    } finally {
      setCleaning(false)
    }
  }

  const handleCopyPath = async (p: string) => {
    try {
      await navigator.clipboard.writeText(p)
      showToast('Path copied!')
    } catch {
      showToast('Copy failed')
    }
  }

  const handleNewDailyMd = async () => {
    if (mdContent.trim().length > 0) {
      showToast('today.md already has content')
      return
    }
    const today = new Date().toISOString().slice(0, 10)
    const skeleton = `# ${today}\n\n## Tasks\n- [ ] \n\n## Notes\n\n`
    try {
      await fetch('/api/md/today', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: skeleton }),
      })
      await fetchMd()
      showToast('Created new daily.md')
    } catch {
      showToast('Failed: backend offline')
    }
  }

  const handleSaveMd = async () => {
    try {
      await fetch('/api/md/today', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: mdDraft }),
      })
      await fetchMd()
      setMdModal(false)
      showToast('Saved today.md')
    } catch {
      showToast('Save failed: backend offline')
    }
  }

  const openMdEditor = () => {
    setMdDraft(mdContent)
    setMdModal(true)
  }

  const handleOpenReport = async (filePath: string) => {
    try {
      const r = await fetch('/api/reports/open', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: filePath }),
      })
      if (!r.ok) throw new Error('open failed')
      showToast('Opened in default app')
    } catch {
      showToast('Failed to open file')
    }
  }

  // ── Derived values ──
  const queueSize = summary?.queueSize ?? 0
  const failedCount = summary?.failed ?? 0
  const videosDir = summary?.paths?.videosDir ?? OUTPUT_DIR_DEFAULT
  const recentVideos: VideoItem[] = (summary?.recent && summary.recent.length > 0) ? summary.recent : MOCK_VIDEOS
  const mdPreview = mdContent.trim() ? mdContent.slice(0, 120) : '(empty — click "New Daily.md" to create)'

  return (
    <div className="min-h-screen pb-12">
      {/* ── HEADER ── */}
      <header className="sticky top-0 z-50 px-5 sm:px-6 lg:px-8 py-3 header-glass hairline">
        <div className="w-full flex items-center gap-4 sm:gap-6">

          {/* Logo */}
          <div className="flex items-center gap-2.5 shrink-0">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center text-sm bg-gradient-to-br from-cyan-500/10 to-purple-500/10 border border-cyan-400/20">
              ⚡
            </div>
            <div className="hidden sm:block">
              <p className="text-[10px] text-white/35 leading-none mb-0.5 tracking-widest uppercase tabular">Antigravity</p>
              <p className="text-sm font-semibold text-white/90 leading-none tracking-tight">AI_SYSTEM</p>
            </div>
          </div>

          {/* System status dots */}
          <div className="flex flex-1 items-center justify-center gap-3 sm:gap-5">
            <StatusDot label="Server" status={data.server.status} />
            <StatusDot label="API" status={apiOnline ? 'ok' : 'error'} />
            <StatusDot label="Deploy" status={data.deploy.status} />
            <div className="w-px h-4 bg-white/10 hidden sm:block" />
            <span className="text-xs text-white/25 hidden sm:block tabular">
              {clock.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
          </div>

          {/* n8n external link */}
          <a
            href="https://n8n.noa-on.com/"
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-white/50 bg-white/5 border border-white/10 hover:bg-white/10 hover:border-white/20 hover:text-white/90 transition-all duration-200 focus-ring"
            aria-label="Open n8n dashboard"
          >
            n8n
            <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
              <path d="M1 9L9 1M9 1H3.5M9 1V6.5" />
            </svg>
          </a>

        </div>
      </header>

      {/* ── MAIN CONTENT ── */}
      <main className="max-w-7xl mx-auto px-6 py-8 space-y-6">

        {/* Top 3 Content Workflow Cards */}
        <motion.div
          variants={stagger}
          initial="hidden"
          animate="show"
          className="grid grid-cols-1 md:grid-cols-3 gap-6"
        >
          {/* Card A: Work Queue (Videos) */}
          <motion.div variants={activeFadeUp} className="glass-panel p-5 h-full flex flex-col justify-between">
            <div>
              <div className="flex items-center gap-2 mb-3">
                <span className="text-lg">🎬</span>
                <h3 className="text-sm font-semibold text-white/90">Work Queue (Videos)</h3>
                {apiOnline && <span className="ml-auto text-[9px] text-emerald-400/60 font-mono">LIVE</span>}
              </div>
              <div className="flex gap-4 mb-4">
                <div>
                  <p className="text-xs text-white/40 mb-1">Queue Size</p>
                  <p className="text-2xl font-bold text-cyan-400">{queueSize}</p>
                </div>
                <div>
                  <p className="text-xs text-white/40 mb-1">Failed</p>
                  <p className="text-2xl font-bold text-red-400">{failedCount}</p>
                </div>
              </div>
            </div>

            <div className="flex gap-2 mt-auto">
              <button
                onClick={() => setFolderModal(true)}
                className="flex-1 bg-white/5 hover:bg-white/10 active:bg-white/5 border border-white/10 rounded-md py-1.5 text-xs font-medium text-white/70 transition-colors"
              >
                Open Folder
              </button>
              <button
                onClick={handleCleanFailed}
                disabled={cleaning || failedCount === 0}
                className="flex-1 bg-red-500/10 hover:bg-red-500/20 active:bg-red-500/10 border border-red-500/20 rounded-md py-1.5 text-xs font-medium text-red-400 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {cleaning ? 'Cleaning…' : 'Clean Failed'}
              </button>
            </div>
          </motion.div>

          {/* Card B: Daily MD */}
          <motion.div variants={activeFadeUp} className="glass-panel p-5 h-full flex flex-col justify-between">
            <div>
              <div className="flex items-center gap-2 mb-3">
                <span className="text-lg">📝</span>
                <h3 className="text-sm font-semibold text-white/90">Daily MD</h3>
              </div>
              <div className="bg-white/5 rounded p-3 mb-4 h-16 overflow-hidden relative">
                <div className="absolute inset-0 bg-gradient-to-b from-transparent to-[#0f1219] pointer-events-none" />
                <p className="text-xs text-white/60 font-mono leading-relaxed whitespace-pre-wrap">
                  {mdPreview}
                </p>
              </div>
            </div>

            <div className="flex gap-2 mt-auto">
              <button
                onClick={handleNewDailyMd}
                className="flex-1 bg-purple-500/10 hover:bg-purple-500/20 active:bg-purple-500/10 border border-purple-500/20 rounded-md py-1.5 text-xs font-medium text-purple-400 transition-colors"
              >
                New Daily.md
              </button>
              <button
                onClick={openMdEditor}
                className="flex-1 bg-white/5 hover:bg-white/10 active:bg-white/5 border border-white/10 rounded-md py-1.5 text-xs font-medium text-white/70 transition-colors"
              >
                Open Today
              </button>
            </div>
          </motion.div>

          {/* Card C: Control / Admin */}
          <motion.div variants={activeFadeUp} className="glass-panel p-5 h-full flex flex-col justify-between">
            <div>
              <div className="flex items-center gap-2 mb-3">
                <span className="text-lg">⚙️</span>
                <h3 className="text-sm font-semibold text-white/90">Control / Admin</h3>
              </div>
              <p className="text-xs text-white/50 leading-relaxed mb-4">
                Access the main AI Board for system configuration, model toggles, and advanced administration tasks.
                Authentication required.
              </p>
            </div>

            <div className="mt-auto">
              <button
                onClick={() => alert('TODO: Navigate to /admin (Requires Auth)')}
                className="w-full bg-cyan-500/10 hover:bg-cyan-500/20 active:bg-cyan-500/10 border border-cyan-500/20 rounded-md py-1.5 text-xs font-medium text-cyan-400 transition-colors flex items-center justify-center gap-1.5"
              >
                AI Board / Admin
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                  <path d="M1 9L9 1M9 1H3.5M9 1V6.5" />
                </svg>
              </button>
            </div>
          </motion.div>
        </motion.div>

        {/* Recent Videos */}
        <motion.div
          initial="hidden"
          animate="show"
          variants={activeFadeUp}
          transition={{ delay: 0.1 }}
        >
          <RecentVideos videos={recentVideos} />
        </motion.div>

        {/* Today Documents — now wired to Reports API */}
        <motion.div
          initial="hidden"
          animate="show"
          variants={activeFadeUp}
          transition={{ delay: 0.2 }}
        >
          <TodayDocuments
            documents={MOCK_DOCUMENTS}
            reports={reports}
            loading={reportsLoading}
            onOpenReport={handleOpenReport}
          />
        </motion.div>

      </main>

      {/* ── Modals ── */}

      {/* Folder Path Modal */}
      <ModalOverlay open={folderModal} onClose={() => setFolderModal(false)} title="📁 Video Output Folder">
        <div className="space-y-3">
          <div className="bg-white/5 rounded-lg p-3 border border-white/10">
            <p className="text-xs text-white/70 font-mono break-all leading-relaxed">{videosDir}</p>
          </div>
          <button
            onClick={() => handleCopyPath(videosDir)}
            className="w-full bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/20 rounded-md py-2 text-xs font-medium text-cyan-400 transition-colors"
          >
            Copy Path to Clipboard
          </button>
          <p className="text-[10px] text-white/30 text-center">Paste into Finder → Go → Go to Folder</p>
        </div>
      </ModalOverlay>

      {/* Daily MD Editor Modal */}
      <ModalOverlay open={mdModal} onClose={() => setMdModal(false)} title="📝 Edit today.md">
        <div className="space-y-3">
          {mdPath && <p className="text-[10px] text-white/30 font-mono truncate">{mdPath}</p>}
          <textarea
            value={mdDraft}
            onChange={e => setMdDraft(e.target.value)}
            className="w-full h-48 bg-white/5 border border-white/10 rounded-lg p-3 text-xs text-white/80 font-mono leading-relaxed resize-none focus:outline-none focus:border-cyan-500/40 transition-colors"
            placeholder="Write your daily notes here..."
          />
          <div className="flex gap-2">
            <button
              onClick={() => setMdModal(false)}
              className="flex-1 bg-white/5 hover:bg-white/10 border border-white/10 rounded-md py-2 text-xs font-medium text-white/50 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSaveMd}
              className="flex-1 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/20 rounded-md py-2 text-xs font-medium text-emerald-400 transition-colors"
            >
              Save
            </button>
          </div>
        </div>
      </ModalOverlay>

      {/* Toast */}
      <Toast message={toast.message} visible={toast.visible} />
    </div>
  )
}

// Default path for display when API is offline
const OUTPUT_DIR_DEFAULT = '/Users/changwan2450/Antigravity WorkSpace/AI_SYSTEM/naon.py/output'
