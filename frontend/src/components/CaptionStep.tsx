import { useEffect, useRef, useState, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import {
  ArrowLeft,
  Captions,
  Check,
  Clock3,
  FileText,
  Film,
  Languages,
  LoaderCircle,
  Palette,
  Play,
  Plus,
  Scissors,
  Sparkles,
  Trash2,
  TriangleAlert,
  Type,
  WandSparkles,
} from 'lucide-react'
import type {
  CaptionSegment,
  CaptionSettings,
  PreviewResponse,
  TranscriptResponse,
  TranscriptionQuality,
  TranscriptionTask,
} from '../types/api'
import { uploadVideoUrl } from '../lib/api'
import { downloadSrt } from '../lib/srt'
import { cn, formatDuration } from '../lib/utils'
import { Button, Pill, SectionCard } from './ui'
import { CaptionPreview } from './CaptionPreview'
import { CaptionStyleControls } from './CaptionControls'

interface CaptionStepProps {
  preview: PreviewResponse
  transcript: TranscriptResponse | null
  segments: CaptionSegment[]
  loading: boolean
  error: string | null
  language: string
  quality: TranscriptionQuality
  task: TranscriptionTask
  onLanguageChange: (language: string) => void
  onQualityChange: (quality: TranscriptionQuality) => void
  onTaskChange: (task: TranscriptionTask) => void
  onTranscribe: (force: boolean, task?: TranscriptionTask) => void
  onSegmentsChange: (segments: CaptionSegment[]) => void
  captions: CaptionSettings
  onCaptionsChange: (captions: CaptionSettings) => void
  onBack: () => void
  onRender: () => void
  generating: boolean
}

const LANGUAGES = [
  { value: 'auto', label: 'Detect language' },
  { value: 'en', label: 'English' },
  { value: 'ne', label: 'नेपाली · Nepali' },
  { value: 'hi', label: 'हिन्दी · Hindi' },
]

function qualityOptionsFor(
  language: string,
): Array<{ value: TranscriptionQuality; label: string; detail: string }> {
  return language === 'ne'
    ? [
        { value: 'fast', label: 'Fast', detail: 'small · quick' },
        { value: 'balanced', label: 'Balanced', detail: 'small' },
        { value: 'best', label: 'Best', detail: 'medium' },
        { value: 'maximum', label: 'Maximum', detail: 'large-v3' },
      ]
    : [
        { value: 'fast', label: 'Fast', detail: 'base' },
        { value: 'balanced', label: 'Balanced', detail: 'small' },
        { value: 'best', label: 'Best', detail: 'medium' },
        { value: 'maximum', label: 'Maximum', detail: 'large-v3' },
      ]
}

function formatTimecode(value: number): string {
  const minutes = Math.floor(value / 60)
  const seconds = Math.floor(value % 60)
  const tenths = Math.floor((value % 1) * 10)
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${tenths}`
}

export function CaptionStep({
  preview,
  transcript,
  segments,
  loading,
  error,
  language,
  quality,
  task,
  onLanguageChange,
  onQualityChange,
  onTaskChange,
  onTranscribe,
  onSegmentsChange,
  captions,
  onCaptionsChange,
  onBack,
  onRender,
  generating,
}: CaptionStepProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const [currentTime, setCurrentTime] = useState(0)
  const [stageHeight, setStageHeight] = useState(480)
  const [selectedSegment, setSelectedSegment] = useState<number | null>(null)

  useEffect(() => {
    const element = stageRef.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setStageHeight(entry.contentRect.height)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const activeIndex = segments.findIndex(
    (segment) => currentTime >= segment.start - 0.02 && currentTime < segment.end,
  )

  const updateSegment = (index: number, patch: Partial<CaptionSegment>) => {
    const next = segments.map((segment, position) =>
      position === index ? { ...segment, ...patch } : segment,
    )
    onSegmentsChange(next)
  }

  const deleteSegment = (index: number) => {
    onSegmentsChange(segments.filter((_, position) => position !== index))
    setSelectedSegment(null)
  }

  const mergeWithNext = (index: number) => {
    const current = segments[index]
    const next = segments[index + 1]
    if (!current || !next) return
    const merged: CaptionSegment = {
      start: current.start,
      end: Math.max(current.end, next.end),
      text: `${current.text} ${next.text}`.trim(),
    }
    onSegmentsChange([...segments.slice(0, index), merged, ...segments.slice(index + 2)])
  }

  const splitSegment = (index: number) => {
    const current = segments[index]
    if (!current) return
    const words = current.text.split(/\s+/).filter(Boolean)
    if (words.length < 2) return
    const splitAt =
      currentTime > current.start + 0.15 && currentTime < current.end - 0.15
        ? currentTime
        : current.start + (current.end - current.start) / 2
    const ratio = (splitAt - current.start) / Math.max(0.05, current.end - current.start)
    const splitIndex = Math.min(words.length - 1, Math.max(1, Math.round(words.length * ratio)))
    const left = words.slice(0, splitIndex).join(' ')
    const right = words.slice(splitIndex).join(' ')
    onSegmentsChange([
      ...segments.slice(0, index),
      { start: current.start, end: splitAt, text: left },
      { start: splitAt, end: current.end, text: right },
      ...segments.slice(index + 1),
    ])
  }

  const addSegment = () => {
    const last = segments[segments.length - 1]
    const start = last ? Math.min(preview.duration - 0.5, last.end + 0.15) : 0
    const end = Math.max(start + 1, Math.min(preview.duration, start + 3))
    onSegmentsChange([
      ...segments,
      { start: Number(start.toFixed(2)), end: Number(end.toFixed(2)), text: 'New caption' },
    ])
    setSelectedSegment(segments.length)
  }

  const jumpTo = (start: number) => {
    const video = videoRef.current
    if (!video) return
    video.currentTime = Math.max(0, start)
    setCurrentTime(video.currentTime)
    void video.play()
  }

  const stageFontSize = Math.max(
    13,
    (captions.font_size / Math.max(1, preview.height || 1080)) * stageHeight,
  )

  return (
    <div className="mx-auto w-full max-w-7xl">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
        className="flex flex-wrap items-end justify-between gap-4"
      >
        <div>
          <button
            type="button"
            onClick={onBack}
            className="mb-4 inline-flex items-center gap-1.5 text-[11px] font-semibold text-ink-soft transition hover:text-tomato"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            Back to add video
          </button>
          <p className="flex items-center gap-2 text-[9.5px] font-bold uppercase tracking-[0.18em] text-tomato">
            <span className="h-px w-5 bg-tomato" aria-hidden="true" />
            Caption studio · {preview.upload_id ? 'Local file' : 'Video'}
          </p>
          <div className="mt-2 flex flex-wrap items-end gap-x-4">
            <h1 className="font-display text-4xl font-semibold tracking-[-0.05em] text-ink sm:text-[2.9rem]">
              Caption every word.
            </h1>
            <span className="mb-1.5 hidden -rotate-2 font-hand text-[18px] text-ink-soft sm:inline">
              every single one
            </span>
          </div>
          <p className="mt-2 max-w-2xl text-[12.5px] leading-6 text-ink-soft">
            Transcribe, fix mistakes line by line, style the captions, and preview the result before
            rendering the full video. Nepali speech is supported with dedicated models and
            Devanagari fonts.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Pill tone="cyan" className="gap-1.5">
            <Film className="h-3 w-3" aria-hidden="true" />
            {preview.title}
          </Pill>
          <Pill className="gap-1.5">
            <Clock3 className="h-3 w-3" aria-hidden="true" />
            {formatDuration(preview.duration)}
          </Pill>
          <Pill className="gap-1.5">
            <Captions className="h-3 w-3" aria-hidden="true" />
            {segments.length} lines
          </Pill>
        </div>
      </motion.div>

      <div className="mt-7 grid gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
        <div className="space-y-5">
          <div className="paper-card taped overflow-hidden p-2.5">
            <div
              ref={stageRef}
              className="relative overflow-hidden rounded-xl bg-black"
              style={{
                aspectRatio: `${preview.width || 16} / ${preview.height || 9}`,
              }}
            >
              <video
                ref={videoRef}
                src={preview.upload_id ? uploadVideoUrl(preview.upload_id) : undefined}
                poster={preview.thumbnail_url ?? undefined}
                controls
                playsInline
                preload="metadata"
                className="h-full w-full object-contain"
                onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
                onSeeked={(event) => setCurrentTime(event.currentTarget.currentTime)}
              />
              <CaptionPreview
                settings={captions}
                segments={segments}
                words={transcript?.words ?? []}
                time={currentTime}
                video={videoRef}
                fontSize={stageFontSize}
                className="absolute inset-0"
              />
            </div>
            <div className="flex items-center justify-between gap-3 border-t border-dashed border-ink/20 px-2 pb-1 pt-3 text-[10.5px] font-medium text-ink-soft">
              <span className="inline-flex items-center gap-1.5">
                <Sparkles className="h-3 w-3 text-tomato/70" aria-hidden="true" />
                Live preview · captions render in sync with playback
              </span>
              <span className="font-display tabular-nums text-ink-soft">
                {formatTimecode(currentTime)} / {formatTimecode(preview.duration)}
              </span>
            </div>
          </div>

          <SectionCard
            icon={Captions}
            eyebrow="Transcript"
            title="Fix anything the model got wrong"
            tone="tomato"
            description="Edit text, adjust timing, split or merge lines, and preview each line instantly."
            action={
              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  icon={Plus}
                  onClick={addSegment}
                  disabled={loading || generating}
                >
                  Add line
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={WandSparkles}
                  loading={loading}
                  onClick={() => onTranscribe(true)}
                  disabled={generating}
                >
                  Re-transcribe
                </Button>
              </div>
            }
          >
            {loading ? (
              <div className="paper-inset flex flex-col items-center justify-center gap-3 px-4 py-12 text-center">
                <LoaderCircle className="h-6 w-6 animate-spin text-tomato" aria-hidden="true" />
                <p className="text-sm font-medium text-ink">Listening for speech…</p>
                <p className="max-w-sm text-[12px] leading-5 text-ink-soft">
                  {language === 'ne'
                    ? 'Nepali uses a larger Whisper model, so the first run can take a little longer.'
                    : 'The first run downloads the speech model once, then transcription is much faster.'}
                </p>
              </div>
            ) : null}

            {!loading && error ? (
              <div
                role="alert"
                className="mb-4 flex items-start gap-2.5 rounded-xl border-[1.5px] border-ink bg-tomato-soft px-4 py-3 text-sm font-medium text-ink shadow-[2px_2px_0_#211d19]"
              >
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-tomato" aria-hidden="true" />
                <p className="leading-relaxed">{error}</p>
              </div>
            ) : null}

            {!loading && !error && transcript?.warnings.length ? (
              <div className="mb-4 rounded-xl border-[1.5px] border-ink bg-mustard-soft px-3.5 py-2.5 text-[12px] font-medium leading-5 text-ink shadow-[2px_2px_0_#211d19]">
                {transcript.warnings.join(' ')}
              </div>
            ) : null}

            {!loading && !segments.length ? (
              <div className="rounded-xl border-[1.5px] border-dashed border-ink/30 bg-paper px-5 py-10 text-center">
                <Type className="mx-auto h-6 w-6 text-ink-faint" aria-hidden="true" />
                <p className="mt-3 text-sm font-medium text-ink-soft">No caption lines yet</p>
                <p className="mx-auto mt-1 max-w-md text-[12px] leading-5 text-ink-soft">
                  {transcript
                    ? 'No speech was detected. Add a line manually or try re-transcribing with a specific language.'
                    : 'Transcribe the video to get editable caption lines, or add them manually.'}
                </p>
                <div className="mt-4 flex flex-wrap justify-center gap-2">
                  <Button
                    size="sm"
                    icon={WandSparkles}
                    loading={loading}
                    onClick={() => onTranscribe(false)}
                  >
                    Transcribe speech
                  </Button>
                  <Button size="sm" variant="secondary" icon={Plus} onClick={addSegment}>
                    Add a line
                  </Button>
                </div>
              </div>
            ) : null}

            {!loading && segments.length ? (
              <div className="max-h-[22rem] space-y-2 overflow-y-auto pr-1">
                {segments.map((segment, index) => (
                  <SegmentRow
                    key={index}
                    index={index}
                    segment={segment}
                    duration={preview.duration}
                    active={index === activeIndex || index === selectedSegment}
                    canMerge={index + 1 < segments.length}
                    onChange={(patch) => updateSegment(index, patch)}
                    onFocus={() => setSelectedSegment(index)}
                    onPlay={() => jumpTo(segment.start)}
                    onSplit={() => splitSegment(index)}
                    onMerge={() => mergeWithNext(index)}
                    onDelete={() => deleteSegment(index)}
                  />
                ))}
              </div>
            ) : null}
          </SectionCard>
        </div>

        <div className="space-y-5">
          <SectionCard
            icon={Palette}
            eyebrow="Style"
            title="Make it feel native"
            tone="periwinkle"
            description="19 animated presets and 51 fonts. Playback uses the same timing and style as your export."
          >
            <CaptionStyleControls
              settings={captions}
              onChange={(patch) => onCaptionsChange({ ...captions, ...patch })}
            />

            <div className="mt-5 space-y-4 rounded-xl border-[1.5px] border-ink/25 bg-paper p-3.5">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="caption-language"
                    className="mb-1.5 flex items-center gap-1.5 text-[11.5px] font-medium text-ink-soft"
                  >
                    <Languages className="h-3.5 w-3.5 text-ink-soft" aria-hidden="true" />
                    Spoken language
                  </label>
                  <div className="flex gap-2">
                    <select
                      id="caption-language"
                      value={language}
                      onChange={(event) => onLanguageChange(event.target.value)}
                      className="paper-select h-10 min-w-0 flex-1"
                    >
                      {LANGUAGES.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <Button
                      size="sm"
                      variant="secondary"
                      className="h-10"
                      loading={loading}
                      onClick={() => onTranscribe(true)}
                      disabled={generating}
                    >
                      Retry
                    </Button>
                  </div>
                </div>
                <div>
                  <p className="mb-1.5 text-[11.5px] font-medium text-ink-soft">
                    Transcription accuracy
                  </p>
                  <div className="grid grid-cols-3 gap-1.5">
                    {qualityOptionsFor(language).map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        aria-pressed={quality === option.value}
                        onClick={() => onQualityChange(option.value)}
                        className={cn(
                          'rounded-lg border px-1.5 py-1.5 text-[10.5px] font-medium transition',
                          quality === option.value
                            ? 'border-[1.5px] border-ink bg-mustard-soft text-ink shadow-[2px_2px_0_#211d19]'
                            : 'border-[1.5px] border-ink/25 bg-paper-soft text-ink-soft hover:border-ink hover:text-ink',
                        )}
                      >
                        {option.label}
                        <span className="mt-0.5 block text-[8px] uppercase tracking-[0.1em] text-ink-faint">
                          {option.detail}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-ink/20 bg-paper-soft px-3 py-2.5">
                <div>
                  <p className="text-[11.5px] font-semibold text-ink">
                    {task === 'translate' ? 'English translation' : 'Caption output'}
                  </p>
                  <p className="mt-0.5 text-[9.5px] leading-4 text-ink-soft">
                    {task === 'translate'
                      ? 'Translated from the spoken audio. Timing and animations stay the same; current line edits are replaced.'
                      : 'Words as spoken. Translate them to English in one pass.'}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  icon={WandSparkles}
                  loading={loading}
                  disabled={generating || language === 'en'}
                  onClick={() => {
                    const next = task === 'translate' ? 'transcribe' : 'translate'
                    onTaskChange(next)
                    onTranscribe(true, next)
                  }}
                >
                  {task === 'translate' ? 'Back to spoken words' : 'Translate to English'}
                </Button>
              </div>
              <p className="mt-2 text-[10px] leading-4 text-ink-faint">
                {transcript?.translated
                  ? 'English translation ready. Edit any line below before rendering; the selected animations are applied to the English captions.'
                  : task === 'translate'
                    ? 'Whisper translates the spoken audio to English in one pass. Use Best for harder audio.'
                    : language === 'ne'
                      ? 'Nepali defaults to the fast small model on Metal/int8. Best switches to medium for harder audio.'
                      : transcript?.language
                        ? `Detected: ${transcript.language.toUpperCase()}. Fast / balanced / best map to base / small / medium.`
                        : 'Fast / balanced / best map to base / small / medium. Balanced is a good default.'}
              </p>
            </div>

            <div className="paper-inset mt-6 flex flex-wrap items-center justify-between gap-3 px-3.5 py-3">
              <div className="flex items-center gap-2 text-[11px] text-ink-soft">
                <Check className="h-3.5 w-3.5 text-teal/80" aria-hidden="true" />
                {segments.length} editable lines · {transcript?.words.length ?? 0} words
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  icon={FileText}
                  onClick={() =>
                    downloadSrt(segments, `${preview.title || 'cutclipper-captions'}.srt`)
                  }
                  disabled={!segments.length}
                  aria-label="Download captions as an SRT file"
                >
                  .SRT
                </Button>
                <Button
                  size="sm"
                  icon={Film}
                  loading={generating}
                  onClick={onRender}
                  disabled={!segments.length || loading}
                >
                  Render video
                </Button>
              </div>
            </div>
          </SectionCard>
        </div>
      </div>
    </div>
  )
}

function SegmentRow({
  index,
  segment,
  duration,
  active,
  canMerge,
  onChange,
  onFocus,
  onPlay,
  onSplit,
  onMerge,
  onDelete,
}: {
  index: number
  segment: CaptionSegment
  duration: number
  active: boolean
  canMerge: boolean
  onChange: (patch: Partial<CaptionSegment>) => void
  onFocus: () => void
  onPlay: () => void
  onSplit: () => void
  onMerge: () => void
  onDelete: () => void
}) {
  return (
    <div
      className={cn(
        'rounded-xl border px-2.5 py-2 transition',
        active
          ? 'border-[1.5px] border-ink bg-mustard-soft shadow-[1px_1px_0_#211d19]'
          : 'border-ink/20 bg-paper hover:border-ink/50',
      )}
    >
      <div className="flex items-center gap-2">
        <span className="w-6 shrink-0 font-display text-[10px] tabular-nums text-ink-faint">
          {String(index + 1).padStart(2, '0')}
        </span>
        <label className="sr-only" htmlFor={`caption-start-${index}`}>
          Caption {index + 1} start time
        </label>
        <input
          id={`caption-start-${index}`}
          type="number"
          min={0}
          max={duration}
          step={0.1}
          value={Number(segment.start.toFixed(2))}
          onFocus={onFocus}
          onChange={(event) => {
            const value = Math.max(0, Math.min(duration, Number(event.target.value) || 0))
            onChange({
              start: value,
              ...(value >= segment.end ? { end: Math.min(duration, value + 0.2) } : {}),
            })
          }}
          className="paper-input h-7 w-16 rounded-md px-1.5 text-[10.5px] font-semibold tabular-nums text-tomato outline-none"
          aria-label={`Caption ${index + 1} start`}
        />
        <span className="text-ink-faint">→</span>
        <label className="sr-only" htmlFor={`caption-end-${index}`}>
          Caption {index + 1} end time
        </label>
        <input
          id={`caption-end-${index}`}
          type="number"
          min={0}
          max={duration}
          step={0.1}
          value={Number(segment.end.toFixed(2))}
          onFocus={onFocus}
          onChange={(event) => {
            const value = Math.max(
              segment.start + 0.1,
              Math.min(duration, Number(event.target.value) || 0),
            )
            onChange({ end: value })
          }}
          className="paper-input h-7 w-16 rounded-md px-1.5 text-[10.5px] font-semibold tabular-nums text-tomato outline-none"
          aria-label={`Caption ${index + 1} end`}
        />
        <div className="ml-auto flex items-center gap-0.5">
          <IconAction label="Play this caption" onClick={onPlay}>
            <Play className="h-3.5 w-3.5" aria-hidden="true" />
          </IconAction>
          <IconAction label="Split at current time" onClick={onSplit}>
            <Scissors className="h-3.5 w-3.5" aria-hidden="true" />
          </IconAction>
          <IconAction label="Merge with next" onClick={onMerge} disabled={!canMerge}>
            <Plus className="h-3.5 w-3.5 rotate-45" aria-hidden="true" />
          </IconAction>
          <IconAction label="Delete caption" onClick={onDelete} danger>
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
          </IconAction>
        </div>
      </div>
      <textarea
        value={segment.text}
        rows={1}
        onFocus={onFocus}
        onChange={(event) => onChange({ text: event.target.value })}
        className="mt-1.5 w-full resize-none rounded-md border border-transparent bg-transparent px-1 py-0.5 text-[12.5px] font-medium leading-5 text-ink focus:border-ink/30 focus:bg-paper-soft focus:outline-none"
        aria-label={`Caption ${index + 1} text`}
      />
    </div>
  )
}

function IconAction({
  label,
  onClick,
  children,
  disabled,
  danger,
}: {
  label: string
  onClick: () => void
  children: ReactNode
  disabled?: boolean
  danger?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex h-6 w-6 items-center justify-center rounded-md text-ink-soft transition',
        danger ? 'hover:bg-tomato-soft hover:text-tomato' : 'hover:bg-paper-deep hover:text-ink',
        'disabled:cursor-not-allowed disabled:opacity-30',
      )}
    >
      {children}
    </button>
  )
}
