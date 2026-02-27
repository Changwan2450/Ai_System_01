import { useEffect, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import type { Variants } from 'framer-motion'
import type { VideoItem } from '../../types/dashboard'

const POSTER_EMOJIS = ['🤖', '⚛️', '🧠', '🦾', '🧬', '🚗']

const sectionVariants: Variants = {
  hidden: { opacity: 0, y: 40 },
  show: { opacity: 1, y: 0, transition: { duration: 0.8, ease: 'easeOut' } },
}

const listVariants: Variants = {
  hidden: {},
  show: {
    transition: { staggerChildren: 0.15, delayChildren: 0.3 },
  },
}

const cardVariants: Variants = {
  hidden: { opacity: 0, y: 30, scale: 0.92 },
  show: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.6, ease: 'easeOut' } },
}

function VideoCard({
  video,
  index,
  shouldAnimate,
}: {
  video: VideoItem
  index: number
  shouldAnimate: boolean
}) {
  const statusBadge =
    video.status === 'uploaded'
      ? { cls: 'badge-ok', label: 'Uploaded' }
      : video.status === 'processing'
        ? { cls: 'badge-info', label: 'Processing' }
        : { cls: 'badge-error', label: 'Failed' }

  return (
    <motion.div
      className="relative shrink-0 w-32 sm:w-36 cursor-default isolate hover:z-20 motion-safe:transform-gpu"
      style={{ willChange: 'transform, opacity', transformOrigin: 'center', backfaceVisibility: 'hidden' }}
      variants={shouldAnimate ? cardVariants : undefined}
      whileHover={shouldAnimate ? { scale: 1.03, y: -2 } : undefined}
    >
      <div className="video-poster mb-2.5 relative rounded-lg overflow-hidden bg-white/5 aspect-[9/16]">
        <div className="absolute top-2 left-2 z-10">
          <span className={`badge ${statusBadge.cls}`} style={{ fontSize: 9 }}>
            {statusBadge.label}
          </span>
        </div>

        <div className="absolute inset-0 flex items-center justify-center z-0">
          <motion.span
            style={{ fontSize: 36, filter: 'drop-shadow(0 0 16px rgba(34,211,238,0.4))', display: 'inline-block' }}
            animate={shouldAnimate ? { y: [0, -6, 0], rotate: [0, -1.5, 0], scale: [1, 1.03, 1] } : undefined}
            transition={shouldAnimate ? { duration: 3.6, repeat: Infinity, ease: 'easeInOut', delay: index * 0.12 } : undefined}
            whileHover={shouldAnimate ? { y: -10, scale: 1.06, rotate: 1.5 } : undefined}
          >
            {POSTER_EMOJIS[index % POSTER_EMOJIS.length]}
          </motion.span>
        </div>
      </div>

      <div className="min-h-[36px] mb-1 flex items-start">
        <p className="text-xs font-medium text-white/75 leading-snug clamp-2">{video.title}</p>
      </div>

      <p className="text-[10px] text-white/30 tabular-nums truncate">
        #{video.bno} · {video.created_at}
      </p>
    </motion.div>
  )
}

export default function RecentVideos({ videos }: { videos: VideoItem[] }) {
  const reduce = useReducedMotion()
  const [phase, setPhase] = useState<'hidden' | 'show'>('hidden')

  const mm =
    typeof window !== 'undefined'
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false
  const debugMotion =
    typeof window !== 'undefined' &&
    localStorage.getItem('DEBUG_MOTION') === '1'
  const shouldAnimate = debugMotion ? true : !reduce

  useEffect(() => {
    if (!shouldAnimate) {
      setPhase('show')
      return
    }
    setPhase('hidden')
    const t = setTimeout(() => setPhase('show'), 200)
    return () => clearTimeout(t)
  }, [shouldAnimate])

  const sectionBorderClass =
    shouldAnimate && phase === 'hidden'
      ? 'border-2 border-cyan-400 shadow-[0_0_15px_rgba(34,211,238,0.5)]'
      : 'border border-white/5'

  return (
    <motion.div
      className={`glass-section p-5 transition-all duration-300 ${sectionBorderClass}`}
      variants={shouldAnimate ? sectionVariants : undefined}
      initial={shouldAnimate ? 'hidden' : false}
      animate={shouldAnimate ? phase : false}
    >
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <span className="text-base">🎬</span>
          <span className="text-sm font-semibold text-white/80 tracking-tight">
            Recent Videos
          </span>
          <span
            className="text-[10px] text-white/30 px-2 py-0.5 rounded-full"
            style={{
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.08)',
            }}
          >
            Today · {videos.length}
          </span>
        </div>
        <span className="text-xs text-white/25 hidden sm:block">Shorts Queue</span>
      </div>

      {/* Debug badge */}
      <div
        className="mb-3 inline-flex flex-wrap items-center gap-1.5 px-2 py-1 rounded text-[10px] font-mono"
        style={{
          background: shouldAnimate
            ? 'rgba(34,197,94,0.12)'
            : 'rgba(239,68,68,0.12)',
          border: shouldAnimate
            ? '1px solid rgba(34,197,94,0.30)'
            : '1px solid rgba(239,68,68,0.30)',
          color: shouldAnimate ? '#22c55e' : '#ef4444',
        }}
      >
        motion:{shouldAnimate ? 'on' : 'off'} | reduce:{reduce ? 1 : 0} | mm:{mm ? 1 : 0} | phase:{phase}
      </div>

      <motion.div
        className="relative flex gap-3.5 overflow-x-auto pb-4 pt-2 -mx-1 px-1 isolate"
        variants={shouldAnimate ? listVariants : undefined}
        initial={shouldAnimate ? 'hidden' : false}
        animate={shouldAnimate ? phase : false}
      >
        {videos.map((video, i) => (
          <VideoCard
            key={video.id}
            video={video}
            index={i}
            shouldAnimate={shouldAnimate}
          />
        ))}
      </motion.div>
    </motion.div>
  )
}