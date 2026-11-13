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
import { assetUrl } from '../lib/api'
import { cn, formatDuration, sourceName } from '../lib/utils'
import { Button, Skeleton } from './ui'
import { useToast } from '../hooks/useToast'

export type SourceMode = 'link' | 'upload' | 'caption'

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
    tone: 'bg-mustard-soft',
    iconTone: 'bg-mustard',
    tilt: '-rotate-1',
  },
  {
    icon: Captions,
    title: 'Editable captions',
    copy: 'Nepali + 90 languages, 19 animation presets, 51 fonts, and line-by-line corrections.',
    tone: 'bg-teal-soft',
    iconTone: 'bg-teal text-paper-soft',
    tilt: 'rotate-[0.5deg]',
  },
  {
    icon: BadgeCheck,
    title: 'Clean by default',
    copy: 'No watermarks, logos, paywalls, or hidden caps. Just your clips.',
    tone: 'bg-periwinkle-soft',
    iconTone: 'bg-periwinkle text-paper-soft',
    tilt: '-rotate-[0.4deg]',
  },
]

const SUPPORTED_SOURCES = [
  'YouTube',
  'Vimeo',
  'X',
  'TikTok',
  'Twitch',
  'Direct MP4',
  'Local files',
  '1,000+ sites',
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
    <div className="relative mx-auto max-w-7xl">
      <motion.div
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        className="relative mx-auto max-w-4xl text-center"
      >
        <span
          aria-hidden="true"
          className="absolute -left-14 top-24 hidden h-16 w-16 -rotate-12 items-center justify-center rounded-full border-[1.5px] border-ink bg-blush-soft font-hand text-[13px] leading-tight text-ink shadow-[2px_3px_0_#211d19] xl:flex"
        >
          your video,
          <br />
          but fun
        </span>
        <span
          aria-hidden="true"
          className="absolute -right-12 top-36 hidden rotate-6 flex-col items-center gap-1 font-hand text-[17px] text-ink-soft xl:flex"
        >
          <svg viewBox="0 0 64 44" className="h-10 w-14 text-tomato">
            <path
              d="M4 34c16-24 29 5 43-17M40 15l8 1-2 9"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          no watermark.
          <br />
          pinky promise.
        </span>

        <div className="mb-5 flex justify-center">
          <span className="inline-flex -rotate-2 items-center gap-2 rounded-lg border-[1.5px] border-ink bg-mustard-soft px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.13em] text-ink shadow-[2px_2px_0_#211d19]">
            <Sparkles className="h-3.5 w-3.5 text-tomato" aria-hidden="true" />
            The tiny clip studio · est. 2026
          </span>
        </div>

        <h1 className="text-balance font-display text-[3.1rem] font-semibold leading-[0.96] tracking-[-0.055em] text-ink sm:text-[4.4rem] lg:text-[5.15rem]">
          Long video.
          <br />
          <span className="marker-highlight">Short clips</span> that
          <br />
          <span className="text-gradient italic">stop the scroll.</span>
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-pretty text-[13.5px] font-medium leading-7 text-ink-soft sm:text-[14.5px]">
          Paste a public video link, upload a file, or caption a full video in English, Nepali, or
          any language Whisper supports. CutClipper finds the moments worth watching, reframes them
          to 9:16, and burns in editable kinetic captions — without a single watermark.
        </p>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 22 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.08, ease: [0.22, 1, 0.36, 1] }}
        className="relative mx-auto mt-12 max-w-3xl sm:mt-14"
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
              className="paper-card taped p-2.5 sm:p-3"
            >
              <div className="rounded-[0.95rem] bg-paper-soft p-2.5 sm:p-3.5">
                <div className="mb-2.5 flex items-center justify-between gap-3 px-1">
                  <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-ink-soft">
                    Step 01 · choose a source
                  </p>
                  <span className="font-hand text-[15px] text-tomato">start here</span>
                </div>
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
                    const modes: SourceMode[] = ['link', 'upload', 'caption']
                    const currentIndex = modes.indexOf(mode)
                    const next: SourceMode =
                      event.key === 'Home'
                        ? 'link'
                        : event.key === 'End'
                          ? 'caption'
                          : event.key === 'ArrowLeft'
                            ? (modes[(currentIndex + modes.length - 1) % modes.length] ?? 'link')
                            : (modes[(currentIndex + 1) % modes.length] ?? 'upload')
                    onModeChange(next)
                    setTouched(false)
                    onClearError()
                    requestAnimationFrame(() => {
                      document.getElementById(`source-tab-${next}`)?.focus()
                    })
                  }}
                  className="mb-3 grid grid-cols-3 gap-1 rounded-xl border-[1.5px] border-ink bg-paper-deep/60 p-1"
                >
                  <SourceTab
                    id="source-tab-link"
                    controls="source-panel-link"
                    active={mode === 'link'}
                    icon={Link2}
                    label="Paste a link"
                    activeTone="bg-mustard-soft"
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
                    activeTone="bg-teal-soft"
                    disabled={Boolean(uploading) || loading}
                    onClick={() => {
                      onModeChange('upload')
                      setTouched(false)
                      onClearError()
                    }}
                  />
                  <SourceTab
                    id="source-tab-caption"
                    controls="source-panel-caption"
                    active={mode === 'caption'}
                    icon={Captions}
                    label="Add captions"
                    activeTone="bg-periwinkle-soft"
                    disabled={Boolean(uploading) || loading}
                    onClick={() => {
                      onModeChange('caption')
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
                          className="pointer-events-none absolute left-3.5 h-[18px] w-[18px] text-tomato"
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
                          className="paper-input h-12 w-full rounded-xl pl-11 pr-[5.4rem] text-[13px] font-medium outline-none transition focus:border-tomato sm:h-[3.25rem] sm:text-[14px]"
                        />
                        <button
                          type="button"
                          onClick={paste}
                          disabled={pasting}
                          className="absolute right-2 inline-flex items-center gap-1.5 rounded-md border-[1.5px] border-ink bg-paper px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-[0.04em] text-ink shadow-[1px_2px_0_#211d19] transition hover:-translate-y-px hover:bg-mustard-soft active:translate-y-px active:shadow-none disabled:opacity-50"
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
                    <p className="mt-2.5 px-1 font-hand text-[14px] text-ink-soft">
                      copy, paste, snip — no account, no fuss.
                    </p>
                  </form>
                ) : (
                  <div
                    id={mode === 'caption' ? 'source-panel-caption' : 'source-panel-upload'}
                    role="tabpanel"
                    aria-labelledby={
                      mode === 'caption' ? 'source-tab-caption' : 'source-tab-upload'
                    }
                  >
                    <div
                      onDragOver={(event) => {
                        // Always prevent the browser's default open-file drop,
                        // even while a file is already uploading.
                        event.preventDefault()
                        if (uploading || loading) return
                        setDragging(true)
                      }}
                      onDragLeave={() => setDragging(false)}
                      onDrop={(event) => {
                        event.preventDefault()
                        setDragging(false)
                        if (uploading || loading) return
                        chooseFile(event.dataTransfer.files?.[0])
                      }}
                      className={cn(
                        'relative overflow-hidden rounded-xl border-[1.5px] border-dashed px-4 py-7 text-center transition focus-within:border-tomato focus-within:ring-2 focus-within:ring-tomato/30 sm:py-8',
                        dragging
                          ? 'border-tomato bg-tomato-soft/70'
                          : 'border-ink/40 bg-paper/50 hover:border-ink hover:bg-paper',
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
                        <span className="flex h-12 w-12 -rotate-2 items-center justify-center rounded-xl border-[1.5px] border-ink bg-teal-soft text-teal shadow-[2px_2px_0_#211d19] transition group-hover:rotate-2 group-hover:bg-mustard">
                          {uploading ? (
                            <LoaderCircle className="h-5 w-5 animate-spin" aria-hidden="true" />
                          ) : (
                            <CloudUpload className="h-5 w-5" aria-hidden="true" />
                          )}
                        </span>
                        <span className="mt-3 block max-w-full truncate font-display text-[16px] font-semibold tracking-[-0.01em] text-ink">
                          {uploading
                            ? `Uploading ${uploading.name}`
                            : mode === 'caption'
                              ? 'Choose a video to caption'
                              : 'Choose a video or drop it here'}
                        </span>
                        <span className="mt-1 block text-[11px] font-medium text-ink-soft">
                          {uploading
                            ? `${Math.round(uploading.progress * 100)}% · keep this tab open`
                            : mode === 'caption'
                              ? 'We transcribe it, then you fix and style every line'
                              : 'MP4, MOV, WebM, MKV, AVI · up to 3 GB'}
                        </span>
                      </label>
                      {uploading ? (
                        <div
                          className="mx-auto mt-4 h-2 w-full max-w-sm overflow-hidden rounded-full border-[1.5px] border-ink bg-paper-deep"
                          role="progressbar"
                          aria-label="Upload progress"
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-valuenow={Math.round(uploading.progress * 100)}
                        >
                          <div
                            className="h-full rounded-full bg-tomato transition-[width] duration-300"
                            style={{ width: `${Math.max(3, uploading.progress * 100)}%` }}
                          />
                        </div>
                      ) : (
                        <span className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-ink/25 bg-paper-soft px-2.5 py-1 text-[9.5px] font-semibold text-ink-soft">
                          <ShieldCheck className="h-3 w-3 text-teal" aria-hidden="true" />
                          {mode === 'caption'
                            ? 'Nepali + 90 languages · 19 presets · 51 fonts · auto-delete'
                            : 'Files stay on this server and auto-delete'}
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
              className="mt-4 flex flex-col items-start gap-3 rounded-xl border-[1.5px] border-ink bg-tomato-soft px-4 py-3.5 text-sm text-ink shadow-[3px_3px_0_#211d19] sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex items-start gap-2.5">
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-tomato" aria-hidden="true" />
                <p className="font-medium leading-relaxed">{error}</p>
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
          <span className="mr-1 font-hand text-[16px] text-ink-soft">plays nice with</span>
          {SUPPORTED_SOURCES.map((source, index) => (
            <span
              key={source}
              className={cn(
                'rounded-md border border-ink/25 bg-paper-soft/70 px-2 py-1 text-[9.5px] font-semibold text-ink-soft shadow-[1px_1px_0_rgba(33,29,25,0.12)] transition hover:-translate-y-px hover:border-ink hover:text-ink',
                index % 2 === 0 ? 'rotate-[-0.8deg]' : 'rotate-[0.8deg]',
              )}
            >
              {source}
            </span>
          ))}
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.18, ease: [0.22, 1, 0.36, 1] }}
        className="mt-16 sm:mt-20"
      >
        <div className="mb-5 flex items-center justify-center gap-3">
          <span className="h-px w-10 bg-ink/30" aria-hidden="true" />
          <p className="font-hand text-[19px] text-ink-soft">the good stuff, on tap</p>
          <span className="h-px w-10 bg-ink/30" aria-hidden="true" />
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          {FEATURES.map(({ icon: Icon, title, copy, tone, iconTone, tilt }, index) => (
            <div
              key={title}
              className={cn(
                'group relative overflow-hidden rounded-[1.15rem] border-[1.5px] border-ink p-5 shadow-[4px_5px_0_#211d19] transition duration-300 hover:translate-y-[-3px] hover:rotate-0 hover:shadow-[5px_7px_0_#211d19]',
                tone,
                tilt,
              )}
            >
              <span
                className="absolute -right-7 -top-7 h-20 w-20 rounded-full border border-ink/10 bg-paper-soft/30"
                aria-hidden="true"
              />
              <div className="flex items-start justify-between gap-3">
                <span
                  className={cn(
                    'flex h-10 w-10 -rotate-3 items-center justify-center rounded-xl border-[1.5px] border-ink shadow-[2px_2px_0_#211d19] transition group-hover:rotate-3',
                    iconTone,
                  )}
                >
                  <Icon className="h-[19px] w-[19px]" aria-hidden="true" />
                </span>
                <span className="rounded-full border border-ink/30 px-2 py-1 font-hand text-[13px] leading-none text-ink-soft">
                  0{index + 1}
                </span>
              </div>
              <h2 className="mt-4 font-display text-[19px] font-semibold tracking-[-0.02em] text-ink">
                {title}
              </h2>
              <p className="mt-1.5 text-[11.5px] leading-5 text-ink-soft">{copy}</p>
              <svg
                viewBox="0 0 40 10"
                className="mt-4 h-2.5 w-10 text-ink/30 transition group-hover:text-tomato"
                aria-hidden="true"
              >
                <path
                  d="M1 6c5-4 9 5 14 0s9 4 12 0 8 2 12-1"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
              </svg>
            </div>
          ))}
        </div>
      </motion.div>

      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.45, duration: 0.6 }}
        className="mx-auto mt-9 flex max-w-2xl flex-col items-center justify-center gap-2 text-center text-[10.5px] leading-relaxed text-ink-soft sm:flex-row"
      >
        <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-teal" aria-hidden="true" />
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
      className="paper-card taped taped-teal overflow-hidden p-3"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-stretch">
        <div className="relative aspect-video w-full shrink-0 overflow-hidden rounded-lg border-[1.5px] border-ink bg-ink sm:w-64">
          {preview.thumbnail_url && !imageFailed ? (
            <img
              src={assetUrl(preview.thumbnail_url)}
              alt=""
              className="h-full w-full object-cover"
              loading="eager"
              referrerPolicy="no-referrer"
              onError={() => setImageFailed(true)}
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-[radial-gradient(circle_at_30%_20%,rgba(242,190,79,0.3),transparent_55%),radial-gradient(circle_at_80%_70%,rgba(80,91,166,0.25),transparent_50%)]">
              <Film className="h-8 w-8 text-paper-soft/70" aria-hidden="true" />
            </div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-ink/80 via-transparent to-transparent" />
          <span className="absolute bottom-2.5 left-2.5 inline-flex items-center gap-1.5 rounded-md border border-ink bg-paper-soft px-2 py-1 text-[9px] font-bold uppercase tabular-nums tracking-[0.06em] text-ink shadow-[1px_1px_0_#211d19]">
            <Clock3 className="h-3 w-3 text-tomato" aria-hidden="true" />
            {formatDuration(preview.duration)}
          </span>
          <span className="absolute bottom-2.5 right-2.5 rounded-md border border-ink bg-mustard px-2 py-1 text-[8px] font-bold uppercase tracking-[0.1em] text-ink shadow-[1px_1px_0_#211d19]">
            {sourceName(preview.source)}
          </span>
        </div>

        <div className="flex min-w-0 flex-1 flex-col justify-between gap-4 px-1.5 pb-1 pt-1">
          <div>
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1 rounded-full border border-ink/30 bg-teal-soft px-2 py-0.5 text-[8.5px] font-bold uppercase tracking-[0.12em] text-teal">
                <span className="h-1.5 w-1.5 rounded-full bg-teal" />
                Preview ready
              </span>
            </div>
            <h2 className="mt-2.5 line-clamp-2 font-display text-[23px] font-semibold leading-[1.12] tracking-[-0.025em] text-ink">
              {preview.title}
            </h2>
            <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-[10.5px] font-medium text-ink-soft">
              {preview.uploader ? <span>{preview.uploader}</span> : null}
              <span className="hidden h-3 w-px bg-ink/20 sm:block" />
              <span>{formatDuration(preview.duration)} source</span>
              {preview.width && preview.height ? (
                <>
                  <span className="hidden h-3 w-px bg-ink/20 sm:block" />
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
      <div className="mt-3 flex items-center gap-2 border-t border-dashed border-ink/20 px-1.5 py-2.5 text-[10px] font-medium text-ink-soft">
        <WandSparkles className="h-3.5 w-3.5 text-tomato" aria-hidden="true" />
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
  activeTone,
  disabled,
  onClick,
}: {
  id: string
  controls: string
  active: boolean
  icon: LucideIcon
  label: string
  activeTone: string
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
        'inline-flex h-9 items-center justify-center gap-1.5 rounded-lg text-[11.5px] font-semibold tracking-[-0.01em] transition disabled:cursor-not-allowed disabled:opacity-45',
        active
          ? cn('border-[1.5px] border-ink text-ink shadow-[1px_2px_0_#211d19]', activeTone)
          : 'border-[1.5px] border-transparent text-ink-soft hover:bg-paper-soft/70 hover:text-ink',
      )}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      <span className="hidden sm:inline">{label}</span>
      <span className="sm:hidden">{label.split(' ')[0]}</span>
    </button>
  )
}
