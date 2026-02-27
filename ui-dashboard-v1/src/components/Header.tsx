import { useEffect, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'

function StatusDot({ label, status }: { label: string; status: 'ok' | 'warn' | 'error' }) {
    const colorMap = {
        ok: { dot: 'bg-emerald-400', ping: 'bg-emerald-400' },
        warn: { dot: 'bg-amber-400', ping: 'bg-amber-400' },
        error: { dot: 'bg-red-400', ping: 'bg-red-400' },
    }
    const c = colorMap[status]
    return (
        <div className="flex items-center gap-2">
            <span className="relative flex items-center justify-center w-2.5 h-2.5">
                <span className={`absolute inline-flex h-full w-full rounded-full opacity-70 ${c.ping} ping-ring`} />
                <span className={`relative inline-flex rounded-full w-2 h-2 ${c.dot}`} />
            </span>
            <span className="text-xs text-white/40 hidden sm:block tracking-wide">{label}</span>
        </div>
    )
}

interface HeaderProps {
    apiOnline?: boolean
}

export default function Header({ apiOnline = false }: HeaderProps) {
    const navigate = useNavigate()
    const location = useLocation()
    const [clock, setClock] = useState(new Date())

    useEffect(() => {
        const t = setInterval(() => setClock(new Date()), 1_000)
        return () => clearInterval(t)
    }, [])

    const isHome = location.pathname === '/'

    return (
        <header className="sticky top-0 z-50 px-4 py-3 header-glass hairline">
            <div className="w-full flex items-center gap-4">

                {/* Logo — clickable to home */}
                <button
                    onClick={() => navigate('/')}
                    className="flex items-center gap-2.5 shrink-0 bg-transparent border-none cursor-pointer p-0"
                >
                    <div className="w-8 h-8 rounded-xl flex items-center justify-center text-sm bg-gradient-to-br from-cyan-500/10 to-purple-500/10 border border-cyan-400/20">
                        ⚡
                    </div>
                    <div className="hidden sm:block text-left">
                        <p className="text-[10px] text-white/35 leading-none mb-0.5 tracking-widest uppercase tabular">Antigravity</p>
                        <p className="text-sm font-semibold text-white/90 leading-none tracking-tight">AI_SYSTEM</p>
                    </div>
                </button>

                {/* Nav links */}
                {!isHome && (
                    <button
                        onClick={() => navigate('/')}
                        className="text-[11px] text-white/40 hover:text-white/70 transition-colors px-2 py-1 rounded bg-white/5 border border-white/8"
                    >
                        ← Dashboard
                    </button>
                )}

                {/* Status dots */}
                <div className="flex flex-1 items-center justify-center gap-3 sm:gap-5">
                    <StatusDot label="Server" status="ok" />
                    <StatusDot label="API" status={apiOnline ? 'ok' : 'error'} />
                    <StatusDot label="Deploy" status="ok" />
                    <div className="w-px h-4 bg-white/10 hidden sm:block" />
                    <span className="text-xs text-white/25 hidden sm:block tabular">
                        {clock.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </span>
                </div>

                {/* n8n */}
                <a
                    href="https://n8n.noa-on.com/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ml-auto shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-white/50 bg-white/5 border border-white/10 hover:bg-white/10 hover:border-white/20 hover:text-white/90 transition-all duration-200 focus-ring"
                >
                    n8n
                    <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                        <path d="M1 9L9 1M9 1H3.5M9 1V6.5" />
                    </svg>
                </a>

            </div>
        </header>
    )
}
