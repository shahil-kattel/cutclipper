import { useEffect, useState, type CSSProperties } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  ArrowLeft,
  AudioLines,
  Captions,
  Check,
  Download,
  Film,
  PackageCheck,
  RefreshCw,
  ScanFace,
  Sparkles,
  TriangleAlert,
  WifiOff,
  X,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { Job, JobStage } from '../types/api'
import type { StreamConnection } from '../hooks/useJobStream'
import { cn, formatDuration } from '../lib/utils'
import { Button, Pill } from './ui'

const PIPELINE: Array<{ stage: JobStage; label: string; detail: string; icon: LucideIcon }> = [
  {
    stage: 'fetching',
    label: 'Fetching',
    detail: 'Secure download at up to 1080p',
    icon: Download,
  },
  {
    stage: 'transcribing',
    label: 'Transcribing',
    detail: 'Word-level speech timing',
    icon: AudioLines,
  },
  {
    stage: 'finding_highlights',
    label: 'Finding highlights',
    detail: 'Scenes · energy · sentence edges',
    icon: Sparkles,
  },
  { stage: 'reframing', label: 'Reframing', detail: '9:16 face-aware crop', icon: ScanFace },
  {
    stage: 'captioning',
    label: 'Captioning',
    detail: 'Building timed ASS overlays',
    icon: Captions,
  },
  { stage: 'rendering', label: 'Rendering', detail: 'H.264 + AAC · faststart', icon: Film },
  { stage: 'packaging', label: 'Packaging', detail: 'ZIP and preview art', icon: PackageCheck },
]

const STAGE_INDEX: Record<string, number> = {
  queued: 0,
  fetching: 0,
  probing: 0,
  transcribing: 1,
  finding_highlights: 2,
  reframing: 3,
  captioning: 4,
  rendering: 5,
  packaging: 6,
  complete: 7,
  failed: 0,
  cancelled: 0,
}

interface ProcessingStepProps {
  job: Job | null
  connection: StreamConnection
  cancelling: boolean
  generating: boolean
  onCancel: () => void
  onBack: () => void
  onRetry: () => void
  onStartOver: () => void
}

export function ProcessingStep({
  job,
  connection,
  cancelling,
  generating,
  onCancel,
  onBack,
  onRetry,
  onStartOver,
}: ProcessingStepProps) {
  const [elapsed, setElapsed] = useState(0)
  const terminalFailure = job?.status === 'failed' || job?.status === 'cancelled'
  const currentIndex = Math.min(PIPELINE.length, STAGE_INDEX[job?.stage ?? 'queued'] ?? 0)
  const progress = job?.progress ?? 0
  const isComplete = job?.status === 'completed'

  useEffect(() => {
    if (!job?.created_at) return
    const startedAt = new Date(job.created_at).getTime()
    const tick = () => {
      setElapsed(Math.max(0, (Date.now() - startedAt) / 1000))
    }
    tick()
    const timer = window.setInterval(tick, 1000)
    return () => window.clearInterval(timer)
  }, [job?.created_at, job?.id])

  if (terminalFailure) {
    return (
      <FailureState
        job={job}
        generating={generating}
        onBack={onBack}
        onRetry={onRetry}
        onStartOver={onStartOver}
      />
    )
  }

  const ringProgress = isComplete ? 100 : progress
  const connectionLabel =
    connection === 'live'
      ? 'Live'
      : connection === 'polling'
        ? 'Reconnecting'
        : connection === 'offline'
          ? 'Connection lost'
          : 'Starting'

  return (
    <div className="mx-auto max-w-5xl">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="mb-7 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"
      >
        <div>
          <div className="flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-cyan-300 opacity-40" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-cyan-300" />
            </span>
            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-cyan-300/75">
              Render stream · {connectionLabel}
            </p>
          </div>
          <h1 className="mt-2 font-display text-3xl font-semibold tracking-[-0.045em] text-white sm:text-[2.5rem]">
            {isComplete ? 'Final touches.' : 'Cutting your moments.'}
          </h1>
          <p className="mt-2 max-w-xl text-sm leading-6 text-slate-400">
            {job?.video?.title ?? 'Your video is moving through the CutClipper pipeline.'}
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          <Pill tone="cyan" className="tabular-nums">
            {Math.floor(elapsed / 60)}:{String(Math.floor(elapsed % 60)).padStart(2, '0')} elapsed
          </Pill>
          <Pill
            tone={
              connection === 'live' ? 'success' : connection === 'offline' ? 'danger' : 'default'
            }
          >
            {connection === 'offline' ? (
              <WifiOff className="h-3 w-3" aria-hidden="true" />
            ) : (
              <span className="h-1.5 w-1.5 rounded-full bg-current" />
            )}
            {connectionLabel}
          </Pill>
        </div>
      </motion.div>

      <div className="grid gap-4 lg:grid-cols-[21rem_minmax(0,1fr)] lg:gap-5">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55, delay: 0.04, ease: [0.22, 1, 0.36, 1] }}
          className="glass relative overflow-hidden rounded-2xl p-6"
        >
          <div className="pointer-events-none absolute left-1/2 top-1/2 h-64 w-64 -translate-x-1/2 -translate-y-1/2 rounded-full bg-cyan-300/[0.055] blur-[70px]" />
          <div className="relative flex flex-col items-center">
            <ProgressRing progress={ringProgress} stage={job?.stage_label ?? 'Starting'} />
            <div className="mt-5 flex items-center gap-2 text-[11px] text-slate-500">
              <span className="h-1.5 w-1.5 rounded-full bg-violet-300 shadow-[0_0_8px_rgba(155,109,255,0.8)]" />
              {isComplete ? 'Encoding finished' : (job?.message ?? 'Waiting for a worker')}
            </div>
            <div className="mt-5 grid w-full grid-cols-2 gap-2">
              <MiniStat label="Clips ready" value={String(job?.clips.length ?? 0)} />
              <MiniStat
                label="Source"
                value={job?.video ? formatDuration(job.video.duration) : '—'}
              />
            </div>
            <div className="mt-5 w-full border-t border-white/[0.055] pt-4">
              {job?.can_cancel ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onCancel}
                  loading={cancelling}
                  icon={X}
                  className="w-full text-slate-400 hover:text-rose-200"
                >
                  {cancelling ? 'Cancelling' : 'Cancel render'}
                </Button>
              ) : (
                <div className="flex items-center justify-center gap-2 py-2 text-[11px] text-slate-500">
                  <Check className="h-3.5 w-3.5 text-emerald-300" aria-hidden="true" />
                  {isComplete ? 'Ready to download' : 'Saving your progress'}
                </div>
              )}
            </div>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
          className="glass relative overflow-hidden rounded-2xl"
        >
          <div className="absolute inset-x-0 top-0 h-40 bg-[radial-gradient(ellipse_at_70%_-20%,rgba(155,109,255,0.16),transparent_65%)]" />
          <div className="relative flex h-full flex-col">
            <div className="flex items-center justify-between gap-4 border-b border-white/[0.055] px-5 py-4 sm:px-6">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">
                  Processing manifest
                </p>
                <p className="mt-1 font-display text-[15px] font-semibold tracking-[-0.02em] text-white">
                  {isComplete ? 'All stages complete' : (job?.stage_label ?? 'Getting ready')}
                </p>
              </div>
              <span className="font-display text-2xl font-semibold tabular-nums text-white">
                {Math.round(ringProgress)}
                <span className="ml-0.5 text-xs text-slate-600">%</span>
              </span>
            </div>

            <div className="flex-1 px-4 py-3 sm:px-5">
              {PIPELINE.map(({ stage, label, detail, icon: Icon }, index) => {
                const done = index < currentIndex || isComplete
                const active = index === currentIndex && !isComplete
                const stepDetail =
                  stage === 'fetching' && job?.video?.source === 'Upload'
                    ? 'Using your uploaded file'
                    : detail
                return (
                  <div
                    key={stage}
                    className={cn(
                      'relative flex items-center gap-3.5 rounded-xl px-2 py-2.5 transition-colors',
                      active && 'bg-white/[0.035]',
                    )}
                  >
                    {index < PIPELINE.length - 1 ? (
                      <span
                        className={cn(
                          'absolute left-[1.37rem] top-[2.65rem] h-[calc(100%-1.85rem)] w-px',
                          done ? 'bg-cyan-300/30' : 'bg-white/[0.075]',
                        )}
                        aria-hidden="true"
                      />
                    ) : null}
                    <span
                      className={cn(
                        'relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border transition duration-300',
                        done
                          ? 'border-cyan-300/20 bg-cyan-300/[0.08] text-cyan-200'
                          : active
                            ? 'border-violet-300/30 bg-violet-300/10 text-violet-100 shadow-[0_0_22px_-8px_rgba(155,109,255,0.7)]'
                            : 'border-white/[0.07] bg-white/[0.02] text-slate-600',
                      )}
                    >
                      {done ? (
                        <Check className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden="true" />
                      ) : active ? (
                        <motion.span
                          animate={{ rotate: 360 }}
                          transition={{ duration: 3.5, repeat: Infinity, ease: 'linear' }}
                          className="flex h-full w-full items-center justify-center"
                        >
                          <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                        </motion.span>
                      ) : (
                        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                      )}
                    </span>
                    <div className="flex min-w-0 flex-1 items-baseline justify-between gap-3">
                      <div className="min-w-0">
                        <p
                          className={cn(
                            'text-[12.5px] font-medium transition-colors',
                            active ? 'text-white' : done ? 'text-slate-300' : 'text-slate-600',
                          )}
                        >
                          {label}
                        </p>
                        <p
                          className={cn(
                            'mt-0.5 truncate text-[10.5px]',
                            active ? 'text-slate-400' : 'text-slate-600',
                          )}
                        >
                          {stepDetail}
                        </p>
                      </div>
                      {active ? (
                        <span className="shrink-0 rounded-full border border-violet-300/20 bg-violet-300/[0.07] px-2 py-0.5 text-[8px] font-semibold uppercase tracking-[0.14em] text-violet-200">
                          Working
                        </span>
                      ) : done ? (
                        <span className="shrink-0 text-[9px] font-medium uppercase tracking-[0.13em] text-slate-600">
                          Done
                        </span>
                      ) : null}
                    </div>
                  </div>
                )
              })}
            </div>

            <div className="border-t border-white/[0.055] px-5 py-3.5 sm:px-6">
              <AnimatePresence mode="wait">
                <motion.p
                  key={job?.message ?? 'waiting'}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.2 }}
                  className="truncate text-[11px] text-slate-500"
                  aria-live="polite"
                >
                  {job?.message ?? 'Waiting for the worker to pick up your job…'}
                </motion.p>
              </AnimatePresence>
            </div>
          </div>
        </motion.div>
      </div>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.4, duration: 0.5 }}
        className="mt-5 flex flex-col items-center justify-between gap-3 rounded-xl border border-white/[0.055] bg-white/[0.018] px-4 py-3 text-[11px] text-slate-500 sm:flex-row"
      >
        <span className="inline-flex items-center gap-2">
          <Sparkles className="h-3.5 w-3.5 text-violet-300/70" aria-hidden="true" />
          Rendering can take a few minutes on longer videos. Keep this tab open.
        </span>
        <span className="tabular-nums">
          {job?.clips.length ?? 0} of {job?.settings.clip_count ?? 0} clips encoded
        </span>
      </motion.div>
    </div>
  )
}

function ProgressRing({ progress, stage }: { progress: number; stage: string }) {
  const radius = 82
  const circumference = 2 * Math.PI * radius
  const offset = circumference * (1 - Math.max(0, Math.min(100, progress)) / 100)
  return (
    <div
      className="relative h-56 w-56"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(progress)}
      aria-label={`${stage}: ${Math.round(progress)} percent`}
    >
      <div className="absolute inset-3 rounded-full border border-dashed border-white/[0.065] [animation:spin_24s_linear_infinite]" />
      <div className="absolute inset-0 rounded-full bg-[radial-gradient(circle,rgba(155,109,255,0.1),transparent_67%)]" />
      <svg viewBox="0 0 200 200" className="absolute inset-0 h-full w-full -rotate-90">
        <defs>
          <linearGradient id="progress-gradient" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#2ce8ff" />
            <stop offset="0.55" stopColor="#9b6dff" />
            <stop offset="1" stopColor="#ff4fd8" />
          </linearGradient>
          <filter id="progress-glow" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <circle cx="100" cy="100" r={radius} fill="none" strokeWidth="5" className="ring-track" />
        <motion.circle
          cx="100"
          cy="100"
          r={radius}
          fill="none"
          stroke="url(#progress-gradient)"
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={circumference}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
          filter="url(#progress-glow)"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-display text-[2.65rem] font-semibold tabular-nums leading-none tracking-[-0.06em] text-white">
          {Math.round(progress)}
          <span className="ml-1 text-sm font-normal text-slate-500">%</span>
        </span>
        <span className="mt-2 max-w-[8.5rem] truncate text-center text-[10px] font-semibold uppercase tracking-[0.17em] text-slate-500">
          {stage}
        </span>
      </div>
      <span
        className="absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-cyan-200 shadow-[0_0_14px_rgba(44,232,255,0.9)] transition-all duration-700"
        style={
          {
            left: `${50 + 41 * Math.cos((-90 + 3.6 * progress) * (Math.PI / 180))}%`,
            top: `${50 + 41 * Math.sin((-90 + 3.6 * progress) * (Math.PI / 180))}%`,
          } as CSSProperties
        }
      />
    </div>
  )
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/[0.065] bg-white/[0.025] px-3 py-2.5 text-center">
      <p className="font-display text-lg font-semibold tabular-nums leading-none text-white">
        {value}
      </p>
      <p className="mt-1.5 text-[9px] font-medium uppercase tracking-[0.13em] text-slate-600">
        {label}
      </p>
    </div>
  )
}

function FailureState({
  job,
  generating,
  onBack,
  onRetry,
  onStartOver,
}: {
  job: Job
  generating: boolean
  onBack: () => void
  onRetry: () => void
  onStartOver: () => void
}) {
  const cancelled = job.status === 'cancelled'
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-xl flex-col items-center justify-center py-10 text-center">
      <motion.div
        initial={{ opacity: 0, scale: 0.92 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
        className={cn(
          'relative flex h-24 w-24 items-center justify-center rounded-full border',
          cancelled
            ? 'border-slate-400/20 bg-slate-400/[0.05]'
            : 'border-rose-300/25 bg-rose-400/[0.07]',
        )}
      >
        <div
          className={cn(
            'absolute inset-4 rounded-full blur-xl',
            cancelled ? 'bg-slate-400/10' : 'bg-rose-400/20',
          )}
        />
        {cancelled ? (
          <X className="relative h-8 w-8 text-slate-300" aria-hidden="true" />
        ) : (
          <TriangleAlert className="relative h-8 w-8 text-rose-200" aria-hidden="true" />
        )}
      </motion.div>
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1, duration: 0.4 }}
      >
        <p className="mt-6 text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-500">
          {cancelled ? 'Render cancelled' : 'Pipeline stopped'}
        </p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-[-0.045em] text-white">
          {cancelled ? 'That cut is over.' : "That cut didn't land."}
        </h1>
        <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-slate-400">
          {cancelled
            ? 'The render stopped before completion. Your source and settings are still here if you want to try again.'
            : job.error_message ||
              'The render stopped unexpectedly. Try again, or adjust your clip settings.'}
        </p>
        {job.error_code ? (
          <p className="mt-3 text-[10px] font-medium uppercase tracking-[0.14em] text-slate-600">
            {job.error_code.replace(/_/g, ' ')}
          </p>
        ) : null}
        <div className="mt-7 flex flex-col justify-center gap-2.5 sm:flex-row">
          <Button onClick={onRetry} loading={generating} icon={RefreshCw} disabled={generating}>
            {cancelled ? 'Resume with same settings' : 'Try again'}
          </Button>
          <Button variant="secondary" onClick={onBack} icon={ArrowLeft} disabled={generating}>
            Back to settings
          </Button>
          <Button variant="ghost" onClick={onStartOver} disabled={generating}>
            New link
          </Button>
        </div>
        {!cancelled && !job.retryable ? (
          <p className="mt-4 text-[11px] text-slate-600">
            This error may be caused by the source link. Try a different URL or adjust your
            settings.
          </p>
        ) : null}
      </motion.div>
    </div>
  )
}
