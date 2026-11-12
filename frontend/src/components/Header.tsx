import { motion } from 'framer-motion'
import { Check, Scissors, Sparkles } from 'lucide-react'
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
        'relative flex h-9 w-9 shrink-0 -rotate-3 items-center justify-center rounded-[0.7rem] border-[1.5px] border-ink bg-mustard text-ink shadow-[2px_2px_0_#211d19]',
        className,
      )}
    >
      <Scissors className="relative h-[19px] w-[19px]" strokeWidth={2.4} aria-hidden="true" />
      <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full border border-ink bg-tomato" />
    </span>
  )
}

export function Header({ step, captionFlow = false }: { step: AppStep; captionFlow?: boolean }) {
  const steps = STEPS.map((item) =>
    item.key === 'settings' && captionFlow
      ? { ...item, label: 'Captions', short: 'Caption' }
      : item,
  )
  const activeIndex = step === 'caption' ? 1 : steps.findIndex((item) => item.key === step)
  return (
    <header className="sticky top-0 z-40 border-b-[1.5px] border-ink bg-paper/90 shadow-[0_3px_0_rgba(33,29,25,0.08)] backdrop-blur-md">
      <div className="mx-auto flex h-[4.5rem] max-w-7xl items-center justify-between gap-6 px-4 sm:px-6 lg:px-8">
        <a
          href="/"
          className="group flex items-center gap-2.5 rounded-lg"
          aria-label="CutClipper home"
        >
          <BrandMark className="transition-transform duration-200 group-hover:rotate-3" />
          <div className="flex items-baseline gap-2">
            <span className="font-display text-[20px] font-bold tracking-[-0.035em] text-ink">
              CutClipper
            </span>
            <span className="hidden rotate-2 rounded border border-ink/30 bg-paper-deep px-1.5 py-0.5 font-hand text-[13px] leading-none text-ink-soft sm:inline">
              paper cuts
            </span>
          </div>
        </a>

        <nav aria-label="Progress" className="hidden items-center md:flex">
          {steps.map((item, index) => {
            const passed = index < activeIndex
            const active = index === activeIndex
            return (
              <div key={item.key} className="flex items-center">
                {index > 0 ? (
                  <span
                    className={cn(
                      'mx-2.5 h-px w-6 border-t-[1.5px] border-dashed transition-colors',
                      index <= activeIndex ? 'border-ink/50' : 'border-ink/20',
                    )}
                    aria-hidden="true"
                  />
                ) : null}
                <div
                  className={cn(
                    'flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.1em] transition-all',
                    active
                      ? '-rotate-1 rounded-lg border-[1.5px] border-ink bg-mustard px-2.5 py-1.5 text-ink shadow-[2px_2px_0_#211d19]'
                      : passed
                        ? 'text-ink-soft'
                        : 'text-ink-faint',
                  )}
                  aria-current={active ? 'step' : undefined}
                >
                  <span
                    className={cn(
                      'flex h-5 w-5 items-center justify-center rounded-full border-[1.5px] text-[9px] tabular-nums',
                      active
                        ? 'border-ink bg-paper-soft text-ink'
                        : passed
                          ? 'border-teal bg-teal-soft text-teal'
                          : 'border-ink/25 text-ink-faint',
                    )}
                  >
                    {passed ? (
                      <Check className="h-3 w-3" strokeWidth={3} aria-hidden="true" />
                    ) : (
                      index + 1
                    )}
                  </span>
                  <span className="hidden whitespace-nowrap lg:inline">{item.label}</span>
                  <span className="whitespace-nowrap lg:hidden">{item.short}</span>
                </div>
              </div>
            )
          })}
        </nav>

        <div className="flex items-center gap-2.5">
          <span className="hidden rotate-2 items-center gap-1.5 rounded-md border-[1.5px] border-ink bg-paper-soft px-2.5 py-1.5 text-[9px] font-bold uppercase tracking-[0.13em] text-ink shadow-[2px_2px_0_#211d19] lg:flex">
            <motion.span
              className="text-tomato"
              animate={{ rotate: [0, 12, -8, 0] }}
              transition={{ duration: 4.2, repeat: Infinity, ease: 'easeInOut' }}
            >
              <Sparkles className="h-3 w-3" aria-hidden="true" />
            </motion.span>
            No watermark
          </span>
          <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-ink-soft md:hidden">
            {Math.max(1, activeIndex + 1)}/{steps.length} · {steps[Math.max(0, activeIndex)]?.short}
          </span>
        </div>
      </div>
      <div className="h-1 w-full overflow-hidden bg-paper-deep md:hidden">
        <motion.div
          className="h-full border-r-[1.5px] border-ink bg-tomato"
          animate={{ width: `${(Math.max(1, activeIndex + 1) / steps.length) * 100}%` }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        />
      </div>
    </header>
  )
}
