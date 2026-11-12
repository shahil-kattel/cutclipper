import { useState, type FormEvent } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import type { LucideIcon } from 'lucide-react'
import {
  ArrowRight,
  BadgeCheck,
  Captions,
  ClipboardPaste,
  Clock3,
  CloudUpload,
  Film,
  Link2,
  LoaderCircle,
  ScanFace,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  WandSparkles,
} from 'lucide-react'
import type { PreviewResponse } from '../types/api'
import { cn, formatDuration, sourceName } from '../lib/utils'
import { Button, Pill, Skeleton } from './ui'
import { useToast } from '../hooks/useToast'

export type SourceMode = 'link' | 'upload'

interface LinkStepProps {
  url: string
  mode: SourceMode
  onModeChange: (mode: SourceMode) => void
  onUrlChange: (value: string) => void
  onPreview: () => void
  onUploadFile: (file: File) => void
  onClearPreview: () => void
  onClearError: () => void
  onContinue: () => void
  preview: PreviewResponse | null
  loading: boolean
  uploading: { name: string; progress: number } | null
  error: string | null
  retryable: boolean
}

const VIDEO_FILE_PATTERN = /\.(mp4|m4v|mov|mkv|webm|avi|wmv|flv|ts|mts|m2ts|mpg|mpeg|3gp|ogv)$/i
const MAX_UPLOAD_BYTES = 3 * 1024 ** 3

const FEATURES = [
  {
    icon: ScanFace,
    title: 'Speaker-aware crops',
    copy: 'Smooth face tracking turns landscape footage into native-feeling 9:16.',
  },
  {
    icon: Captions,
    title: 'Word-perfect captions',
    copy: 'Whisper-level timing with karaoke, pop, typewriter, and minimal styles.',
  },
  {
    icon: BadgeCheck,
    title: 'Clean by default',
    copy: 'No watermarks, logos, paywalls, or hidden caps. Just your clips.',
  },
]

export function LinkStep({
  url,
  mode,
  onModeChange,
  onUrlChange,
  onPreview,
  onUploadFile,
  onClearPreview,
  onClearError,
  onContinue,
  preview,
  loading,
  uploading,
  error,
  retryable,
}: LinkStepProps) {
  const [touched, setTouched] = useState(false)
  const [pasting, setPasting] = useState(false)
  const [dragging, setDragging] = useState(false)
  const toast = useToast()

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setTouched(true)
    if (!url.trim() || loading) return
    onPreview()
  }

  const paste = async () => {
    setPasting(true)
    try {
      const text = await navigator.clipboard.readText()
      if (text.trim()) {
        onUrlChange(text.trim())
        setTouched(false)
      } else {
        toast.info('Your clipboard is empty.')
      }
    } catch {
      toast.info('Clipboard access was blocked. Paste the link with ⌘V or Ctrl+V.')
    } finally {
      setPasting(false)
    }
  }

  const chooseFile = (file: File | undefined | null) => {
    if (!file || uploading || loading) return
    const looksLikeVideo = file.type.startsWith('video/') || VIDEO_FILE_PATTERN.test(file.name)
    if (!looksLikeVideo) {
      toast.info('Choose a video file such as MP4, MOV, WebM, or MKV.')
      return
    }
    if (file.size === 0) {
      toast.info('That file is empty. Choose a video with content.')
      return
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      toast.info('That file is larger than the 3 GB upload limit.')
      return
    }
    onClearError()
    onUploadFile(file)
  }

  const empty = touched && !url.trim()

  return (
    <div className="relative mx-auto max-w-5xl">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.65, ease: [0.22, 1, 0.36, 1] }}
        className="mx-auto max-w-3xl text-center"
      >
        <div className="mb-6 flex justify-center">
          <Pill tone="cyan" className="gap-2 border-cyan-300/20 bg-cyan-300/[0.055] px-3 py-1.5">
            <Sparkles className="h-3 w-3" aria-hidden="true" />
            Link or upload → highlights → ready to post
          </Pill>
        </div>
        <h1 className="text-balance font-display text-[2.55rem] font-semibold leading-[0.98] tracking-[-0.065em] sm:text-6xl lg:text-[4.5rem]">
          Long video.
          <br />
          <span className="text-gradient">Clips that stop the scroll.</span>
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-pretty text-[15px] leading-7 text-slate-400 sm:text-base">
          Paste a public video link or upload a file from your computer. CutClipper finds the
          moments worth watching, reframes them to 9:16, and burns in kinetic captions — without a
          single watermark.
        </p>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 26 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.65, delay: 0.08, ease: [0.22, 1, 0.36, 1] }}
        className="mx-auto mt-10 max-w-3xl sm:mt-12"
      >
        <AnimatePresence mode="wait" initial={false}>
          {preview ? (
            <PreviewCard
              key={preview.upload_id ?? preview.normalized_url}
              preview={preview}
              onClear={onClearPreview}
              onContinue={onContinue}
            />
          ) : (
            <motion.div
              key="source-form"
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
              className="border-gradient rounded-2xl p-1 shadow-[0_35px_100px_-55px_rgba(64,96,255,0.8)]"
            >
              <div className="rounded-[0.95rem] bg-[#070b18]/95 p-2.5 sm:p-3">
                <div
                  role="tablist"
                  aria-label="Video source"
                  onKeyDown={(event) => {
                    if (
                      uploading ||
                      loading ||
                      !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)
                    ) {
                      return
                    }
                    event.preventDefault()
                    const next: SourceMode =
                      event.key === 'Home' || event.key === 'ArrowLeft' ? 'link' : 'upload'
                    onModeChange(next)
                    setTouched(false)
                    onClearError()
                    requestAnimationFrame(() => {
                      document
                        .getElementById(next === 'link' ? 'source-tab-link' : 'source-tab-upload')
                        ?.focus()
                    })
                  }}
                  className="mb-2.5 grid grid-cols-2 gap-1 rounded-xl border border-white/[0.05] bg-white/[0.025] p-1"
                >
                  <SourceTab
                    id="source-tab-link"
                    controls="source-panel-link"
                    active={mode === 'link'}
                    icon={Link2}
                    label="Paste a link"
                    disabled={Boolean(uploading) || loading}
                    onClick={() => {
                      onModeChange('link')
                      setTouched(false)
                      onClearError()
                    }}
                  />
                  <SourceTab
                    id="source-tab-upload"
                    controls="source-panel-upload"
                    active={mode === 'upload'}
                    icon={CloudUpload}
                    label="Upload a file"
                    disabled={Boolean(uploading) || loading}
                    onClick={() => {
                      onModeChange('upload')
                      setTouched(false)
                      onClearError()
                    }}
                  />
                </div>

                {mode === 'link' ? (
                  <form
                    id="source-panel-link"
                    role="tabpanel"
                    aria-labelledby="source-tab-link"
                    onSubmit={submit}
                  >
                    <label htmlFor="video-url" className="sr-only">
                      Video link
                    </label>
                    <div className="flex flex-col gap-2.5 sm:flex-row">
                      <div className="relative flex min-w-0 flex-1 items-center">
                        <Link2
                          className="pointer-events-none absolute left-4 h-[18px] w-[18px] text-slate-500"
                          aria-hidden="true"
                        />
                        <input
                          id="video-url"
                          name="url"
                          type="text"
                          inputMode="url"
                          autoComplete="url"
                          spellCheck={false}
                          value={url}
                          onChange={(event) => onUrlChange(event.target.value)}
                          onFocus={() => setTouched(false)}
                          placeholder="Paste any public video link"
                          aria-invalid={empty || Boolean(error)}
                          aria-describedby={error ? 'preview-error' : 'supported-sources'}
                          className="h-12 w-full rounded-xl border border-white/[0.075] bg-white/[0.035] pl-11 pr-[5.6rem] text-[14px] text-white transition placeholder:text-slate-600 focus:border-cyan-300/35 focus:bg-white/[0.05] focus:outline-none sm:h-[3.25rem] sm:text-[15px]"
                        />
                        <button
                          type="button"
                          onClick={paste}
                          disabled={pasting}
                          className="absolute right-2.5 inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-medium text-slate-400 transition hover:bg-white/[0.06] hover:text-white disabled:opacity-50"
                          aria-label="Paste link from clipboard"
                        >
                          <ClipboardPaste className="h-3.5 w-3.5" aria-hidden="true" />
                          Paste
                        </button>
                      </div>
                      <Button
                        type="submit"
                        size="lg"
                        loading={loading}
                        iconRight={loading ? undefined : ArrowRight}
                        disabled={!url.trim()}
                        className="h-12 shrink-0 sm:h-[3.25rem]"
                      >
                        {loading ? 'Reading video' : 'Analyze link'}
                      </Button>
                    </div>
                  </form>
                ) : (
                  <div id="source-panel-upload" role="tabpanel" aria-labelledby="source-tab-upload">
                    <div
                      onDragOver={(event) => {
                        if (uploading || loading) return
                        event.preventDefault()
                        setDragging(true)
                      }}
                      onDragLeave={() => setDragging(false)}
                      onDrop={(event) => {
                        event.preventDefault()
                        setDragging(false)
                        chooseFile(event.dataTransfer.files?.[0])
                      }}
                      className={cn(
                        'relative overflow-hidden rounded-xl border border-dashed px-4 py-7 text-center transition focus-within:border-cyan-300/50 focus-within:ring-2 focus-within:ring-cyan-300/30 sm:py-8',
                        dragging
                          ? 'border-cyan-300/45 bg-cyan-300/[0.055]'
                          : 'border-white/[0.11] bg-white/[0.02] hover:border-white/20 hover:bg-white/[0.032]',
                      )}
                    >
                      <input
                        id="video-file"
                        type="file"
                        accept="video/*,.mkv,.m4v,.mov,.webm,.avi,.wmv,.flv,.ts,.mts,.m2ts,.mpg,.mpeg,.3gp,.ogv"
                        className="sr-only"
                        disabled={Boolean(uploading) || loading}
                        onChange={(event) => {
                          chooseFile(event.target.files?.[0])
                          event.target.value = ''
                        }}
                      />
                      <label
                        htmlFor="video-file"
                        className={cn(
                          'group flex cursor-pointer flex-col items-center',
                          (uploading || loading) && 'pointer-events-none opacity-70',
                        )}
                      >
                        <span className="flex h-11 w-11 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.04] text-cyan-200 transition group-hover:border-cyan-300/30 group-hover:bg-cyan-300/[0.07]">
                          {uploading ? (
                            <LoaderCircle className="h-5 w-5 animate-spin" aria-hidden="true" />
                          ) : (
                            <CloudUpload className="h-5 w-5" aria-hidden="true" />
                          )}
                        </span>
                        <span className="mt-3 block max-w-full truncate font-display text-[14px] font-semibold tracking-[-0.01em] text-white">
                          {uploading
                            ? `Uploading ${uploading.name}`
                            : 'Choose a video or drop it here'}
                        </span>
                        <span className="mt-1 block text-[11.5px] text-slate-500">
                          {uploading
                            ? `${Math.round(uploading.progress * 100)}% · keep this tab open`
                            : 'MP4, MOV, WebM, MKV, AVI · up to 3 GB'}
                        </span>
                      </label>
                      {uploading ? (
                        <div
                          className="mx-auto mt-4 h-1.5 w-full max-w-sm overflow-hidden rounded-full bg-white/[0.07]"
                          role="progressbar"
                          aria-label="Upload progress"
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-valuenow={Math.round(uploading.progress * 100)}
                        >
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-violet-500 transition-[width] duration-300"
                            style={{ width: `${Math.max(3, uploading.progress * 100)}%` }}
                          />
                        </div>
                      ) : (
                        <span className="mt-3 inline-flex items-center gap-1.5 text-[10.5px] text-slate-600">
                          <ShieldCheck className="h-3 w-3" aria-hidden="true" />
                          Files stay on this server and auto-delete
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {loading && !uploading ? <PreviewSkeleton /> : null}

        <AnimatePresence>
          {error ? (
            <motion.div
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              id="preview-error"
              role="alert"
              className="mt-4 flex flex-col items-start gap-3 rounded-xl border border-rose-300/20 bg-rose-400/[0.06] px-4 py-3.5 text-sm text-rose-100 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex items-start gap-2.5">
                <TriangleAlert
                  className="mt-0.5 h-4 w-4 shrink-0 text-rose-300"
                  aria-hidden="true"
                />
                <p className="leading-relaxed">{error}</p>
              </div>
              {retryable && url.trim() ? (
                <Button variant="secondary" size="sm" onClick={onPreview} loading={loading}>
                  Try again
                </Button>
              ) : null}
            </motion.div>
          ) : null}
        </AnimatePresence>

        <div
          id="supported-sources"
          className="mt-5 flex flex-wrap items-center justify-center gap-2"
        >
          <span className="mr-1 text-[11px] font-medium uppercase tracking-[0.14em] text-slate-600">
            Works with
          </span>
          {[
            'YouTube',
            'Vimeo',
            'X',
            'TikTok',
            'Twitch',
            'Direct MP4',
            'Local files',
            '1,000+ sites',
          ].map((source) => (
            <span
              key={source}
              className="rounded-md border border-white/[0.065] bg-white/[0.025] px-2 py-1 text-[11px] text-slate-500 transition hover:border-white/10 hover:text-slate-300"
            >
              {source}
            </span>
          ))}
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.65, delay: 0.18, ease: [0.22, 1, 0.36, 1] }}
        className="mt-16 grid gap-3 sm:mt-20 sm:grid-cols-3"
      >
        {FEATURES.map(({ icon: Icon, title, copy }, index) => (
          <div
            key={title}
            className="glass-subtle group relative overflow-hidden rounded-2xl p-5 transition duration-300 hover:-translate-y-0.5 hover:border-white/10 hover:bg-white/[0.04]"
          >
            <div
              className="absolute -right-8 -top-8 h-24 w-24 rounded-full bg-cyan-300/[0.04] blur-2xl transition group-hover:bg-cyan-300/[0.09]"
              aria-hidden="true"
            />
            <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/[0.07] bg-white/[0.035] text-slate-300">
              <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
            </span>
            <h2 className="mt-4 font-display text-[15px] font-semibold tracking-[-0.01em] text-white">
              {title}
            </h2>
            <p className="mt-1.5 text-[12.5px] leading-5 text-slate-500">{copy}</p>
            <span className="absolute bottom-4 right-4 font-display text-[10px] tabular-nums text-slate-700">
              0{index + 1}
            </span>
          </div>
        ))}
      </motion.div>

      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.45, duration: 0.6 }}
        className="mt-8 text-center text-[11px] leading-relaxed text-slate-600"
      >
        Links and files are processed in a private temp workspace and automatically deleted. No
        account required.
      </motion.p>
    </div>
  )
}

function PreviewSkeleton() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      className="glass mt-4 overflow-hidden rounded-2xl p-4 sm:p-5"
      aria-live="polite"
      aria-label="Fetching video details"
    >
      <div className="flex flex-col gap-5 sm:flex-row">
        <Skeleton className="aspect-video w-full shrink-0 rounded-xl sm:w-60" />
        <div className="flex flex-1 flex-col justify-center gap-3 py-1">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-5 w-4/5" />
          <Skeleton className="h-4 w-2/5" />
          <div className="mt-2 flex gap-2">
            <Skeleton className="h-7 w-20 rounded-full" />
            <Skeleton className="h-7 w-16 rounded-full" />
          </div>
        </div>
      </div>
    </motion.div>
  )
}

function PreviewCard({
  preview,
  onClear,
  onContinue,
}: {
  preview: PreviewResponse
  onClear: () => void
  onContinue: () => void
}) {
  const [imageFailed, setImageFailed] = useState(false)
  return (
    <motion.div
      initial={{ opacity: 0, y: 10, scale: 0.992 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.38, ease: [0.22, 1, 0.36, 1] }}
      className="glass overflow-hidden rounded-2xl p-2.5 shadow-card"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-stretch">
        <div className="relative aspect-video w-full shrink-0 overflow-hidden rounded-xl border border-white/[0.06] bg-[#0b1328] sm:w-64">
          {preview.thumbnail_url && !imageFailed ? (
            <img
              src={preview.thumbnail_url}
              alt=""
              className="h-full w-full object-cover"
              loading="eager"
              referrerPolicy="no-referrer"
              onError={() => setImageFailed(true)}
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-[radial-gradient(circle_at_30%_20%,rgba(44,232,255,0.16),transparent_55%),radial-gradient(circle_at_80%_70%,rgba(255,79,216,0.13),transparent_50%)]">
              <Film className="h-8 w-8 text-slate-500" aria-hidden="true" />
            </div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-[#04050c]/80 via-transparent to-transparent" />
          <span className="absolute bottom-2.5 left-2.5 inline-flex items-center gap-1.5 rounded-md bg-black/65 px-2 py-1 text-[10px] font-semibold tabular-nums text-white backdrop-blur">
            <Clock3 className="h-3 w-3" aria-hidden="true" />
            {formatDuration(preview.duration)}
          </span>
          <span className="absolute bottom-2.5 right-2.5 rounded-md border border-white/15 bg-black/45 px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.13em] text-slate-200 backdrop-blur">
            {sourceName(preview.source)}
          </span>
        </div>

        <div className="flex min-w-0 flex-1 flex-col justify-between gap-4 px-1.5 pb-1 pt-1">
          <div>
            <div className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-300 shadow-[0_0_10px_rgba(110,231,183,0.8)]" />
              <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-300/85">
                Preview ready
              </span>
            </div>
            <h2 className="mt-2.5 line-clamp-2 font-display text-xl font-semibold leading-snug tracking-[-0.025em] text-white">
              {preview.title}
            </h2>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12px] text-slate-500">
              {preview.uploader ? <span>{preview.uploader}</span> : null}
              <span className="hidden h-3 w-px bg-white/10 sm:block" />
              <span>{formatDuration(preview.duration)} source</span>
              {preview.width && preview.height ? (
                <>
                  <span className="hidden h-3 w-px bg-white/10 sm:block" />
                  <span>
                    {preview.width}×{preview.height}
                  </span>
                </>
              ) : null}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <Button onClick={onContinue} iconRight={ArrowRight} className="flex-1 sm:flex-none">
              Style my clips
            </Button>
            <Button variant="ghost" size="sm" onClick={onClear}>
              {preview.upload_id ? 'Choose another file' : 'Use another link'}
            </Button>
          </div>
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2 border-t border-white/[0.055] px-2 py-2.5 text-[11px] text-slate-500">
        <WandSparkles className="h-3.5 w-3.5 text-violet-300/70" aria-hidden="true" />
        {preview.upload_id
          ? 'Your file stays in a private workspace and is deleted automatically.'
          : 'Nothing is downloaded until you confirm your clip settings.'}
      </div>
    </motion.div>
  )
}

function SourceTab({
  id,
  controls,
  active,
  icon: Icon,
  label,
  disabled,
  onClick,
}: {
  id: string
  controls: string
  active: boolean
  icon: LucideIcon
  label: string
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      role="tab"
      id={id}
      aria-selected={active}
      aria-controls={controls}
      tabIndex={active ? 0 : -1}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'inline-flex h-9 items-center justify-center gap-2 rounded-lg text-[12px] font-semibold tracking-[-0.01em] transition disabled:cursor-not-allowed disabled:opacity-45',
        active
          ? 'bg-white/[0.075] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]'
          : 'text-slate-500 hover:bg-white/[0.035] hover:text-slate-300',
      )}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {label}
    </button>
  )
}
