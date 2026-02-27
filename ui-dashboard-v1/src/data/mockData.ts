import type { DashboardData, VideoItem, DocumentItem } from '../types/dashboard'

export const MOCK_DASHBOARD: DashboardData = {
  ok: true,
  ts: new Date().toISOString(),
  server: {
    cpu_pct: 42.1,
    mem_pct: 61.3,
    db: 'ok',
    python: 'up',
    status: 'ok',
  },
  acp: {
    java: 'up',
    queue: { pending: 3, done: 148, failed: 0 },
    status: 'ok',
  },
  deploy: {
    python_uptime_sec: 51_720,  // 14h 22m
    java_uptime_sec: 32_700,    //  9h 05m
    nginx: 'up',
    db: 'ok',
    status: 'ok',
  },
}

export const MOCK_VIDEOS: VideoItem[] = [
  { id: 1, bno: 1421, title: 'AI 반도체 전쟁의 서막', duration: '0:58', status: 'uploaded', created_at: '14:32' },
  { id: 2, bno: 1422, title: '양자컴퓨팅 2026 전망', duration: '1:02', status: 'uploaded', created_at: '13:05' },
  { id: 3, bno: 1423, title: 'GPT-5 성능 분석 리포트', duration: '0:55', status: 'processing', created_at: '12:48' },
  { id: 4, bno: 1424, title: '로봇공학의 현재와 미래', duration: '1:10', status: 'uploaded', created_at: '11:30' },
  { id: 5, bno: 1425, title: '바이오AI 최신 연구 동향', duration: '0:52', status: 'uploaded', created_at: '10:15' },
  { id: 6, bno: 1426, title: '자율주행 2단계 돌파구', duration: '0:48', status: 'failed', created_at: '09:00' },
]

const s = (vals: number[]) => vals.map(v => ({ v }))

export const MOCK_DOCUMENTS: DocumentItem[] = [
  { id: 1, bno: 1421, title: 'AI 반도체 전쟁의 서막', category: 'TECH', views: 2840, spark: s([4,6,5,8,7,9,11,8,12,10,14,13]), created_at: '14:32' },
  { id: 2, bno: 1422, title: '양자컴퓨팅 2026 전망', category: 'TECH', views: 1920, spark: s([3,5,4,7,6,8,6,9,8,10,9,11]), created_at: '13:05' },
  { id: 3, bno: 1423, title: 'GPT-5 성능 분석 리포트', category: 'AI', views: 3450, spark: s([6,8,7,10,9,12,13,11,14,12,16,15]), created_at: '12:48' },
  { id: 4, bno: 1424, title: '로봇공학의 현재와 미래', category: 'TECH', views: 1560, spark: s([2,4,3,5,4,6,5,7,6,8,7,9]), created_at: '11:30' },
  { id: 5, bno: 1425, title: '바이오AI 최신 연구 동향', category: 'AGRO', views: 980, spark: s([1,3,2,4,3,5,4,6,5,7,6,8]), created_at: '10:15' },
]
