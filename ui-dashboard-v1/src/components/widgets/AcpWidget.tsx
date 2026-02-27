import { motion } from 'framer-motion'
import type { AcpData } from '../../types/dashboard'

// ─── Stat cell ────────────────────────────────────────────────────────────────
function QueueStat({
  label,
  value,
  color,
}: {
  label: string
  value: number
  color: string
}) {
  return (
    <div className="text-center">
      <motion.p
        className="text-2xl font-bold tabular-nums leading-none"
        style={{ color }}
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ type: 'spring', stiffness: 300, damping: 25, delay: 0.35 }}
      >
        {value}
      </motion.p>
      <p className="text-[10px] text-white/35 mt-1 tracking-widest uppercase">{label}</p>
    </div>
  )
}

// ─── Widget ───────────────────────────────────────────────────────────────────
export default function AcpWidget({ data }: { data: AcpData }) {
  const javaOk = data.java === 'up'
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
          <span className="text-base">⚙️</span>
          <span className="text-sm font-semibold text-white/80 tracking-tight">ACP / Queue</span>
        </div>
        <span className={`badge ${statusOk ? 'badge-ok' : 'badge-warn'}`}>
          {data.status}
        </span>
      </div>

      {/* Java status */}
      <div className="flex items-center justify-between mb-5 px-1">
        <span className="text-xs text-white/40">Java ACP (9090)</span>
        <div className="flex items-center gap-2">
          {javaOk && (
            <span className="relative flex items-center w-2 h-2">
              <span
                className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"
                style={{ animation: 'ping 2.2s cubic-bezier(0,0,0.2,1) infinite' }}
              />
              <span className="relative inline-flex w-2 h-2 rounded-full bg-emerald-400" />
            </span>
          )}
          <span
            className="text-xs font-semibold"
            style={{ color: javaOk ? '#22c55e' : '#ef4444' }}
          >
            {javaOk ? 'UP' : 'DOWN'}
          </span>
        </div>
      </div>

      {/* Big done number */}
      <div className="text-center py-3 mb-5">
        <motion.p
          className="text-5xl font-black tabular-nums leading-none neon-cyan"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: 'spring', stiffness: 240, damping: 22, delay: 0.25 }}
        >
          {data.queue.done}
        </motion.p>
        <p className="text-[10px] text-white/30 mt-1.5 tracking-widest uppercase">Videos Generated</p>
      </div>

      <div className="divider mb-4" />

      {/* Queue breakdown */}
      <div className="grid grid-cols-3 gap-2">
        <QueueStat label="Pending" value={data.queue.pending} color="#f59e0b" />
        <QueueStat label="Done"    value={data.queue.done}    color="#22c55e" />
        <QueueStat
          label="Failed"
          value={data.queue.failed}
          color={data.queue.failed > 0 ? '#ef4444' : 'rgba(255,255,255,0.35)'}
        />
      </div>
    </motion.div>
  )
}
