import { motion } from 'framer-motion'
import type { DeployData } from '../../types/dashboard'

function formatUptime(sec: number): string {
  if (sec < 60)     return `${sec}s`
  if (sec < 3_600)  return `${Math.floor(sec / 60)}m`
  if (sec < 86_400) return `${Math.floor(sec / 3_600)}h ${Math.floor((sec % 3_600) / 60)}m`
  return `${Math.floor(sec / 86_400)}d ${Math.floor((sec % 86_400) / 3_600)}h`
}

// ─── Service row ──────────────────────────────────────────────────────────────
function ServiceRow({
  icon,
  label,
  value,
  up,
  delay = 0,
}: {
  icon: string
  label: string
  value: string
  up: boolean
  delay?: number
}) {
  return (
    <motion.div
      className="flex items-center justify-between"
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay, duration: 0.35, ease: 'easeOut' }}
    >
      <div className="flex items-center gap-2">
        <span className="text-sm">{icon}</span>
        <span className="text-xs text-white/45">{label}</span>
      </div>
      <div className="flex items-center gap-2">
        <span
          className="text-xs font-semibold tabular-nums"
          style={{ color: up ? '#22d3ee' : '#ef4444' }}
        >
          {value}
        </span>
        <span
          className="w-1.5 h-1.5 rounded-full"
          style={{ background: up ? '#22c55e' : '#ef4444' }}
        />
      </div>
    </motion.div>
  )
}

// ─── Widget ───────────────────────────────────────────────────────────────────
export default function DeployWidget({ data }: { data: DeployData }) {
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
          <span className="text-base">🚀</span>
          <span className="text-sm font-semibold text-white/80 tracking-tight">Deploy</span>
        </div>
        <span className={`badge ${statusOk ? 'badge-ok' : 'badge-warn'}`}>
          {data.status}
        </span>
      </div>

      {/* Uptime hero numbers */}
      <div className="grid grid-cols-2 gap-3 mb-5">
        <div
          className="rounded-xl p-3 text-center"
          style={{ background: 'rgba(34,211,238,0.05)', border: '1px solid rgba(34,211,238,0.10)' }}
        >
          <p className="text-[10px] text-white/30 tracking-widest uppercase mb-1">Python</p>
          <motion.p
            className="text-lg font-bold tabular-nums neon-cyan"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3 }}
          >
            {formatUptime(data.python_uptime_sec)}
          </motion.p>
        </div>
        <div
          className="rounded-xl p-3 text-center"
          style={{ background: 'rgba(167,139,250,0.05)', border: '1px solid rgba(167,139,250,0.10)' }}
        >
          <p className="text-[10px] text-white/30 tracking-widest uppercase mb-1">Java</p>
          <motion.p
            className="text-lg font-bold tabular-nums neon-purple"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.35 }}
          >
            {formatUptime(data.java_uptime_sec)}
          </motion.p>
        </div>
      </div>

      <div className="divider mb-4" />

      {/* Service rows */}
      <div className="space-y-3">
        <ServiceRow
          icon="🌐" label="nginx" value="UP"
          up={data.nginx === 'up'} delay={0.2}
        />
        <ServiceRow
          icon="🗄️" label="Database" value={data.db === 'ok' ? 'OK' : 'ERROR'}
          up={data.db === 'ok'} delay={0.27}
        />
      </div>
    </motion.div>
  )
}
