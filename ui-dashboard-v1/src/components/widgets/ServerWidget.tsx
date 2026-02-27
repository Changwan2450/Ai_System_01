import { motion } from 'framer-motion'
import type { ServerData } from '../../types/dashboard'

// ─── GaugeBar ─────────────────────────────────────────────────────────────────
function GaugeBar({ value, delay = 0 }: { value: number; delay?: number }) {
  const color =
    value >= 90 ? '#ef4444' :
    value >= 75 ? '#f59e0b' :
    '#22d3ee'
  return (
    <div className="gauge-track">
      <motion.div
        className="gauge-fill"
        initial={{ width: '0%' }}
        animate={{ width: `${value}%` }}
        transition={{ duration: 1.2, ease: [0.22, 0.61, 0.36, 1], delay }}
        style={{ background: color }}
      />
    </div>
  )
}

// ─── InlineStatus ──────────────────────────────────────────────────────────────
function InlineStatus({ ok }: { ok: boolean }) {
  return (
    <span
      className="text-xs font-semibold px-2 py-0.5 rounded"
      style={{
        background: ok ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)',
        color: ok ? '#22c55e' : '#ef4444',
      }}
    >
      {ok ? 'UP' : 'DOWN'}
    </span>
  )
}

// ─── Widget ───────────────────────────────────────────────────────────────────
export default function ServerWidget({ data }: { data: ServerData }) {
  const statusOk = data.status === 'ok'

  return (
    <motion.div
      className="glass p-5 h-full"
      whileHover={{ scale: 1.025 }}
      transition={{ type: 'spring', stiffness: 320, damping: 28 }}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-2">
          <span className="text-base">🖥️</span>
          <span className="text-sm font-semibold text-white/80 tracking-tight">Server</span>
        </div>
        <span className={`badge ${statusOk ? 'badge-ok' : 'badge-warn'}`}>
          {data.status}
        </span>
      </div>

      {/* CPU */}
      <div className="space-y-1.5 mb-4">
        <div className="flex justify-between items-center">
          <span className="text-xs text-white/40">CPU</span>
          <span
            className="text-sm font-semibold tabular-nums"
            style={{ color: data.cpu_pct >= 90 ? '#ef4444' : data.cpu_pct >= 75 ? '#f59e0b' : '#22d3ee' }}
          >
            {data.cpu_pct.toFixed(0)}%
          </span>
        </div>
        <GaugeBar value={data.cpu_pct} delay={0.2} />
      </div>

      {/* Memory */}
      <div className="space-y-1.5 mb-5">
        <div className="flex justify-between items-center">
          <span className="text-xs text-white/40">Memory</span>
          <span
            className="text-sm font-semibold tabular-nums"
            style={{ color: data.mem_pct >= 90 ? '#ef4444' : data.mem_pct >= 75 ? '#f59e0b' : '#a78bfa' }}
          >
            {data.mem_pct.toFixed(0)}%
          </span>
        </div>
        <GaugeBar value={data.mem_pct} delay={0.3} />
      </div>

      <div className="divider mb-4" />

      {/* DB + Python rows */}
      <div className="space-y-2.5">
        <div className="flex items-center justify-between">
          <span className="text-xs text-white/40">Database</span>
          <InlineStatus ok={data.db === 'ok'} />
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-white/40">Python API</span>
          <InlineStatus ok={data.python === 'up'} />
        </div>
      </div>
    </motion.div>
  )
}
