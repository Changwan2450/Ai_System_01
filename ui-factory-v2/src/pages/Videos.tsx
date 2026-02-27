import { useCallback, useEffect, useState } from 'react'
import Button from '../components/Button'
import Card from '../components/Card'
import Toast from '../components/Toast'

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

function getVideoStatusTone(status: string): string {
  const value = status.trim().toLowerCase()
  if (value === 'uploaded') return 'pill-green'
  if (value === 'rendered') return 'pill-blue'
  if (value === 'draft') return 'pill-gray'
  return 'pill-gray'
}

function Videos() {
  const [videos, setVideos] = useState<VideoItem[]>([])
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState<{ message: string; tone: 'success' | 'error' | 'neutral' }>({
    message: '',
    tone: 'neutral',
  })

  const loadVideos = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch('/factory/api/videos')
      if (!response.ok) throw new Error('Failed to load videos')
      const data = await response.json()
      const list = Array.isArray(data) ? data : []
      setVideos(list.map(normalizeVideo))
    } catch {
      setVideos([])
      setToast({ message: 'Could not load video list.', tone: 'error' })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadVideos()
  }, [loadVideos])

  const handleDelete = async (filename: string) => {
    try {
      const first = await fetch(`/factory/api/videos?name=${encodeURIComponent(filename)}`, {
        method: 'DELETE',
      })

      if (!first.ok) {
        const fallback = await fetch(`/factory/api/videos/${encodeURIComponent(filename)}`, {
          method: 'DELETE',
        })
        if (!fallback.ok) throw new Error('Delete failed')
      }

      setToast({ message: `Deleted ${filename}`, tone: 'success' })
      await loadVideos()
    } catch {
      setToast({ message: `Failed to delete ${filename}`, tone: 'error' })
    }
  }

  return (
    <div className="page-stack">
      <header className="page-head">
        <h1 className="page-title">Videos</h1>
        <p className="page-subtitle">Auto-detected video files from the backend.</p>
      </header>

      {loading || videos.length > 0 ? (
        <Card title="Video Library">
          <div className="table-wrap premium-table-wrap">
            <table className="data-table premium-table">
              <thead>
                <tr>
                  <th>Filename</th>
                  <th className="th-right">Size</th>
                  <th>Modified</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={5} className="empty-text">
                      Loading videos...
                    </td>
                  </tr>
                ) : videos.length === 0 ? (
                  <tr>
                    <td colSpan={5}>
                      <div className="empty-state compact-empty-state">
                        <div className="empty-state-title">No videos found</div>
                        <div className="empty-state-body">The list updates when backend files are available.</div>
                      </div>
                    </td>
                  </tr>
                ) : (
                  videos.map((video) => (
                    <tr key={`${video.filename}-${video.modified}`}>
                      <td>
                        <span className="mono filename-cell" title={video.filename}>
                          {video.filename}
                        </span>
                      </td>
                      <td className="td-right mono">{video.size}</td>
                      <td>{video.modified}</td>
                      <td>
                        <span className={`status-pill ${getVideoStatusTone(video.status)}`}>{video.status}</span>
                      </td>
                      <td className="row-actions">
                        <Button
                          className="row-delete-btn"
                          variant="danger"
                          onClick={() => handleDelete(video.filename)}
                        >
                          Delete
                        </Button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>
      ) : (
        <Card title="Video Library" className="premium-empty-card">
          <div className="empty-state">
            <div className="empty-state-title">Library is empty</div>
            <div className="empty-state-body">Wait for backend processing or refresh later.</div>
          </div>
        </Card>
      )}

      <Toast message={toast.message} tone={toast.tone} />
    </div>
  )
}

export default Videos
