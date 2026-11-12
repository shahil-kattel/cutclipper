import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, MotionConfig, motion } from 'framer-motion'
import { Code2, Heart, ShieldCheck, Sparkles } from 'lucide-react'
import { BackgroundFX } from './components/BackgroundFX'
import { Header, BrandMark } from './components/Header'
import { LinkStep, type SourceMode } from './components/LinkStep'
import { SettingsStep } from './components/SettingsStep'
import { ProcessingStep } from './components/ProcessingStep'
import { ResultsStep } from './components/ResultsStep'
import { ToastProvider } from './components/Toast'
import { useToast } from './hooks/useToast'
import { useJobStream } from './hooks/useJobStream'
import {
  cancelJob,
  createJob,
  errorMessage,
  isRetryable,
  previewVideo,
  uploadVideo,
} from './lib/api'
import { DEFAULT_SETTINGS, formatDuration } from './lib/utils'
import type { AppStep, ClipSettings, Job, PreviewResponse } from './types/api'

function AppContent() {
  const toast = useToast()
  const [step, setStep] = useState<AppStep>('link')
  const [sourceMode, setSourceMode] = useState<SourceMode>('link')
  const [url, setUrl] = useState('')
  const [preview, setPreview] = useState<PreviewResponse | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [upload, setUpload] = useState<{ name: string; progress: number } | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [previewRetryable, setPreviewRetryable] = useState(false)
  const [settings, setSettings] = useState<ClipSettings>(structuredClone(DEFAULT_SETTINGS))
  const [generating, setGenerating] = useState(false)
  const [generationError, setGenerationError] = useState<string | null>(null)
  const [jobId, setJobId] = useState<string | null>(null)
  const [createdJob, setCreatedJob] = useState<Job | null>(null)
  const [cancelling, setCancelling] = useState(false)
  const [cancelRequested, setCancelRequested] = useState(false)
  const handledStatus = useRef<string | null>(null)
  const generationRef = useRef(false)
  const generationToken = useRef(0)

  const { job: streamedJob, connection } = useJobStream(jobId, step === 'processing')
  const job = streamedJob?.id === jobId ? streamedJob : createdJob?.id === jobId ? createdJob : null
  // SSE frames can lag the cancel response; keep the button retired locally
  // until the stream catches up or a terminal event arrives.
  const displayJob =
    job && cancelRequested && (job.status === 'running' || job.status === 'queued')
      ? {
          ...job,
          can_cancel: false,
          message: job.status === 'queued' ? 'Cancelling…' : 'Cancelling after the current step…',
        }
      : job

  useEffect(() => {
    document.title =
      step === 'results'
        ? 'Your clips are ready · CutClipper'
        : step === 'processing'
          ? 'Rendering · CutClipper'
          : step === 'settings'
            ? 'Style your clips · CutClipper'
            : 'CutClipper — Long video. Short clips. Zero effort.'
  }, [step])

  useEffect(() => {
    if (step !== 'link') {
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }
  }, [step])

  useEffect(() => {
    if (!job) return
    if (handledStatus.current === `${job.id}:${job.status}`) return
    if (job.status === 'completed') {
      handledStatus.current = `${job.id}:${job.status}`
      // Navigation is driven by the server's terminal event, once per job.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStep('results')
      toast.success(`Your ${job.clips.length} clips are ready to download.`)
    } else if (job.status === 'failed') {
      handledStatus.current = `${job.id}:${job.status}`
      toast.error(job.error_message || 'The render failed.')
    } else if (job.status === 'cancelled') {
      handledStatus.current = `${job.id}:${job.status}`
      toast.info('The render was cancelled.')
    }
  }, [job, toast])

  const analyzeLink = useCallback(async () => {
    const value = url.trim()
    if (!value) {
      setPreviewError('Paste a video link first.')
      setPreviewRetryable(false)
      return
    }
    setPreviewLoading(true)
    setPreviewError(null)
    setPreview(null)
    try {
      const response = await previewVideo(value)
      setPreview(response)
      setUrl(response.normalized_url)
      setSettings((current) => ({
        ...current,
        captions: {
          ...current.captions,
          enabled: response.has_audio === false ? false : current.captions.enabled,
        },
      }))
      toast.success(
        `Link ready · ${response.duration > 0 ? formatDuration(response.duration) : 'video'} found`,
      )
    } catch (error) {
      setPreviewError(errorMessage(error))
      setPreviewRetryable(isRetryable(error))
    } finally {
      setPreviewLoading(false)
    }
  }, [toast, url])

  const uploadLocalFile = useCallback(
    async (file: File) => {
      setPreviewLoading(true)
      setPreviewError(null)
      setPreviewRetryable(false)
      setPreview(null)
      setUpload({ name: file.name, progress: 0 })
      try {
        const response = await uploadVideo(file, (fraction) =>
          setUpload((current) => (current ? { ...current, progress: fraction } : current)),
        )
        setPreview(response)
        setUrl('')
        setSettings((current) => ({
          ...current,
          captions: {
            ...current.captions,
            enabled: response.has_audio === false ? false : current.captions.enabled,
          },
        }))
        toast.success(`File ready · ${formatDuration(response.duration)} found`)
      } catch (error) {
        setPreviewError(errorMessage(error))
        setPreviewRetryable(isRetryable(error))
      } finally {
        setPreviewLoading(false)
        setUpload(null)
      }
    },
    [toast],
  )

  const clearPreviewError = useCallback(() => {
    setPreviewError(null)
    setPreviewRetryable(false)
  }, [])

  const clearPreview = useCallback(() => {
    setPreview(null)
    setPreviewError(null)
    setPreviewRetryable(false)
  }, [])

  const goToSettings = useCallback(() => {
    if (!preview) return
    setGenerationError(null)
    setStep('settings')
  }, [preview])

  const backToLink = useCallback(() => {
    generationToken.current += 1
    setCancelRequested(false)
    setPreview(null)
    setGenerationError(null)
    setStep('link')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [])

  const startRender = useCallback(async () => {
    if (!preview || generationRef.current) return
    if (settings.clip_count * settings.min_clip_seconds > preview.duration + 0.2) {
      setGenerationError(
        'Not enough video for that many clips. Reduce the count or minimum length.',
      )
      return
    }
    generationRef.current = true
    const token = ++generationToken.current
    setGenerating(true)
    setGenerationError(null)
    setCancelling(false)
    handledStatus.current = null
    try {
      const source = preview.upload_id
        ? { uploadId: preview.upload_id }
        : { url: preview.normalized_url }
      const newJob = await createJob(source, settings)
      if (generationToken.current !== token) {
        // The user navigated away while the request was in flight. Do not
        // hijack the screen; cancel the orphaned render instead.
        void cancelJob(newJob.id).catch(() => undefined)
        return
      }
      setJobId(newJob.id)
      setCreatedJob(newJob)
      setCancelRequested(false)
      setStep('processing')
    } catch (error) {
      if (generationToken.current !== token) return
      const message = errorMessage(error)
      setGenerationError(message)
      setStep('settings')
      toast.error(message)
    } finally {
      generationRef.current = false
      setGenerating(false)
    }
  }, [preview, settings, toast])

  const retryRender = useCallback(async () => {
    await startRender()
  }, [startRender])

  const requestCancel = useCallback(async () => {
    if (!jobId || cancelling || cancelRequested) return
    setCancelRequested(true)
    setCancelling(true)
    try {
      const updated = await cancelJob(jobId)
      setCreatedJob(updated)
    } catch (error) {
      setCancelRequested(false)
      toast.error(errorMessage(error))
    } finally {
      setCancelling(false)
    }
  }, [cancelRequested, cancelling, jobId, toast])

  const startOver = useCallback(() => {
    generationToken.current += 1
    setCancelRequested(false)
    setStep('link')
    setSourceMode('link')
    setUrl('')
    setPreview(null)
    setUpload(null)
    setPreviewError(null)
    setPreviewRetryable(false)
    setGenerationError(null)
    setJobId(null)
    setCreatedJob(null)
    setSettings(structuredClone(DEFAULT_SETTINGS))
    setCancelling(false)
    handledStatus.current = null
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [])

  const editSettings = useCallback(() => {
    setJobId(null)
    setCreatedJob(null)
    setCancelRequested(false)
    setGenerationError(null)
    setStep('settings')
  }, [])

  return (
    <div className="relative min-h-dvh">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <BackgroundFX />
      <div className="relative z-10 flex min-h-dvh flex-col">
        <Header step={step} />
        <main
          id="main"
          className={`mx-auto w-full flex-1 px-4 sm:px-6 lg:px-8 ${
            step === 'link' ? 'pb-20 pt-12 sm:pt-20' : 'pb-20 pt-8 sm:pt-12'
          }`}
        >
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={step}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            >
              {step === 'link' ? (
                <LinkStep
                  url={url}
                  mode={sourceMode}
                  onModeChange={setSourceMode}
                  onUrlChange={(value) => {
                    setUrl(value)
                    if (previewError) setPreviewError(null)
                  }}
                  onPreview={analyzeLink}
                  onUploadFile={uploadLocalFile}
                  onClearPreview={clearPreview}
                  onClearError={clearPreviewError}
                  onContinue={goToSettings}
                  preview={preview}
                  loading={previewLoading}
                  uploading={upload}
                  error={previewError}
                  retryable={previewRetryable}
                />
              ) : null}

              {step === 'settings' && preview ? (
                <SettingsStep
                  preview={preview}
                  settings={settings}
                  onSettingsChange={setSettings}
                  onBack={backToLink}
                  onGenerate={startRender}
                  generating={generating}
                  generationError={generationError}
                />
              ) : null}

              {step === 'processing' ? (
                <ProcessingStep
                  job={displayJob}
                  connection={connection}
                  cancelling={cancelling}
                  onCancel={requestCancel}
                  onBack={() => {
                    setJobId(null)
                    setCreatedJob(null)
                    setCancelRequested(false)
                    setStep('settings')
                  }}
                  onRetry={retryRender}
                  onStartOver={startOver}
                  generating={generating}
                />
              ) : null}

              {step === 'results' && job ? (
                <ResultsStep job={job} onNewProject={startOver} onEditSettings={editSettings} />
              ) : null}
            </motion.div>
          </AnimatePresence>
        </main>

        <SiteFooter />
      </div>
    </div>
  )
}

function SiteFooter() {
  return (
    <footer className="relative z-10 border-t border-white/[0.055] px-4 pb-8 pt-6 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-4 text-[11px] text-slate-600 sm:flex-row sm:items-center">
        <div className="flex items-center gap-2.5">
          <BrandMark className="h-7 w-7 rounded-lg" />
          <span className="font-display font-medium tracking-[-0.01em] text-slate-400">
            CutClipper
          </span>
          <span className="hidden h-3 w-px bg-white/10 sm:block" />
          <span className="hidden sm:inline">Local media pipeline · open source</span>
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <span className="inline-flex items-center gap-1.5">
            <ShieldCheck className="h-3 w-3" aria-hidden="true" />
            Temp files auto-delete
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Sparkles className="h-3 w-3" aria-hidden="true" />
            No accounts. No watermarks.
          </span>
          <a
            href="https://github.com/shahil-kattel/cutclipper"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 transition hover:text-slate-300"
          >
            <Code2 className="h-3 w-3" aria-hidden="true" />
            GitHub
          </a>
          <span className="inline-flex items-center gap-1">
            Built with <Heart className="h-2.5 w-2.5 text-fuchsia-400/70" aria-hidden="true" />
          </span>
        </div>
      </div>
    </footer>
  )
}

export default function App() {
  return (
    <MotionConfig reducedMotion="user">
      <ToastProvider>
        <AppContent />
      </ToastProvider>
    </MotionConfig>
  )
}
