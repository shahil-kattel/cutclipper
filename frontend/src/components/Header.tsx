import { motion } from 'framer-motion'
import type { AppStep } from '../types/api'
import { cn } from '../lib/utils'

const STEPS: Array<{ key: AppStep; label: string; short: string }> = [
  { key: 'link', label: 'Add video', short: 'Video' },
  { key: 'settings', label: 'Style clips', short: 'Style' },
  { key: 'processing', label: 'Render', short: 'Render' },
  { key: 'results', label: 'Download', short: 'Export' },
]

export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-[#070b18]',
        className,
      )}
    >
      <span className="absolute inset-0 rounded-xl bg-gradient-to-br from-cyan-400/20 via-violet-500/10 to-fuchsia-500/15" />
      <svg viewBox="0 0 32 32" className="relative h-5 w-5" aria-hidden="true">
        <defs>
          <linearGradient id="cutclipper-mark" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#61f5ff" />
            <stop offset="0.55" stopColor="#a98bff" />
            <stop offset="1" stopColor="#ff7ce2" />
          </linearGradient>
        </defs>
        <path
          d="M10 7v18M22 7v18M10 12.3l12 7.4M22 12.3l-12 7.4"
          fill="none"
          stroke="url(#cutclipper-mark)"
          strokeWidth="2.6"
          strokeLinecap="round"
        />
      </svg>
    </span>
  )
}

export function Header({ step }: { step: AppStep }) {
  const activeIndex = STEPS.findIndex((item) => item.key === step)
  return (
    <header className="sticky top-0 z-40 border-b border-white/[0.055] bg-[#04050c]/65 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-6 px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-2.5">
          <BrandMark />
          <div className="flex items-baseline gap-2">
            <span className="font-display text-[17px] font-semibold tracking-[-0.03em] text-white">
              CutClipper
            </span>
            <span className="hidden rounded border border-white/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.16em] text-slate-500 sm:inline">
              01
            </span>
          </div>
        </div>

        <nav aria-label="Progress" className="hidden items-center md:flex">
          {STEPS.map((item, index) => {
            const passed = index < activeIndex
            const active = index === activeIndex
            return (
              <div key={item.key} className="flex items-center">
                {index > 0 ? (
                  <span
                    className={cn(
                      'mx-2.5 h-px w-7 transition-colors duration-500',
                      index <= activeIndex ? 'bg-cyan-300/45' : 'bg-white/10',
                    )}
                    aria-hidden="true"
                  />
                ) : null}
                <div
                  className={cn(
                    'flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.13em] transition-colors',
                    active ? 'text-white' : passed ? 'text-slate-400' : 'text-slate-600',
                  )}
                  aria-current={active ? 'step' : undefined}
                >
                  <span
                    className={cn(
                      'flex h-5 w-5 items-center justify-center rounded-full border text-[9px] tabular-nums',
                      active
                        ? 'border-cyan-300/50 bg-cyan-300/10 text-cyan-200 shadow-glow-cyan'
                        : passed
                          ? 'border-cyan-300/20 bg-cyan-300/[0.045] text-cyan-300/70'
                          : 'border-white/10 text-slate-600',
                    )}
                  >
                    {passed ? '✓' : index + 1}
                  </span>
                  {item.label}
                </div>
              </div>
            )
          })}
        </nav>

        <div className="flex items-center gap-2.5">
          <span className="hidden items-center gap-2 rounded-full border border-white/[0.075] bg-white/[0.03] px-3 py-1.5 text-[10px] font-medium uppercase tracking-[0.16em] text-slate-400 sm:flex">
            <motion.span
              className="h-1.5 w-1.5 rounded-full bg-emerald-300"
              animate={{ opacity: [1, 0.35, 1] }}
              transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
            />
            No watermark
          </span>
          <span className="text-[11px] font-medium tabular-nums text-slate-500 md:hidden">
            {Math.max(1, activeIndex + 1)}/{STEPS.length} · {STEPS[Math.max(0, activeIndex)]?.short}
          </span>
        </div>
      </div>
      <div className="h-px w-full overflow-hidden bg-white/[0.04] md:hidden">
        <motion.div
          className="h-px bg-gradient-to-r from-cyan-300 to-violet-400"
          animate={{ width: `${(Math.max(1, activeIndex + 1) / STEPS.length) * 100}%` }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        />
      </div>
    </header>
  )
}
