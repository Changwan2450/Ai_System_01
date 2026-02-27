import { useEffect, useMemo, useState } from 'react'
import Button from '../components/Button'
import Card from '../components/Card'
import { loadTodayDocs, type TodayDoc } from '../lib/storage'

type VideoItem = {
  filename: string
  size: string
  modified: string
  status: string
}

function normalizeVideo(item: unknown): VideoItem {
  if (typeof item === 'string') {
    return {
      filename: item,
      size: '-',
      modified: '-',
      status: 'Draft',
    }
  }

  const value = (item ?? {}) as Record<string, unknown>
  return {
    filename: String(value.filename ?? value.name ?? 'unknown.mp4'),
    size: String(value.size ?? '-'),
    modified: String(value.modified ?? value.mtime ?? value.updatedAt ?? '-'),
    status: String(value.status ?? 'Draft'),
  }
}

function Overview() {
  const [videos, setVideos] = useState<VideoItem[]>([])
  const [docs, setDocs] = useState<TodayDoc[]>([])
  const [apiStatus, setApiStatus] = useState('Idle')
  const [aiStatus, setAiStatus] = useState<'Checking...' | 'Online' | 'Offline'>('Checking...')

  useEffect(() => {
    const fetchVideos = async () => {
      try {
        const response = await fetch('/factory/api/videos')
        if (!response.ok) throw new Error('Failed to load videos')
        const data = await response.json()
        const list = Array.isArray(data) ? data : []
        setVideos(list.map(normalizeVideo).slice(0, 5))
      } catch {
        setVideos([])
      }
    }

    fetchVideos()
    setDocs(loadTodayDocs().slice(0, 5))
  }, [])

  useEffect(() => {
    const checkAiBoard = async () => {
      setAiStatus('Checking...')
      try {
        const response = await fetch('../ai/', { method: 'HEAD' })
        setAiStatus(response.ok ? 'Online' : 'Offline')
      } catch {
        setAiStatus('Offline')
      }
    }

    checkAiBoard()
  }, [])

  const aiTone = useMemo(() => {
    if (aiStatus === 'Online') return 'pill-green'
    if (aiStatus === 'Offline') return 'pill-red'
    return 'pill-gray'
  }, [aiStatus])

  const apiTone = useMemo(() => {
    if (apiStatus === 'Online') return 'pill-green'
    if (apiStatus === 'Offline') return 'pill-red'
    return 'pill-gray'
  }, [apiStatus])

  const handleCheckApi = async () => {
    setApiStatus('Checking...')
    try {
      const response = await fetch('/factory/api/health')
      setApiStatus(response.ok ? 'Online' : 'Offline')
    } catch {
      setApiStatus('Offline')
    }
  }

  return (
    <div className="page-stack">
      <header className="page-head">
        <h1 className="page-title">Overview</h1>
        <p className="page-subtitle">Recent videos, today notes, and system health.</p>
      </header>

      <div className="overview-grid">
        <Card title="Recent Videos">
          {videos.length > 0 ? (
            <ul className="simple-list compact-list">
              {videos.map((video) => (
                <li key={`${video.filename}-${video.modified}`} className="simple-list-item compact-item">
                  <span className="mono filename-cell" title={video.filename}>
                    {video.filename}
                  </span>
                  <span className="subtle-text">{video.modified}</span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="empty-state">
              <div className="empty-state-title">No recent videos</div>
              <div className="empty-state-body">Videos will appear here after backend detection.</div>
            </div>
          )}
        </Card>

        <Card title="Recent Today Documents">
          {docs.length > 0 ? (
            <ul className="simple-list compact-list">
              {docs.map((doc) => (
                <li key={doc.id} className="simple-list-item compact-item">
                  <span>{doc.title || doc.date}</span>
                  <span className="subtle-text">{new Date(doc.updatedAt).toLocaleString()}</span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="empty-state">
              <div className="empty-state-title">No recent documents</div>
              <div className="empty-state-body">Create a Today note to populate this list.</div>
            </div>
          )}
        </Card>

        <Card title="System Status">
          <div className="status-stack">
            <div className="status-row">
              <span className="status-label">API</span>
              <span className={`status-pill ${apiTone}`}>{apiStatus}</span>
              <Button onClick={handleCheckApi}>Check API</Button>
            </div>
            <div className="status-row">
              <span className="status-label">AI Board</span>
              <span className={`status-pill ${aiTone}`}>{aiStatus}</span>
              <a className="btn btn-ghost" href="../ai/">
                Open AI Board
              </a>
            </div>
          </div>
        </Card>
      </div>
    </div>
  )
}

export default Overview
