import { motion } from 'framer-motion'
import type { DocumentItem } from '../../types/dashboard'

// ─── Types for API data ─────────────────────────────────────────────────────
export interface ReportItem {
  id: string
  title: string
  category: string
  path: string
  mtimeISO: string
  timeHHMM: string
}

// ─── Category chip ─────────────────────────────────────────────────────────────
function CategoryChip({ category }: { category: string }) {
  const cls =
    category === 'AI' ? 'chip-ai' :
      category === 'AGRO' ? 'chip-agro' :
        'chip-tech'
  return <span className={cls}>{category}</span>
}

// ─── Document row (API data) ──────────────────────────────────────────────────
function ReportRow({ report, index, onOpen }: { report: ReportItem; index: number; onOpen: (path: string) => void }) {
  return (
    <motion.div
      className="flex items-center gap-3 py-3 group cursor-pointer"
      initial={{ opacity: 0, x: -12 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: 0.06 * index, duration: 0.35, ease: 'easeOut' }}
      whileHover={{ x: 3 }}
      onClick={() => onOpen(report.path)}
    >
      {/* Index */}
      <span className="text-xs text-white/20 tabular-nums w-4 shrink-0 text-right">
        {index + 1}
      </span>

      {/* Category chip */}
      <div className="shrink-0">
        <CategoryChip category={report.category} />
      </div>

      {/* Title */}
      <p className="flex-1 text-sm text-white/70 truncate group-hover:text-white/90 transition-colors duration-150 leading-tight">
        {report.title}
      </p>

      {/* Time */}
      <span className="text-[10px] text-white/20 tabular-nums shrink-0">
        {report.timeHHMM}
      </span>
    </motion.div>
  )
}

// ─── Fallback row for mock data ───────────────────────────────────────────────
function DocRow({ doc, index }: { doc: DocumentItem; index: number }) {
  return (
    <motion.div
      className="flex items-center gap-3 py-3 group"
      initial={{ opacity: 0, x: -12 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: 0.06 * index, duration: 0.35, ease: 'easeOut' }}
      whileHover={{ x: 3 }}
    >
      <span className="text-xs text-white/20 tabular-nums w-4 shrink-0 text-right">
        {index + 1}
      </span>
      <div className="shrink-0">
        <CategoryChip category={doc.category} />
      </div>
      <p className="flex-1 text-sm text-white/70 truncate group-hover:text-white/90 transition-colors duration-150 leading-tight">
        {doc.title}
      </p>
      <span className="text-[10px] text-white/20 tabular-nums shrink-0">
        {doc.created_at}
      </span>
    </motion.div>
  )
}

// ─── Section ──────────────────────────────────────────────────────────────────
interface Props {
  documents: DocumentItem[]            // fallback mock data
  reports?: ReportItem[]               // API data (priority)
  loading?: boolean
  onOpenReport?: (path: string) => void
}

export default function TodayDocuments({ documents, reports, loading, onOpenReport }: Props) {
  const useApi = reports && reports.length > 0
  const items = useApi ? reports : null
  const count = useApi ? reports.length : documents.length

  const handleOpen = (p: string) => {
    if (onOpenReport) onOpenReport(p)
  }

  return (
    <div className="glass-section p-5 pb-3">
      {/* Header */}
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <span className="text-base">📄</span>
          <span className="text-sm font-semibold text-white/80 tracking-tight">Today Documents</span>
          <span
            className="text-[10px] text-white/30 px-2 py-0.5 rounded-full"
            style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}
          >
            {loading ? '…' : `${count} items`}
          </span>
          {useApi && <span className="text-[9px] text-emerald-400/60 font-mono ml-1">LIVE</span>}
        </div>
        <span className="text-xs text-white/25 hidden sm:block">AI Reports</span>
      </div>

      {/* Column labels */}
      <div className="flex items-center gap-3 py-2 px-0 mb-0">
        <span className="w-4" />
        <span className="w-12 text-[10px] text-white/20 uppercase tracking-widest">Type</span>
        <span className="flex-1 text-[10px] text-white/20 uppercase tracking-widest">Title</span>
        <span className="w-12 text-[10px] text-white/20 uppercase tracking-widest text-right">Time</span>
      </div>

      <div className="divider mb-0" />

      {/* Loading state */}
      {loading && (
        <div className="py-6 text-center text-xs text-white/30">Loading reports…</div>
      )}

      {/* Rows */}
      {!loading && (
        <div className="divide-y" style={{ '--tw-divide-opacity': 1 } as React.CSSProperties}>
          {items
            ? items.map((report, i) => (
              <div key={report.id} style={{ borderColor: 'rgba(255,255,255,0.04)' }}>
                <ReportRow report={report} index={i} onOpen={handleOpen} />
              </div>
            ))
            : documents.map((doc, i) => (
              <div key={doc.id} style={{ borderColor: 'rgba(255,255,255,0.04)' }}>
                <DocRow doc={doc} index={i} />
              </div>
            ))
          }
        </div>
      )}

      {/* Empty state */}
      {!loading && count === 0 && (
        <div className="py-6 text-center text-xs text-white/30">
          No reports yet. Run <code className="text-white/50">node reports/run.js</code> to generate.
        </div>
      )}
    </div>
  )
}
