import { useEffect, useState, useCallback } from 'react'
import Card from '../components/Card'

// ─── Types ────────────────────────────────────────────────
type ServerEntry = { status: string; latency_ms: number }
type ACP = {
  queue_pending: number
  queue_completed: number
  queue_error: number
  scheduled_today: number
  generating_count: number
}
type N8N = { status: string; latency_ms?: number; checked_at: string }
type Deploy = { version: string; sha: string; deployed_at: string }

interface DashboardData {
  timestamp: string
  servers: { python: ServerEntry; java: ServerEntry }
  acp: ACP
  n8n: N8N
  deploy: Deploy
}

// ─── Pill helper ─────────────────────────────────────────
function statusToPill(status: string): string {
  if (status === 'ok') return 'pill-green'
  if (status === 'error') return 'pill-red'
  if (status === 'not_configured') return 'pill-blue'
  return 'pill-gray'
}

function StatusPill({ status }: { status: string }) {
  return (
    <span className={`status-pill ${statusToPill(status)}`}>
      {status === 'ok' ? '● Online' : status === 'error' ? '● Error' : status === 'not_configured' ? '— Not configured' : `○ ${status}`}
    </span>
  )
}

// ─── Stat number block ───────────────────────────────────
function Stat({ label, value, accent }: { label: string; value: number | string; accent?: boolean }) {
  return (
    <div className="dash-stat">
      <span className={`dash-stat-value${accent ? ' dash-stat-accent' : ''}`}>{value}</span>
      <span className="dash-stat-label">{label}</span>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────
const POLL_INTERVAL_MS = 30_000

export default function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastFetch, setLastFetch] = useState<string>('')

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/factory/api/dashboard/status')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      setData(json)
      setError(null)
      setLastFetch(new Date().toLocaleTimeString())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchStatus()
    const id = setInterval(fetchStatus, POLL_INTERVAL_MS)
    return () => clearInterval(id)
  }, [fetchStatus])

  return (
    <div className="page-stack">
      <header className="page-head">
        <h1 className="page-title">Dashboard</h1>
        <p className="page-subtitle">
          System monitoring — auto-refreshes every 30 s
          {lastFetch && <span className="subtle-text"> · last updated {lastFetch}</span>}
        </p>
      </header>

      {loading && !data && (
        <div className="empty-state">
          <div className="empty-state-title">Checking systems…</div>
        </div>
      )}

      {error && (
        <div className="status-row" style={{ borderColor: '#6a2f39', background: '#1a0c0e' }}>
          <span className="status-label">Error</span>
          <span className="status-pill pill-red">Failed to reach /api/dashboard/status — {error}</span>
          <button className="btn btn-ghost" onClick={fetchStatus}>Retry</button>
        </div>
      )}

      {data && (
        <div className="overview-grid">
          {/* ── 1. Server Status ── */}
          <Card title="🖥 서버 상태">
            <div className="status-stack">
              <div className="status-row">
                <span className="status-label">Python :5001</span>
                <StatusPill status={data.servers.python.status} />
                {data.servers.python.latency_ms >= 0 && (
                  <span className="subtle-text">{data.servers.python.latency_ms} ms</span>
                )}
              </div>
              <div className="status-row">
                <span className="status-label">Java :9090</span>
                <StatusPill status={data.servers.java.status} />
                {data.servers.java.latency_ms >= 0 && (
                  <span className="subtle-text">{data.servers.java.latency_ms} ms</span>
                )}
              </div>
            </div>
          </Card>

          {/* ── 2. ACP / Pipeline Status ── */}
          <Card title="⚙️ ACP 상태">
            <div className="dash-stats-grid">
              <Stat label="대기중" value={data.acp.queue_pending} accent={data.acp.queue_pending > 0} />
              <Stat label="완료" value={data.acp.queue_completed} />
              <Stat label="오류" value={data.acp.queue_error} accent={data.acp.queue_error > 0} />
              <Stat label="오늘 예약" value={data.acp.scheduled_today} />
            </div>
            {data.acp.generating_count > 0 && (
              <div className="status-row" style={{ marginTop: 10 }}>
                <span className="status-pill pill-blue">
                  ⟳ 생성 중 {data.acp.generating_count}건
                </span>
              </div>
            )}
          </Card>

          {/* ── 3. n8n Status ── */}
          <Card title="🔄 n8n 상태">
            <div className="status-stack">
              <div className="status-row">
                <span className="status-label">n8n</span>
                <StatusPill status={data.n8n.status} />
                {data.n8n.latency_ms !== undefined && data.n8n.latency_ms >= 0 && (
                  <span className="subtle-text">{data.n8n.latency_ms} ms</span>
                )}
              </div>
            </div>
            {data.n8n.status === 'not_configured' && (
              <p className="subtle-text" style={{ marginTop: 8, marginBottom: 0 }}>
                n8n을 연결하려면 Python .env에{' '}
                <code className="md-inline-code">N8N_URL=http://…</code>을 추가하세요.
              </p>
            )}
          </Card>

          {/* ── 4. Deploy Info ── */}
          <Card title="🚀 배포 상태">
            <div className="status-stack">
              <div className="status-row">
                <span className="status-label">Version</span>
                <span className="status-pill pill-blue">{data.deploy.version || 'unknown'}</span>
              </div>
              {data.deploy.sha && (
                <div className="status-row">
                  <span className="status-label">SHA</span>
                  <code className="md-inline-code subtle-text">{data.deploy.sha.slice(0, 7)}</code>
                </div>
              )}
              {data.deploy.deployed_at && (
                <div className="status-row">
                  <span className="status-label">배포일</span>
                  <span className="subtle-text">{data.deploy.deployed_at}</span>
                </div>
              )}
            </div>
          </Card>
        </div>
      )}

      {data && (
        <p className="subtle-text" style={{ textAlign: 'right', marginTop: 4 }}>
          서버 기준 시각: {data.timestamp}
        </p>
      )}
    </div>
  )
}
