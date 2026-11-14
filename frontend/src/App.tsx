import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, MotionConfig, motion } from 'framer-motion'
import { Code2, Heart, ShieldCheck, Sparkles } from 'lucide-react'
import { BackgroundFX } from './components/BackgroundFX'
import { Header, BrandMark } from './components/Header'
import { LinkStep, type SourceMode } from './components/LinkStep'
import { CaptionStep } from './components/CaptionStep'
import { CaptionEditorDrawer } from './components/CaptionEditorPanel'
import { SettingsStep } from './components/SettingsStep'
import { ProcessingStep } from './components/ProcessingStep'
import { ResultsStep } from './components/ResultsStep'
import { ToastProvider } from './components/Toast'
import { useToast } from './hooks/useToast'
import { useJobStream } from './hooks/useJobStream'
import {
  assetUrl,
  cancelJob,
  createJob,
  downloadAllUrl,
  errorMessage,
  getJob,
  getJobCaptions,
  isRetryable,
  previewVideo,
  restyleJob,
  romanizeCaptions,
  transcribeCaptions,
  translateCaptions,
  translateJobCaptions,
  uploadVideo,
} from './lib/api'
import { clearActiveJob, readActiveJob, storeActiveJob } from './lib/activeJob'
import { clearCaptionDraft, readCaptionDraft, writeCaptionDraft } from './lib/captionDrafts'
import { downloadSrt } from './lib/srt'
import { DEFAULT_SETTINGS, formatDuration, pluralize } from './lib/utils'
import { CAPTION_FONT_OPTIONS } from './lib/captionFonts'
import type {
  AppStep,
  CaptionFont,
  CaptionSegment,
  CaptionSettings,
  ClipSettings,
  NepaliScript,
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
const DEVANAGARI_RE = /[ऀ-ॿ]/

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
  const [captionRomanSegments, setCaptionRomanSegments] = useState<CaptionSegment[] | null>(null)
  const [romanising, setRomanising] = useState(false)
  const [captionTranslation, setCaptionTranslation] = useState<CaptionSegment[] | null>(null)
  const [captionView, setCaptionView] = useState<'source' | 'translation'>('source')
  const [translatingCaptions, setTranslatingCaptions] = useState(false)
  const [captionLoading, setCaptionLoading] = useState(false)
  const [captionError, setCaptionError] = useState<string | null>(null)
  const [captionEditorOpen, setCaptionEditorOpen] = useState(false)
  const [captionEditorLoading, setCaptionEditorLoading] = useState(false)
  const [captionEditorError, setCaptionEditorError] = useState<string | null>(null)
  const [captionEditorDuration, setCaptionEditorDuration] = useState<number | null>(null)
  const [captionEditorScript, setCaptionEditorScript] = useState<NepaliScript | null>(null)
  const [downloadingEditorVideo, setDownloadingEditorVideo] = useState(false)
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
  const captionEditorRequest = useRef(0)
  const romanRequest = useRef(0)
  const romanTimer = useRef<number | null>(null)
  const captionScriptRef = useRef<CaptionSettings['nepali_script']>('devanagari')
  const captionRomanEditedRef = useRef(false)
  const captionJobLoaded = useRef<string | null>(null)
  const restoreAttempted = useRef(false)

  const activeCaptionSegments =
    captionView === 'translation' && captionTranslation ? captionTranslation : captionSegments
  const captionUploadId = preview?.upload_id ?? null
  const captionEditorUploadId = preview?.upload_id ?? null
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

  const captionEditSettings =
    step === 'caption' ? captionSettings : (job?.settings.captions ?? settings.captions)
  const captionEditScript: NepaliScript =
    captionEditorScript ??
    (step === 'caption'
      ? captionSettings.nepali_script
      : (job?.settings.captions.nepali_script ?? settings.captions.nepali_script)) ??
    'devanagari'
  const captionEditDuration =
    captionEditorDuration ??
    captionTranscript?.duration ??
    preview?.duration ??
    job?.video?.duration ??
    0
  const captionEditLanguage = step === 'caption' ? captionLanguage : clipLanguage
  const captionEditQuality = step === 'caption' ? captionQuality : clipQuality
  const captionEditTask: TranscriptionTask =
    step === 'caption' ? captionTask : clipTranslate ? 'translate' : 'transcribe'
  const captionDraftKey = job?.id
    ? `job:${job.id}`
    : captionEditorUploadId
      ? `upload:${captionEditorUploadId}`
      : preview?.normalized_url
        ? `url:${preview.normalized_url}`
        : null

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

  // Keep the script choice readable from long-lived async callbacks (for
  // example a transcription that was already running when Roman was chosen).
  useEffect(() => {
    captionScriptRef.current =
      step === 'caption'
        ? (captionSettings.nepali_script ?? 'devanagari')
        : (settings.captions.nepali_script ?? 'devanagari')
  }, [captionSettings.nepali_script, settings.captions.nepali_script, step])

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

  const cancelRomanisation = useCallback(() => {
    romanRequest.current += 1
    if (romanTimer.current !== null) {
      window.clearTimeout(romanTimer.current)
      romanTimer.current = null
    }
    setRomanising(false)
  }, [])

  const loadRomanSegments = useCallback(
    async (source: CaptionSegment[]) => {
      const requestId = ++romanRequest.current
      if (!source.length) {
        setCaptionRomanSegments([])
        setRomanising(false)
        return
      }
      setRomanising(true)
      try {
        const response = await romanizeCaptions(source)
        if (romanRequest.current !== requestId) return
        setCaptionRomanSegments(response.segments)
        captionRomanEditedRef.current = false
        writeCaptionDraft(captionDraftKey, {
          segments: source,
          romanSegments: response.segments,
          romanEdited: false,
          script: 'roman',
        })
      } catch (error) {
        if (romanRequest.current !== requestId) return
        setCaptionRomanSegments(null)
        toast.error(errorMessage(error))
      } finally {
        if (romanRequest.current === requestId) setRomanising(false)
      }
    },
    [captionDraftKey, toast],
  )

  const scheduleRomanSegments = useCallback(
    (source: CaptionSegment[]) => {
      if (romanTimer.current !== null) window.clearTimeout(romanTimer.current)
      // Mark the mirror stale immediately so the SRT button waits for the
      // refreshed text instead of exporting the previous edit.
      setRomanising(true)
      romanTimer.current = window.setTimeout(() => {
        romanTimer.current = null
        void loadRomanSegments(source)
      }, 250)
    },
    [loadRomanSegments],
  )

  useEffect(
    () => () => {
      if (romanTimer.current !== null) window.clearTimeout(romanTimer.current)
    },
    [],
  )

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
        if (force) clearCaptionDraft(`upload:${uploadId}`)
        const response = await transcribeCaptions(uploadId, language, force, quality, task)
        if (captionRequest.current !== requestId) return null
        const draft = force ? null : readCaptionDraft(`upload:${uploadId}`)
        const segments = draft?.segments ?? response.segments
        const roman = draft?.romanSegments ?? null
        const romanEdited = draft?.romanEdited === true
        const script = draft?.script ?? captionScriptRef.current
        setCaptionTranscript(response)
        setCaptionSegments(segments)
        setCaptionTranslation(null)
        setCaptionView('source')
        setCaptionRomanSegments(roman)
        captionRomanEditedRef.current = romanEdited
        cancelRomanisation()
        if (draft?.script) {
          captionScriptRef.current = draft.script
          setCaptionEditorScript(draft.script)
          setCaptionSettings((current) => ({ ...current, nepali_script: draft.script }))
          setSettings((current) => ({
            ...current,
            captions: { ...current.captions, nepali_script: draft.script },
          }))
        }
        const translated = response.translated === true || task === 'translate'
        const hasDevanagari = segments.some((segment) => DEVANAGARI_RE.test(segment.text))
        if (!translated && hasDevanagari && script === 'roman' && !roman?.length) {
          void loadRomanSegments(segments)
        }
        // Auto-detection can return Nepali even when the user left the language
        // on "Detect language". Switch the editor to a Devanagari face in that
        // case too, not only when नेपाली was chosen explicitly.
        if (!translated && (language === 'ne' || response.language === 'ne')) {
          setCaptionSettings((current) =>
            DEVANAGARI_FONTS.has(current.font) ? current : { ...current, font: 'Mukta' },
          )
        }
        if (segments.length) {
          toast.success(
            translated
              ? `English translation ready · ${segments.length} editable lines`
              : `Speech transcribed · ${segments.length} editable lines`,
          )
        } else {
          toast.info('No speech detected. You can add caption lines manually.')
        }
        return segments
      } catch (error) {
        if (captionRequest.current !== requestId) return null
        setCaptionError(errorMessage(error))
        return null
      } finally {
        if (captionRequest.current === requestId) setCaptionLoading(false)
      }
    },
    [cancelRomanisation, captionQuality, captionTask, loadRomanSegments, toast],
  )

  const persistCaptionDraft = useCallback(
    (source: CaptionSegment[], roman: CaptionSegment[] | null, script: NepaliScript) => {
      writeCaptionDraft(captionDraftKey, {
        segments: source,
        romanSegments: roman,
        romanEdited: captionRomanEditedRef.current,
        script,
      })
    },
    [captionDraftKey],
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
      let nextRoman = captionRomanSegments
      if (captionScriptRef.current === 'roman') {
        // Manual Roman edits are preserved; otherwise refresh the mirror.
        if (!captionRomanEditedRef.current) scheduleRomanSegments(next)
      } else if (!captionRomanEditedRef.current) {
        // The next switch to Roman should translate the new source text.
        setCaptionRomanSegments(null)
        nextRoman = null
      }
      persistCaptionDraft(next, nextRoman, captionScriptRef.current)
    },
    [
      captionRomanSegments,
      captionTranslation,
      captionView,
      persistCaptionDraft,
      scheduleRomanSegments,
    ],
  )

  const updateRomanSegments = useCallback(
    (next: CaptionSegment[]) => {
      setCaptionRomanSegments(next)
      captionRomanEditedRef.current = true
      persistCaptionDraft(captionSegments, next, 'roman')
    },
    [captionSegments, persistCaptionDraft],
  )

  const changeCaptionSettings = useCallback(
    (next: CaptionSettings) => {
      const nextScript = next.nepali_script ?? 'devanagari'
      const scriptChanged = captionScriptRef.current !== nextScript
      captionScriptRef.current = nextScript
      setCaptionEditorScript(nextScript)
      setCaptionSettings(next)
      let nextRoman = captionRomanSegments
      if (scriptChanged) {
        if (nextScript === 'roman') {
          if (captionRomanEditedRef.current && captionRomanSegments?.length) {
            // Keep the user's hand-edited Roman lines.
          } else if (captionSegments.length) {
            scheduleRomanSegments(captionSegments)
          } else {
            setCaptionRomanSegments(null)
            nextRoman = null
          }
        } else {
          // Devanagari is the canonical text; stop any pending mirror work.
          cancelRomanisation()
        }
      }
      persistCaptionDraft(captionSegments, nextRoman, nextScript)
    },
    [
      cancelRomanisation,
      captionRomanSegments,
      captionSegments,
      persistCaptionDraft,
      scheduleRomanSegments,
    ],
  )

  const changeCaptionScript = useCallback(
    (value: NepaliScript) => {
      captionScriptRef.current = value
      setCaptionEditorScript(value)
      setCaptionSettings((current) => ({ ...current, nepali_script: value }))
      setSettings((current) => ({
        ...current,
        captions: { ...current.captions, nepali_script: value },
      }))
      if (value === 'roman') {
        if (!captionRomanEditedRef.current) {
          if (captionSegments.length) scheduleRomanSegments(captionSegments)
        }
      } else {
        cancelRomanisation()
      }
      persistCaptionDraft(captionSegments, captionRomanSegments, value)
    },
    [
      cancelRomanisation,
      captionRomanSegments,
      captionSegments,
      persistCaptionDraft,
      scheduleRomanSegments,
    ],
  )

  const translateGeneratedCaptions = useCallback(async () => {
    if (!captionSegments.length) {
      toast.info('Generate Nepali subtitle lines first.')
      return null
    }
    setTranslatingCaptions(true)
    try {
      const response = captionUploadId
        ? await translateCaptions(
            captionUploadId,
            captionSegments,
            captionQuality,
            captionSourceLanguage,
          )
        : job?.id
          ? await translateJobCaptions(
              job.id,
              captionSegments,
              captionQuality,
              captionSourceLanguage,
            )
          : null
      if (!response) {
        toast.info('Render or upload this video once before translating its lines.')
        return null
      }
      setCaptionTranslation(response.segments)
      if (step === 'caption') setCaptionView('translation')
      const warning = response.warnings[0]
      if (warning) toast.info(warning)
      toast.success(`English subtitles ready · ${response.segments.length} lines`)
      return response.segments
    } catch (error) {
      toast.error(errorMessage(error))
      return null
    } finally {
      setTranslatingCaptions(false)
    }
  }, [captionQuality, captionSegments, captionSourceLanguage, captionUploadId, job, step, toast])

  const uploadLocalFile = useCallback(
    async (file: File) => {
      captionRequest.current += 1
      cancelRomanisation()
      setCaptionRomanSegments(null)
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
    [cancelRomanisation, captionLanguage, captionQuality, loadCaptionTranscript, sourceMode, toast],
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
        // Nepali on the medium model is noticeably less exact. Default the
        // dedicated large-v3 tier unless the user already chose Maximum.
        setClipQuality((current) => (current === 'maximum' ? current : 'best'))
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
    cancelRomanisation()
    setCaptionRomanSegments(null)
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
    setCaptionEditorOpen(false)
    setCaptionEditorScript(null)
    setCaptionEditorDuration(null)
    captionRomanEditedRef.current = false
    captionJobLoaded.current = null
    setStep('link')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [cancelRomanisation])

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
      const editedSegments =
        settings.captions.nepali_script === 'roman' && captionRomanSegments?.length
          ? captionRomanSegments
          : captionSegments
      const englishSegments = captionTranslation ?? []
      const useEnglish =
        !clipTranslate && englishSegments.length > 0 && settings.captions.secondary_enabled
      const primarySegments = useEnglish ? englishSegments : editedSegments
      const secondarySegments = useEnglish ? editedSegments : undefined
      const newJob = await createJob(source, settings, {
        language: clipLanguage === 'auto' ? null : clipLanguage,
        quality: clipQuality,
        task: clipTranslate ? 'translate' : 'transcribe',
        // Reuse lines edited in the shared caption editor. A one-pass
        // translation replaces the spoken words, so only pass source lines
        // when translation is off. An added English track becomes the main
        // line with the Nepali source above it.
        segments: !clipTranslate && primarySegments.length ? primarySegments : undefined,
        secondarySegments,
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
  }, [
    captionRomanSegments,
    captionSegments,
    captionTranslation,
    clipLanguage,
    clipQuality,
    clipTranslate,
    preview,
    settings,
    toast,
  ])

  const startCaptionRender = useCallback(async () => {
    if (!preview?.upload_id || generationRef.current) return
    const romanActive = (captionSettings.nepali_script ?? 'devanagari') === 'roman'
    const primarySegments =
      romanActive && captionRomanSegments?.length ? captionRomanSegments : activeCaptionSegments
    if (!primarySegments.length) {
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
    // When an English translation exists and bilingual captions are on, burn
    // the Nepali source lines in a Devanagari font above the English line.
    const useBilingual =
      Boolean(captionTranslation?.length) &&
      captionSettings.secondary_enabled &&
      captionSegments.length > 0
    const renderSegments = useBilingual ? (captionTranslation ?? []) : primarySegments
    try {
      const newJob = await createJob({ uploadId: preview.upload_id }, renderSettings, {
        mode: 'captions',
        segments: renderSegments,
        secondarySegments: useBilingual ? captionSegments : undefined,
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
    captionRomanSegments,
    captionSegments,
    captionSettings,
    captionTranslation,
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

  const loadJobCaptions = useCallback(
    async (jobId: string, notify = false) => {
      const requestId = ++captionEditorRequest.current
      setCaptionEditorLoading(true)
      setCaptionEditorError(null)
      try {
        const response = await getJobCaptions(jobId)
        if (requestId !== captionEditorRequest.current) return null
        const draft = readCaptionDraft(`job:${jobId}`)
        const segments = draft?.segments ?? response.segments
        const roman = draft?.romanSegments ?? null
        const romanEdited = draft?.romanEdited === true
        const script = draft?.script ?? captionEditScript
        captionScriptRef.current = script
        setCaptionEditorDuration(response.duration)
        setCaptionSegments(segments)
        setCaptionRomanSegments(roman)
        captionRomanEditedRef.current = romanEdited
        if (draft?.script) {
          captionScriptRef.current = draft.script
          setCaptionEditorScript(draft.script)
          setCaptionSettings((current) => ({ ...current, nepali_script: draft.script }))
          setSettings((current) => ({
            ...current,
            captions: { ...current.captions, nepali_script: draft.script },
          }))
        }
        if (script === 'roman' && segments.length && !roman?.length) {
          void loadRomanSegments(segments)
        }
        if (notify && !segments.length) {
          toast.info('No caption lines were found for this export. You can add them manually.')
        }
        return segments
      } catch (error) {
        if (requestId === captionEditorRequest.current) {
          setCaptionEditorError(errorMessage(error))
        }
        return null
      } finally {
        if (requestId === captionEditorRequest.current) setCaptionEditorLoading(false)
      }
    },
    [captionEditScript, loadRomanSegments, toast],
  )

  const openCaptionEditor = useCallback(async () => {
    setCaptionEditorOpen(true)
    setCaptionEditorError(null)
    if (captionSegments.length || captionTranscript) {
      if (captionEditScript === 'roman' && !captionRomanSegments && !romanising) {
        void loadRomanSegments(captionSegments)
      }
      return
    }
    if (job?.id) {
      await loadJobCaptions(job.id, true)
      return
    }
    if (preview?.upload_id) {
      setCaptionEditorDuration(preview.duration)
      await loadCaptionTranscript(
        preview.upload_id,
        captionEditLanguage,
        false,
        captionEditQuality,
        captionEditTask,
      )
      return
    }
    if (preview) {
      // Paste-link sources are downloaded by the render worker, so there is
      // no upload transcript yet. Let the user add lines now; they are passed
      // to the first render and become fully editable from its results.
      setCaptionEditorDuration(preview.duration)
      const draft = readCaptionDraft(`url:${preview.normalized_url}`)
      if (draft) {
        setCaptionSegments(draft.segments)
        setCaptionRomanSegments(draft.romanSegments)
        captionRomanEditedRef.current = draft.romanEdited
        if (draft.script !== captionScriptRef.current) {
          captionScriptRef.current = draft.script
          setCaptionEditorScript(draft.script)
          setCaptionSettings((current) => ({ ...current, nepali_script: draft.script }))
          setSettings((current) => ({
            ...current,
            captions: { ...current.captions, nepali_script: draft.script },
          }))
        }
      }
      return
    }
    setCaptionEditorError('Choose a video before editing captions.')
  }, [
    captionEditLanguage,
    captionEditQuality,
    captionEditScript,
    captionEditTask,
    captionRomanSegments,
    captionSegments,
    captionTranscript,
    job,
    loadCaptionTranscript,
    loadJobCaptions,
    loadRomanSegments,
    preview,
    romanising,
  ])

  // Caption edits are saved as they are typed; closing the drawer must never
  // discard them or force a re-render.
  const closeCaptionEditor = useCallback(() => {
    setCaptionEditorOpen(false)
    setCaptionEditorError(null)
  }, [])

  const transcribeForCaptionEditor = useCallback(async () => {
    if (!captionEditorUploadId) return
    const requestId = ++captionEditorRequest.current
    setCaptionEditorLoading(true)
    setCaptionEditorError(null)
    try {
      await loadCaptionTranscript(
        captionEditorUploadId,
        captionEditLanguage,
        true,
        captionEditQuality,
        captionEditTask,
      )
      if (requestId === captionEditorRequest.current) {
        clearCaptionDraft(`upload:${captionEditorUploadId}`)
      }
    } finally {
      if (requestId === captionEditorRequest.current) setCaptionEditorLoading(false)
    }
  }, [
    captionEditLanguage,
    captionEditQuality,
    captionEditTask,
    captionEditorUploadId,
    loadCaptionTranscript,
  ])

  const applyCaptionEdits = useCallback(() => {
    // Text edits are already saved; downloads render the latest lines.
    setCaptionEditorOpen(false)
  }, [])

  const prepareVideoWithCaptions = useCallback(
    async (
      captions: CaptionSettings,
      segments: CaptionSegment[],
      secondarySegments?: CaptionSegment[],
    ): Promise<Job> => {
      if (!job) throw new Error('This export is no longer available.')
      if (!segments.length) throw new Error('Add at least one caption line first.')
      const queued = await restyleJob(job.id, captions, segments, secondarySegments)
      let current = queued
      const deadline = Date.now() + 10 * 60 * 1000
      while (current.status === 'queued' || current.status === 'running') {
        if (Date.now() > deadline) {
          throw new Error('Preparing the updated video is taking too long. Please try again.')
        }
        await new Promise((resolve) => window.setTimeout(resolve, 700))
        current = await getJob(current.id)
      }
      if (current.status !== 'completed') {
        throw new Error(current.error_message || 'The updated video could not be prepared.')
      }
      clearCaptionDraft(`job:${job.id}`)
      captionJobLoaded.current = current.id
      storeActiveJob(current)
      setSettings(current.settings)
      setCaptionSettings(current.settings.captions)
      setCaptionEditorDuration(current.video?.duration ?? null)
      // Keep the canonical Devanagari source when the Roman track is the one
      // being rendered; only fill an empty editor from the prepared lines.
      setCaptionSegments((existing) => (existing.length ? existing : segments))
      setRestyleParent(job)
      setJobId(current.id)
      setCreatedJob(current)
      return current
    },
    [job],
  )

  const downloadEditorVideo = useCallback(async () => {
    if (!job || downloadingEditorVideo) return
    const script = captionEditScript
    const segments =
      script === 'roman' && captionRomanSegments?.length ? captionRomanSegments : captionSegments
    if (!segments.length) {
      toast.info('Add at least one caption line before downloading.')
      return
    }
    const english = captionTranslation ?? []
    const primary = english.length ? english : segments
    const secondary = english.length ? segments : undefined
    const captions = {
      ...(step === 'caption' ? captionSettings : settings.captions),
      enabled: true,
      nepali_script: script,
      secondary_enabled: Boolean(secondary),
    }
    setDownloadingEditorVideo(true)
    try {
      const prepared = await prepareVideoWithCaptions(captions, primary, secondary)
      const link = document.createElement('a')
      if (prepared.mode === 'captions' && prepared.clips[0]) {
        link.href = assetUrl(prepared.clips[0].download_url)
        link.download = prepared.clips[0].filename
      } else {
        link.href = downloadAllUrl(prepared)
        link.download = 'cutclipper-clips.zip'
      }
      document.body.appendChild(link)
      link.click()
      link.remove()
      toast.success('Downloading your updated captions.')
      setCaptionEditorOpen(false)
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setDownloadingEditorVideo(false)
    }
  }, [
    captionEditScript,
    captionRomanSegments,
    captionSegments,
    captionSettings,
    captionTranslation,
    downloadingEditorVideo,
    job,
    prepareVideoWithCaptions,
    settings.captions,
    step,
    toast,
  ])

  useEffect(() => {
    if (step !== 'results' || !job?.id || captionSegments.length || captionEditorLoading) return
    if (captionJobLoaded.current === job.id) return
    captionJobLoaded.current = job.id
    void loadJobCaptions(job.id)
  }, [captionEditorLoading, captionSegments.length, job?.id, loadJobCaptions, step])

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
    cancelRomanisation()
    setCaptionRomanSegments(null)
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
    setCaptionEditorOpen(false)
    setCaptionEditorScript(null)
    setCaptionEditorDuration(null)
    captionRomanEditedRef.current = false
    captionJobLoaded.current = null
    setCancelling(false)
    handledStatus.current = null
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [cancelRomanisation])

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
          onEditCaptions={step === 'link' ? undefined : () => void openCaptionEditor()}
        />
        <main
          id="main"
          className={`mx-auto w-full max-w-7xl flex-1 px-4 sm:px-6 lg:px-8 ${
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
                  sourceSegments={captionSegments}
                  romanSegments={captionRomanSegments}
                  romanising={romanising}
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
                      // Best = large-v3; it is the tier that gets Nepali close
                      // to perfect. Users can still pick Fast or Balanced.
                      setCaptionQuality((current) => (current === 'maximum' ? current : 'best'))
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
                  onRomanSegmentsChange={updateRomanSegments}
                  exportResolution={captionResolution}
                  exportQuality={captionExportQuality}
                  onExportResolutionChange={setCaptionResolution}
                  onExportQualityChange={setCaptionExportQuality}
                  captions={captionSettings}
                  onCaptionsChange={changeCaptionSettings}
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
                  onEditCaptions={() => void openCaptionEditor()}
                  captionSegments={captionSegments}
                  captionRomanSegments={captionRomanSegments}
                  captionScript={captionEditScript}
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
                  onEditCaptions={() => void openCaptionEditor()}
                  generating={generating}
                />
              ) : null}

              {step === 'results' && job ? (
                <ResultsStep
                  job={job}
                  captionSegments={captionSegments}
                  captionRomanSegments={captionRomanSegments}
                  captionTranslation={captionTranslation}
                  translatingEnglish={translatingCaptions}
                  onTranslateEnglish={translateGeneratedCaptions}
                  captionScript={captionEditScript}
                  onNewProject={startOver}
                  onEditSettings={editSettings}
                  onEditCaptions={() => void openCaptionEditor()}
                  captionStyle={captionEditSettings}
                  onCaptionStyleChange={(captions) => {
                    setCaptionSettings(captions)
                    setSettings((current) => ({ ...current, captions }))
                  }}
                  onPrepareVideo={prepareVideoWithCaptions}
                  canEditSettings={Boolean(preview)}
                />
              ) : null}
            </motion.div>
          </AnimatePresence>
        </main>

        <SiteFooter />
      </div>

      <CaptionEditorDrawer
        open={captionEditorOpen}
        onClose={closeCaptionEditor}
        segments={
          captionEditScript === 'roman' ? (captionRomanSegments ?? []) : activeCaptionSegments
        }
        duration={captionEditDuration}
        onChange={captionEditScript === 'roman' ? updateRomanSegments : updateActiveCaptionSegments}
        script={captionEditScript}
        onScriptChange={changeCaptionScript}
        devanagariFont={captionEditSettings.secondary_font}
        captionSettings={captionEditSettings}
        onCaptionSettingsChange={changeCaptionSettings}
        englishSegments={captionTranslation}
        translatingEnglish={translatingCaptions}
        onTranslateEnglish={translateGeneratedCaptions}
        onDownloadEnglishSrt={
          captionTranslation?.length
            ? () =>
                downloadSrt(
                  captionTranslation,
                  `${job?.video?.title || preview?.title || 'cutclipper-captions'}.en.srt`,
                )
            : undefined
        }
        romanSegments={captionRomanSegments}
        romanising={romanising}
        loading={
          captionEditorLoading ||
          captionLoading ||
          (captionEditScript === 'roman' && !captionRomanSegments && romanising)
        }
        loadingText={
          captionLoading
            ? 'Listening for speech…'
            : captionEditScript === 'roman' && romanising
              ? 'Preparing the Roman caption track…'
              : 'Loading caption lines…'
        }
        error={
          captionEditorError ??
          ((captionEditScript === 'roman' ? captionRomanSegments : activeCaptionSegments)?.length
            ? null
            : captionError)
        }
        onTranscribe={
          step !== 'processing' && captionEditorUploadId ? transcribeForCaptionEditor : undefined
        }
        transcribing={captionLoading || captionEditorLoading}
        canTranscribe={step !== 'processing' && Boolean(captionEditorUploadId)}
        notice={
          step === 'processing'
            ? 'This export is rendering. Your edits save instantly; download the updated clip when it finishes.'
            : step === 'caption'
              ? 'Edits save instantly in the studio. Switch to Roman to edit that track directly.'
              : step === 'results'
                ? 'Edits save instantly. Download video renders the latest lines and style automatically.'
                : 'Edits save instantly and will be used by the next render. Switch to Roman to edit that track directly.'
        }
        applyLabel="Save & close"
        onApply={applyCaptionEdits}
        onDownloadVideo={job?.status === 'completed' ? () => void downloadEditorVideo() : undefined}
        downloadingVideo={downloadingEditorVideo}
        onDownloadSrt={() =>
          downloadSrt(
            captionEditScript === 'roman' && captionRomanSegments?.length
              ? captionRomanSegments
              : activeCaptionSegments,
            `${job?.video?.title || preview?.title || 'cutclipper-captions'}.srt`,
          )
        }
      />
    </div>
  )
}

function SiteFooter() {
  return (
    <footer className="relative z-10 pb-8 pt-4">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="border-t-[1.5px] border-dashed border-ink/30 pt-5">
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
                made with <Heart className="h-3 w-3 fill-tomato text-tomato" aria-hidden="true" />{' '}
                on paper
              </span>
            </div>
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
