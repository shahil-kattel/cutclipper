import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, MotionConfig, motion } from 'framer-motion'
import { Code2, Heart, ShieldCheck, Sparkles } from 'lucide-react'
import { BackgroundFX } from './components/BackgroundFX'
import { Header, BrandMark } from './components/Header'
import { LinkStep, type SourceMode } from './components/LinkStep'
import { CaptionStep } from './components/CaptionStep'
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
  getJob,
  isRetryable,
  previewVideo,
  restyleJob,
  transcribeCaptions,
  translateCaptions,
  uploadVideo,
} from './lib/api'
import { clearActiveJob, readActiveJob, storeActiveJob } from './lib/activeJob'
import { DEFAULT_SETTINGS, formatDuration, pluralize } from './lib/utils'
import { CAPTION_FONT_OPTIONS } from './lib/captionFonts'
import type {
  AppStep,
  CaptionFont,
  CaptionSegment,
  CaptionSettings,
  ClipSettings,
  ExportQuality,
  ExportResolution,
  Job,
  PreviewResponse,
  TranscriptResponse,
  TranscriptionQuality,
  TranscriptionTask,
} from './types/api'

const DEVANAGARI_FONTS = new Set<CaptionFont>(
  CAPTION_FONT_OPTIONS.filter((font) => font.scripts.includes('devanagari')).map(
    (font) => font.name,
  ),
)

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
  const [captionSettings, setCaptionSettings] = useState<CaptionSettings>(() =>
    structuredClone(DEFAULT_SETTINGS.captions),
  )
  const [captionLanguage, setCaptionLanguage] = useState('auto')
  const [captionQuality, setCaptionQuality] = useState<TranscriptionQuality>('balanced')
  const [captionResolution, setCaptionResolution] = useState<ExportResolution>('1080p')
  const [captionExportQuality, setCaptionExportQuality] = useState<ExportQuality>('high')
  const [captionTask, setCaptionTask] = useState<TranscriptionTask>('transcribe')
  const [clipLanguage, setClipLanguage] = useState('auto')
  const [clipQuality, setClipQuality] = useState<TranscriptionQuality>('balanced')
  const [clipTranslate, setClipTranslate] = useState(false)
  const [captionTranscript, setCaptionTranscript] = useState<TranscriptResponse | null>(null)
  const [captionSegments, setCaptionSegments] = useState<CaptionSegment[]>([])
  const [captionTranslation, setCaptionTranslation] = useState<CaptionSegment[] | null>(null)
  const [captionView, setCaptionView] = useState<'source' | 'translation'>('source')
  const [translatingCaptions, setTranslatingCaptions] = useState(false)
  const [captionLoading, setCaptionLoading] = useState(false)
  const [captionError, setCaptionError] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)
  const [generationError, setGenerationError] = useState<string | null>(null)
  const [jobId, setJobId] = useState<string | null>(null)
  const [createdJob, setCreatedJob] = useState<Job | null>(null)
  const [restyleParent, setRestyleParent] = useState<Job | null>(null)
  const [cancelling, setCancelling] = useState(false)
  const [cancelRequested, setCancelRequested] = useState(false)
  const handledStatus = useRef<string | null>(null)
  const generationRef = useRef(false)
  const generationToken = useRef(0)
  const captionRequest = useRef(0)
  const restoreAttempted = useRef(false)

  const activeCaptionSegments =
    captionView === 'translation' && captionTranslation ? captionTranslation : captionSegments
  const captionUploadId = preview?.upload_id ?? null
  const captionSourceLanguage =
    captionLanguage === 'auto' ? (captionTranscript?.language ?? 'ne') : captionLanguage
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
        ? 'Your video is ready · CutClipper'
        : step === 'processing'
          ? 'Rendering · CutClipper'
          : step === 'caption'
            ? 'Caption studio · CutClipper'
            : step === 'settings'
              ? 'Style your clips · CutClipper'
              : 'CutClipper — Long video. Short clips. Zero effort.'
  }, [step])

  useEffect(() => {
    if (step !== 'link') {
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }
  }, [step])

  // Jobs render on the server, so a closed or reloaded tab can reconnect to
  // the work that is still running instead of losing it.
  useEffect(() => {
    if (restoreAttempted.current) return
    restoreAttempted.current = true
    const stored = readActiveJob()
    if (!stored) return
    void (async () => {
      try {
        const restored = await getJob(stored.id)
        setJobId(restored.id)
        setCreatedJob(restored)
        if (restored.status === 'completed') {
          handledStatus.current = `${restored.id}:completed`
          setStep('results')
        } else if (restored.status === 'running' || restored.status === 'queued') {
          setStep('processing')
          toast.info('Reconnected — your render kept running on the server.')
        } else {
          clearActiveJob()
          if (restored.status === 'failed') {
            toast.error(restored.error_message || 'Your previous render did not finish.')
          }
        }
      } catch {
        clearActiveJob()
      }
    })()
  }, [toast])

  useEffect(() => {
    if (!job) return
    if (handledStatus.current === `${job.id}:${job.status}`) return
    if (job.status === 'completed') {
      handledStatus.current = `${job.id}:${job.status}`
      // Navigation is driven by the server's terminal event, once per job.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStep('results')
      toast.success(
        job.mode === 'captions'
          ? 'Your captioned video is ready to download.'
          : `Your ${job.clips.length} ${pluralize(job.clips.length, 'clip')} ${job.clips.length === 1 ? 'is' : 'are'} ready to download.`,
      )
    } else if (job.status === 'failed') {
      handledStatus.current = `${job.id}:${job.status}`
      clearActiveJob()
      toast.error(job.error_message || 'The render failed.')
    } else if (job.status === 'cancelled') {
      handledStatus.current = `${job.id}:${job.status}`
      clearActiveJob()
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

  const loadCaptionTranscript = useCallback(
    async (
      uploadId: string,
      language: string,
      force = false,
      quality = captionQuality,
      task: TranscriptionTask = captionTask,
    ) => {
      // A slower earlier request must never overwrite lines for a newer upload.
      const requestId = ++captionRequest.current
      setCaptionLoading(true)
      setCaptionError(null)
      try {
        const response = await transcribeCaptions(uploadId, language, force, quality, task)
        if (captionRequest.current !== requestId) return
        setCaptionTranscript(response)
        setCaptionSegments(response.segments)
        setCaptionTranslation(null)
        setCaptionView('source')
        const translated = response.translated === true || task === 'translate'
        if (language === 'ne' && !translated) {
          setCaptionSettings((current) =>
            DEVANAGARI_FONTS.has(current.font) ? current : { ...current, font: 'Mukta' },
          )
        }
        if (response.segments.length) {
          toast.success(
            translated
              ? `English translation ready · ${response.segments.length} editable lines`
              : `Speech transcribed · ${response.segments.length} editable lines`,
          )
        } else {
          toast.info('No speech detected. You can add caption lines manually.')
        }
      } catch (error) {
        if (captionRequest.current !== requestId) return
        setCaptionError(errorMessage(error))
      } finally {
        if (captionRequest.current === requestId) setCaptionLoading(false)
      }
    },
    [captionQuality, captionTask, toast],
  )

  const updateActiveCaptionSegments = useCallback(
    (next: CaptionSegment[]) => {
      if (captionView === 'translation' && captionTranslation) {
        setCaptionTranslation(next)
        return
      }
      setCaptionSegments(next)
      // Editing the source lines invalidates the previous English pass.
      setCaptionTranslation(null)
      setCaptionView('source')
    },
    [captionTranslation, captionView],
  )

  const translateGeneratedCaptions = useCallback(async () => {
    if (!captionUploadId || !captionSegments.length) {
      toast.info('Generate Nepali subtitle lines first.')
      return
    }
    setTranslatingCaptions(true)
    try {
      const response = await translateCaptions(
        captionUploadId,
        captionSegments,
        captionQuality,
        captionSourceLanguage,
      )
      setCaptionTranslation(response.segments)
      setCaptionView('translation')
      const warning = response.warnings[0]
      if (warning) toast.info(warning)
      toast.success(`English subtitles ready · ${response.segments.length} lines`)
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setTranslatingCaptions(false)
    }
  }, [captionQuality, captionSegments, captionSourceLanguage, captionUploadId, toast])

  const uploadLocalFile = useCallback(
    async (file: File) => {
      captionRequest.current += 1
      setCaptionLoading(false)
      setCaptionTranslation(null)
      setCaptionView('source')
      setTranslatingCaptions(false)
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
        if (sourceMode === 'caption' && response.upload_id) {
          setCaptionTranscript(null)
          setCaptionSegments([])
          setCaptionError(null)
          setCaptionTask('transcribe')
          setStep('caption')
          toast.success(`File ready · transcribing ${formatDuration(response.duration)} of audio`)
          void loadCaptionTranscript(
            response.upload_id,
            captionLanguage,
            false,
            captionQuality,
            'transcribe',
          )
        } else {
          toast.success(`File ready · ${formatDuration(response.duration)} found`)
        }
      } catch (error) {
        setPreviewError(errorMessage(error))
        setPreviewRetryable(isRetryable(error))
      } finally {
        setPreviewLoading(false)
        setUpload(null)
      }
    },
    [captionLanguage, captionQuality, loadCaptionTranscript, sourceMode, toast],
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

  const changeClipLanguage = useCallback(
    (value: string) => {
      setClipLanguage(value)
      if (value === 'ne') {
        if (!clipTranslate) {
          setSettings((current) =>
            DEVANAGARI_FONTS.has(current.captions.font)
              ? current
              : { ...current, captions: { ...current.captions, font: 'Mukta' } },
          )
        }
      } else if (value === 'en') {
        setClipTranslate(false)
      }
    },
    [clipTranslate],
  )

  const changeClipTranslate = useCallback(
    (value: boolean) => {
      setClipTranslate(value)
      if (!value && clipLanguage === 'ne') {
        setSettings((current) =>
          DEVANAGARI_FONTS.has(current.captions.font)
            ? current
            : { ...current, captions: { ...current.captions, font: 'Mukta' } },
        )
      }
    },
    [clipLanguage],
  )

  const goToSettings = useCallback(() => {
    if (!preview) return
    setGenerationError(null)
    setStep('settings')
  }, [preview])

  const backToLink = useCallback(() => {
    generationToken.current += 1
    captionRequest.current += 1
    setCaptionLoading(false)
    setCancelRequested(false)
    setPreview(null)
    setGenerationError(null)
    setCaptionTranscript(null)
    setCaptionSegments([])
    setCaptionTranslation(null)
    setCaptionView('source')
    setTranslatingCaptions(false)
    setCaptionError(null)
    setStep('link')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [])

  const startRender = useCallback(async () => {
    if (!preview || generationRef.current) return
    if (preview.duration > 0 && preview.duration < settings.min_clip_seconds) {
      setGenerationError(
        'This video is shorter than the minimum clip length. Lower the minimum length and try again.',
      )
      return
    }
    // Auto-highlights trims the count to what fits; only an explicit even
    // split can be impossible before the render starts.
    if (
      settings.selection_mode === 'even' &&
      settings.clip_count * settings.min_clip_seconds > preview.duration + 0.2
    ) {
      setGenerationError(
        'Not enough video for that many clips in an even split. Reduce the count or minimum length, or switch to Auto-highlights.',
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
      const newJob = await createJob(source, settings, {
        language: clipLanguage === 'auto' ? null : clipLanguage,
        quality: clipQuality,
        task: clipTranslate ? 'translate' : 'transcribe',
      })
      if (generationToken.current !== token) {
        // The user navigated away while the request was in flight. Do not
        // hijack the screen; cancel the orphaned render instead.
        void cancelJob(newJob.id).catch(() => undefined)
        return
      }
      storeActiveJob(newJob)
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
  }, [clipLanguage, clipQuality, clipTranslate, preview, settings, toast])

  const startCaptionRender = useCallback(async () => {
    if (!preview?.upload_id || generationRef.current) return
    if (!activeCaptionSegments.length) {
      toast.info('Add or transcribe at least one caption line first.')
      return
    }
    generationRef.current = true
    const token = ++generationToken.current
    setGenerating(true)
    setCaptionError(null)
    setCancelling(false)
    setCancelRequested(false)
    handledStatus.current = null
    const renderSettings: ClipSettings = {
      ...structuredClone(DEFAULT_SETTINGS),
      resolution: captionResolution,
      export_quality: captionExportQuality,
      captions: { ...captionSettings, enabled: true },
    }
    setSettings(renderSettings)
    try {
      const newJob = await createJob({ uploadId: preview.upload_id }, renderSettings, {
        mode: 'captions',
        segments: activeCaptionSegments,
        language: captionLanguage === 'auto' ? null : captionLanguage,
      })
      if (generationToken.current !== token) {
        void cancelJob(newJob.id).catch(() => undefined)
        return
      }
      storeActiveJob(newJob)
      setJobId(newJob.id)
      setCreatedJob(newJob)
      setStep('processing')
    } catch (error) {
      if (generationToken.current !== token) return
      const message = errorMessage(error)
      setCaptionError(message)
      toast.error(message)
    } finally {
      generationRef.current = false
      setGenerating(false)
    }
  }, [
    activeCaptionSegments,
    captionExportQuality,
    captionLanguage,
    captionResolution,
    captionSettings,
    preview,
    toast,
  ])

  const retryRender = useCallback(async () => {
    if (createdJob?.is_restyle && restyleParent) {
      const token = ++generationToken.current
      setCancelRequested(false)
      handledStatus.current = null
      try {
        const updated = await restyleJob(restyleParent.id, createdJob.settings.captions)
        if (generationToken.current !== token) return
        storeActiveJob(updated)
        setJobId(updated.id)
        setCreatedJob(updated)
      } catch (error) {
        toast.error(errorMessage(error))
      }
      return
    }
    if (createdJob?.mode === 'captions') {
      await startCaptionRender()
      return
    }
    await startRender()
  }, [createdJob, restyleParent, startCaptionRender, startRender, toast])

  const restyleCurrentJob = useCallback(
    async (captions: CaptionSettings) => {
      if (!job) throw new Error('This export is no longer available.')
      const token = ++generationToken.current
      setGenerationError(null)
      setCancelRequested(false)
      handledStatus.current = null
      const updated = await restyleJob(job.id, captions)
      if (generationToken.current !== token) {
        void cancelJob(updated.id).catch(() => undefined)
        return
      }
      storeActiveJob(updated)
      setSettings(updated.settings)
      setCaptionSettings(updated.settings.captions)
      setRestyleParent(job)
      setJobId(updated.id)
      setCreatedJob(updated)
      setStep('processing')
    },
    [job],
  )

  const backToPreviousExport = useCallback(() => {
    if (!restyleParent) return
    generationToken.current += 1
    setCancelRequested(false)
    setJobId(restyleParent.id)
    setCreatedJob(restyleParent)
    setStep('results')
  }, [restyleParent])

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
    captionRequest.current += 1
    setCaptionLoading(false)
    clearActiveJob()
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
    setRestyleParent(null)
    setSettings(structuredClone(DEFAULT_SETTINGS))
    setCaptionSettings(structuredClone(DEFAULT_SETTINGS.captions))
    setCaptionLanguage('auto')
    setCaptionQuality('balanced')
    setCaptionResolution('1080p')
    setCaptionExportQuality('high')
    setCaptionTask('transcribe')
    setClipLanguage('auto')
    setClipQuality('balanced')
    setClipTranslate(false)
    setCaptionTranscript(null)
    setCaptionSegments([])
    setCaptionTranslation(null)
    setCaptionView('source')
    setTranslatingCaptions(false)
    setCaptionError(null)
    setCancelling(false)
    handledStatus.current = null
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [])

  const editSettings = useCallback(() => {
    const captionJob = createdJob?.mode === 'captions'
    generationToken.current += 1
    setJobId(null)
    setCreatedJob(null)
    setCancelRequested(false)
    setGenerationError(null)
    setStep(captionJob ? 'caption' : 'settings')
  }, [createdJob])

  return (
    <div className="relative min-h-dvh">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <BackgroundFX />
      <div className="relative z-10 flex min-h-dvh flex-col">
        <Header
          step={step}
          captionFlow={
            step === 'caption' || createdJob?.mode === 'captions' || job?.mode === 'captions'
          }
        />
        <main
          id="main"
          className={`mx-auto w-full flex-1 px-4 sm:px-6 lg:px-8 ${
            step === 'link' ? 'pb-20 pt-9 sm:pt-14' : 'pb-16 pt-7 sm:pt-10'
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

              {step === 'caption' && preview?.upload_id ? (
                <CaptionStep
                  preview={preview}
                  transcript={captionTranscript}
                  segments={activeCaptionSegments}
                  loading={captionLoading}
                  error={captionError}
                  language={captionLanguage}
                  quality={captionQuality}
                  task={captionTask}
                  captionView={captionView}
                  hasTranslation={Boolean(captionTranslation?.length)}
                  translating={translatingCaptions}
                  onTranslationViewChange={setCaptionView}
                  onTranslate={() => void translateGeneratedCaptions()}
                  onQualityChange={setCaptionQuality}
                  onTaskChange={setCaptionTask}
                  onLanguageChange={(value) => {
                    setCaptionLanguage(value)
                    if (value === 'ne') {
                      setCaptionSettings((current) =>
                        DEVANAGARI_FONTS.has(current.font)
                          ? current
                          : { ...current, font: 'Mukta' },
                      )
                    } else if (value === 'en') {
                      setCaptionTask('transcribe')
                    }
                  }}
                  onTranscribe={(force, task) => {
                    if (preview.upload_id) {
                      void loadCaptionTranscript(
                        preview.upload_id,
                        captionLanguage,
                        force,
                        captionQuality,
                        task,
                      )
                    }
                  }}
                  onSegmentsChange={updateActiveCaptionSegments}
                  exportResolution={captionResolution}
                  exportQuality={captionExportQuality}
                  onExportResolutionChange={setCaptionResolution}
                  onExportQualityChange={setCaptionExportQuality}
                  captions={captionSettings}
                  onCaptionsChange={setCaptionSettings}
                  onBack={backToLink}
                  onRender={startCaptionRender}
                  generating={generating}
                />
              ) : null}

              {step === 'settings' && preview ? (
                <SettingsStep
                  preview={preview}
                  settings={settings}
                  onSettingsChange={setSettings}
                  captionLanguage={clipLanguage}
                  captionQuality={clipQuality}
                  translateCaptions={clipTranslate}
                  onCaptionLanguageChange={changeClipLanguage}
                  onCaptionQualityChange={setClipQuality}
                  onTranslateCaptionsChange={changeClipTranslate}
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
                    const captionJob =
                      createdJob?.mode === 'captions' || displayJob?.mode === 'captions'
                    setJobId(null)
                    setCreatedJob(null)
                    setCancelRequested(false)
                    if (!preview) {
                      setStep('link')
                      return
                    }
                    setStep(captionJob ? 'caption' : 'settings')
                  }}
                  onRetry={retryRender}
                  canRetry={Boolean(preview) || Boolean(restyleParent)}
                  onStartOver={startOver}
                  onBackToPrevious={restyleParent ? backToPreviousExport : undefined}
                  generating={generating}
                />
              ) : null}

              {step === 'results' && job ? (
                <ResultsStep
                  job={job}
                  onNewProject={startOver}
                  onEditSettings={editSettings}
                  onRestyle={restyleCurrentJob}
                  canEditSettings={Boolean(preview)}
                />
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
    <footer className="relative z-10 px-4 pb-8 pt-4 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl border-t-[1.5px] border-dashed border-ink/30 pt-5">
        <div className="flex flex-col items-start justify-between gap-4 text-[10.5px] text-ink-soft sm:flex-row sm:items-center">
          <div className="flex flex-wrap items-center gap-2.5">
            <BrandMark className="h-7 w-7 rounded-lg shadow-[1px_2px_0_#211d19]" />
            <span className="font-display text-[14px] font-semibold tracking-[-0.01em] text-ink">
              CutClipper
            </span>
            <span className="hidden h-3 w-px bg-ink/20 sm:block" />
            <span className="font-hand text-[15px] text-ink-soft">
              long videos, short attention spans
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <span className="inline-flex items-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5 text-teal" aria-hidden="true" />
              Temp files auto-delete
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Sparkles className="h-3.5 w-3.5 text-tomato" aria-hidden="true" />
              No accounts. No watermarks.
            </span>
            <a
              href="https://github.com/shahil-kattel/cutclipper"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-full border-[1.5px] border-ink bg-paper-soft px-2.5 py-1 font-semibold text-ink shadow-[1px_2px_0_#211d19] transition hover:-translate-y-px hover:bg-mustard-soft"
            >
              <Code2 className="h-3 w-3" aria-hidden="true" />
              GitHub
            </a>
            <span className="inline-flex items-center gap-1 font-hand text-[15px]">
              made with <Heart className="h-3 w-3 fill-tomato text-tomato" aria-hidden="true" /> on
              paper
            </span>
          </div>
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
