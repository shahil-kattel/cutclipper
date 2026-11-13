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
import { cn, formatDuration, pluralize } from '../lib/utils'
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

const CAPTION_PIPELINE: Array<{
  stage: JobStage
  label: string
  detail: string
  icon: LucideIcon
}> = [
  { stage: 'fetching', label: 'Preparing', detail: 'Your uploaded video', icon: Download },
  {
    stage: 'transcribing',
    label: 'Transcribing',
    detail: 'Speech → editable captions',
    icon: AudioLines,
  },
  { stage: 'captioning', label: 'Animating', detail: 'Font, preset, and timing', icon: Captions },
  { stage: 'rendering', label: 'Rendering', detail: 'Burning captions · H.264', icon: Film },
  { stage: 'packaging', label: 'Packaging', detail: 'MP4 download', icon: PackageCheck },
]

const RESTYLE_CLIP_PIPELINE: Array<{
  stage: JobStage
  label: string
  detail: string
  icon: LucideIcon
}> = [
  {
    stage: 'reframing',
    label: 'Restyling the cut',
    detail: 'Same clip plan · fresh caption layer',
    icon: Captions,
  },
  {
    stage: 'rendering',
    label: 'Rendering',
    detail: 'H.264 + AAC · brand-new export',
    icon: Film,
  },
  {
    stage: 'packaging',
    label: 'Packaging',
    detail: 'Fresh ZIP and preview art',
    icon: PackageCheck,
  },
]

const RESTYLE_CAPTION_PIPELINE: Array<{
  stage: JobStage
  label: string
  detail: string
  icon: LucideIcon
}> = [
  {
    stage: 'captioning',
    label: 'Restyling captions',
    detail: 'New preset, font, and timing',
    icon: Captions,
  },
  {
    stage: 'rendering',
    label: 'Rendering',
    detail: 'H.264 + AAC · brand-new export',
    icon: Film,
  },
  {
    stage: 'packaging',
    label: 'Packaging',
    detail: 'Fresh download ready to check',
    icon: PackageCheck,
  },
]

// Stages that share a manifest row with another stage.
const STAGE_ROW_ALIAS: Partial<Record<JobStage, JobStage>> = {
  queued: 'fetching',
  probing: 'fetching',
  captioning: 'reframing',
}

interface ProcessingStepProps {
  job: Job | null
  connection: StreamConnection
  cancelling: boolean
  generating: boolean
  onCancel: () => void
  onBack: () => void
  onRetry: () => void
  canRetry?: boolean
  onStartOver: () => void
  onBackToPrevious?: () => void
}

export function ProcessingStep({
  job,
  connection,
  cancelling,
  generating,
  onCancel,
  onBack,
  onRetry,
  canRetry = true,
  onStartOver,
  onBackToPrevious,
}: ProcessingStepProps) {
  const [elapsed, setElapsed] = useState(0)
  const terminalFailure = job?.status === 'failed' || job?.status === 'cancelled'
  const captionJob = job?.mode === 'captions'
  const restyleJob = job?.is_restyle === true
  const captionsOn = captionJob || job?.settings.captions.enabled !== false
  const basePipeline = restyleJob
    ? captionJob
      ? RESTYLE_CAPTION_PIPELINE
      : RESTYLE_CLIP_PIPELINE
    : captionJob
      ? CAPTION_PIPELINE
      : PIPELINE
  // A clips-only export never enters the captioning stage, so drop that row
  // instead of showing a step that will stay untouched.
  const pipeline =
    restyleJob || captionJob || captionsOn
      ? basePipeline
      : basePipeline.filter((row) => row.stage !== 'captioning')
  const progress = job?.progress ?? 0
  const isComplete = job?.status === 'completed'
  const stage = job?.stage ?? 'queued'
  const directIndex = pipeline.findIndex((row) => row.stage === stage)
  const alias = STAGE_ROW_ALIAS[stage as JobStage]
  const aliasIndex = alias ? pipeline.findIndex((row) => row.stage === alias) : -1
  const currentIndex = isComplete
    ? pipeline.length
    : directIndex >= 0
      ? directIndex
      : aliasIndex >= 0
        ? aliasIndex
        : 0

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
        canRetry={canRetry}
        onStartOver={onStartOver}
        onBackToPrevious={onBackToPrevious}
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
    <div className="mx-auto max-w-7xl">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="mb-7 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"
      >
        <div>
          <div className="flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-tomato opacity-40" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-tomato" />
            </span>
            <p className="text-[9.5px] font-bold uppercase tracking-[0.18em] text-tomato">
              {restyleJob ? 'Caption refresh' : 'Render stream'} · {connectionLabel}
            </p>
          </div>
          <div className="mt-2 flex flex-wrap items-end gap-x-4">
            <h1 className="font-display text-4xl font-semibold tracking-[-0.05em] text-ink sm:text-[2.8rem]">
              {isComplete
                ? 'Final touches.'
                : restyleJob
                  ? 'Refreshing your captions.'
                  : 'Cutting your moments.'}
            </h1>
            <span className="mb-1.5 hidden -rotate-2 font-hand text-[18px] text-ink-soft sm:inline">
              {isComplete
                ? 'almost there'
                : restyleJob
                  ? 'same cut, new look'
                  : 'the scissors are busy'}
            </span>
          </div>
          <p className="mt-2 max-w-xl text-sm leading-6 text-ink-soft">
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
          className="paper-card taped relative overflow-hidden p-6"
        >
          <div className="paper-dots pointer-events-none absolute left-1/2 top-1/2 h-64 w-64 -translate-x-1/2 -translate-y-1/2 rounded-full opacity-20" />
          <div className="relative flex flex-col items-center">
            <ProgressRing progress={ringProgress} stage={job?.stage_label ?? 'Starting'} />
            <div className="mt-5 flex items-center gap-2 text-[11px] text-ink-soft">
              <span className="h-1.5 w-1.5 rounded-full border border-ink bg-tomato" />
              {isComplete ? 'Encoding finished' : (job?.message ?? 'Waiting for a worker')}
            </div>
            <div className="mt-5 grid w-full grid-cols-2 gap-2">
              <MiniStat label="Clips ready" value={String(job?.clips.length ?? 0)} />
              <MiniStat
                label="Source"
                value={job?.video ? formatDuration(job.video.duration) : '—'}
              />
            </div>
            <div className="mt-5 w-full border-t border-dashed border-ink/20 pt-4">
              {job?.can_cancel ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onCancel}
                  loading={cancelling}
                  icon={X}
                  className="w-full text-ink-soft hover:text-tomato"
                >
                  {cancelling ? 'Cancelling' : 'Cancel render'}
                </Button>
              ) : (
                <div className="flex items-center justify-center gap-2 py-2 text-[11px] text-ink-soft">
                  <Check className="h-3.5 w-3.5 text-teal" aria-hidden="true" />
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
          className="glass relative overflow-hidden rounded-2xl bg-paper-soft"
        >
          <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-mustard-soft/70" />
          <div className="relative flex h-full flex-col">
            <div className="flex items-center justify-between gap-4 border-b border-dashed border-ink/20 px-5 py-4 sm:px-6">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-ink-soft">
                  Processing manifest
                </p>
                <p className="mt-1 font-display text-[15px] font-semibold tracking-[-0.02em] text-ink">
                  {isComplete ? 'All stages complete' : (job?.stage_label ?? 'Getting ready')}
                </p>
              </div>
              <span className="font-display text-2xl font-semibold tabular-nums text-ink">
                {Math.round(ringProgress)}
                <span className="ml-0.5 text-xs text-ink-faint">%</span>
              </span>
            </div>

            <div className="flex-1 px-4 py-3 sm:px-5">
              {pipeline.map(({ stage, label, detail, icon: Icon }, index) => {
                const done = index < currentIndex || isComplete
                const active = index === currentIndex && !isComplete
                const stepDetail =
                  !captionJob && stage === 'fetching' && job?.video?.source === 'Upload'
                    ? 'Using your uploaded file'
                    : detail
                return (
                  <div
                    key={stage}
                    className={cn(
                      'relative flex items-center gap-3.5 rounded-xl px-2 py-2.5 transition-colors',
                      active && 'border border-dashed border-ink/25 bg-mustard-soft/55',
                    )}
                  >
                    {index < pipeline.length - 1 ? (
                      <span
                        className={cn(
                          'absolute left-[1.37rem] top-[2.65rem] h-[calc(100%-1.85rem)] w-px',
                          done ? 'bg-teal/50' : 'bg-ink/15',
                        )}
                        aria-hidden="true"
                      />
                    ) : null}
                    <span
                      className={cn(
                        'relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border transition duration-300',
                        done
                          ? 'border-ink/30 bg-teal-soft text-teal'
                          : active
                            ? 'border-[1.5px] border-ink bg-mustard text-ink shadow-[2px_2px_0_#211d19]'
                            : 'border-ink/20 bg-paper text-ink-faint',
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
                            active ? 'text-ink' : done ? 'text-ink-soft' : 'text-ink-faint',
                          )}
                        >
                          {label}
                        </p>
                        <p
                          className={cn(
                            'mt-0.5 truncate text-[10.5px]',
                            active ? 'text-ink-soft' : 'text-ink-faint',
                          )}
                        >
                          {stepDetail}
                        </p>
                      </div>
                      {active ? (
                        <span className="shrink-0 rounded border border-ink bg-mustard px-2 py-0.5 text-[8px] font-bold uppercase tracking-[0.13em] text-ink shadow-[1px_1px_0_#211d19]">
                          Working
                        </span>
                      ) : done ? (
                        <span className="shrink-0 text-[9px] font-medium uppercase tracking-[0.13em] text-ink-faint">
                          Done
                        </span>
                      ) : null}
                    </div>
                  </div>
                )
              })}
            </div>

            <div className="border-t border-dashed border-ink/20 px-5 py-3.5 sm:px-6">
              <AnimatePresence mode="wait">
                <motion.p
                  key={job?.message ?? 'waiting'}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.2 }}
                  className="truncate text-[11px] text-ink-soft"
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
        className="mt-5 flex -rotate-[0.3deg] flex-col items-center justify-between gap-3 rounded-xl border-[1.5px] border-ink bg-mustard-soft px-4 py-3 text-[10.5px] font-medium text-ink shadow-[2px_3px_0_#211d19] sm:flex-row"
      >
        <span className="inline-flex items-center gap-2">
          <Sparkles className="h-3.5 w-3.5 text-tomato" aria-hidden="true" />
          {restyleJob
            ? 'Only the caption layer is re-rendering. Your original cut stays fixed.'
            : 'Rendering runs on the server — close this tab or switch apps if you need to. We will keep going.'}
        </span>
        <span className="tabular-nums">
          {job?.clips.length ?? 0} {pluralize(job?.clips.length ?? 0, 'clip')} encoded
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
      <div className="absolute inset-3 rounded-full border-[1.5px] border-dashed border-ink/20 [animation:spin_24s_linear_infinite]" />
      <div className="absolute inset-0 rounded-full bg-[radial-gradient(circle,rgba(242,190,79,0.2),transparent_67%)]" />
      <svg viewBox="0 0 200 200" className="absolute inset-0 h-full w-full -rotate-90">
        <defs>
          <linearGradient id="progress-gradient" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#b8442f" />
            <stop offset="0.55" stopColor="#f2be4f" />
            <stop offset="1" stopColor="#32695b" />
          </linearGradient>
          <filter id="progress-glow" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="2.4" result="blur" />
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
        <span className="font-display text-[2.65rem] font-semibold tabular-nums leading-none tracking-[-0.06em] text-ink">
          {Math.round(progress)}
          <span className="ml-1 text-sm font-normal text-ink-soft">%</span>
        </span>
        <span className="mt-2 max-w-[8.5rem] truncate text-center text-[10px] font-semibold uppercase tracking-[0.17em] text-ink-soft">
          {stage}
        </span>
      </div>
      <span
        className="absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-ink bg-tomato shadow-[1px_1px_0_#211d19] transition-all duration-700"
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
    <div className="paper-inset px-3 py-2.5 text-center">
      <p className="font-display text-lg font-semibold tabular-nums leading-none text-ink">
        {value}
      </p>
      <p className="mt-1.5 text-[9px] font-medium uppercase tracking-[0.13em] text-ink-faint">
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
  canRetry,
  onStartOver,
  onBackToPrevious,
}: {
  job: Job
  generating: boolean
  onBack: () => void
  onRetry: () => void
  canRetry: boolean
  onStartOver: () => void
  onBackToPrevious?: () => void
}) {
  const cancelled = job.status === 'cancelled'
  return (
    <div className="paper-card taped mx-auto my-8 flex min-h-[60vh] max-w-xl -rotate-[0.4deg] flex-col items-center justify-center px-6 py-10 text-center sm:px-8">
      <motion.div
        initial={{ opacity: 0, scale: 0.92 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
        className={cn(
          'relative flex h-24 w-24 -rotate-2 items-center justify-center rounded-2xl border-[1.5px] border-ink shadow-[3px_4px_0_#211d19]',
          cancelled ? 'bg-paper-deep' : 'bg-tomato-soft',
        )}
      >
        <div className={cn('paper-dots absolute inset-3 rounded-xl opacity-30')} />
        {cancelled ? (
          <X className="relative h-8 w-8 text-ink-soft" aria-hidden="true" />
        ) : (
          <TriangleAlert className="relative h-8 w-8 text-tomato" aria-hidden="true" />
        )}
      </motion.div>
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1, duration: 0.4 }}
      >
        <p className="mt-6 text-[9.5px] font-bold uppercase tracking-[0.18em] text-tomato">
          {cancelled ? 'Render cancelled' : 'Pipeline stopped'}
        </p>
        <h1 className="mt-2 font-display text-4xl font-semibold tracking-[-0.05em] text-ink">
          {cancelled ? 'That cut is over.' : "That cut didn't land."}
        </h1>
        <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-ink-soft">
          {cancelled
            ? 'The render stopped before completion. Your source and settings are still here if you want to try again.'
            : job.error_message ||
              'The render stopped unexpectedly. Try again, or adjust your clip settings.'}
        </p>
        {job.error_code ? (
          <p className="mt-3 text-[10px] font-medium uppercase tracking-[0.14em] text-ink-faint">
            {job.error_code.replace(/_/g, ' ')}
          </p>
        ) : null}
        <div className="mt-7 flex flex-col justify-center gap-3 sm:flex-row">
          {canRetry ? (
            <Button onClick={onRetry} loading={generating} icon={RefreshCw} disabled={generating}>
              {cancelled ? 'Resume with same settings' : 'Try again'}
            </Button>
          ) : null}
          <Button variant="secondary" onClick={onBack} icon={ArrowLeft} disabled={generating}>
            Back to settings
          </Button>
          <Button variant="ghost" onClick={onStartOver} disabled={generating}>
            New link
          </Button>
        </div>
        {onBackToPrevious ? (
          <button
            type="button"
            onClick={onBackToPrevious}
            className="mt-4 inline-flex items-center gap-1.5 text-[10.5px] font-semibold text-ink-soft underline decoration-dashed underline-offset-4 transition hover:text-tomato"
          >
            Back to the previous finished export
          </button>
        ) : null}
        {!cancelled && !job.retryable ? (
          <p className="mt-4 text-[11px] text-ink-faint">
            This error may be caused by the source link. Try a different URL or adjust your
            settings.
          </p>
        ) : null}
      </motion.div>
    </div>
  )
}
