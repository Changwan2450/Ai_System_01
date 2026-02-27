export type ServiceStatus = 'ok' | 'warn' | 'error'
export type UpDown = 'up' | 'down' | 'timeout'
export type OkError = 'ok' | 'error'

export interface ServerData {
  cpu_pct: number
  mem_pct: number
  db: OkError
  python: UpDown
  status: ServiceStatus
}

export interface QueueData {
  pending: number
  done: number
  failed: number
}

export interface AcpData {
  java: UpDown
  queue: QueueData
  status: ServiceStatus
}

export interface DeployData {
  python_uptime_sec: number
  java_uptime_sec: number
  nginx: UpDown
  db: OkError
  status: ServiceStatus
}

export interface DashboardData {
  ok: boolean
  ts: string
  server: ServerData
  acp: AcpData
  deploy: DeployData
}

export interface VideoItem {
  id: number
  bno: number
  title: string
  duration: string
  status: 'uploaded' | 'processing' | 'failed'
  created_at: string
}

export interface DocumentItem {
  id: number
  bno: number
  title: string
  category: string
  views: number
  spark: Array<{ v: number }>
  created_at: string
}

export interface ProjectItem {
  id: string
  label: string
  baseDir: string
  listApi: string
  viewApi: string
}
