import { useState, type CSSProperties, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import {
  ArrowLeft,
  ArrowRight,
  Captions,
  Check,
  Clock3,
  Crop,
  Languages,
  Minus,
  Scissors,
  ScanFace,
  SlidersHorizontal,
  Sparkles,
  WandSparkles,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type {
  AspectRatio,
  ClipSettings,
  ExportQuality,
  ExportResolution,
  PreviewResponse,
  ReframeMode,
  TranscriptionQuality,
  TransitionStyle,
} from '../types/api'
import {
  ASPECT_LABELS,
  DEFAULT_SETTINGS,
  cn,
  formatDuration,
  formatDurationLong,
  sourceName,
} from '../lib/utils'
import { assetUrl } from '../lib/api'
import { Button, RangeField, SectionCard, Toggle } from './ui'
import { CaptionPreview } from './CaptionPreview'
import { CaptionStyleControls } from './CaptionControls'

interface SettingsStepProps {
  preview: PreviewResponse
  settings: ClipSettings
  onSettingsChange: (settings: ClipSettings) => void
  captionLanguage: string
  captionQuality: TranscriptionQuality
  translateCaptions: boolean
  onCaptionLanguageChange: (language: string) => void
  onCaptionQualityChange: (quality: TranscriptionQuality) => void
  onTranslateCaptionsChange: (translate: boolean) => void
  onBack: () => void
  onGenerate: () => void
  generating: boolean
  generationError: string | null
}

const CAPTION_LANGUAGES = [
  { value: 'auto', label: 'Detect language' },
  { value: 'ne', label: 'नेपाली · Nepali' },
  { value: 'en', label: 'English' },
]

function captionQualityOptions() {
  return [
    { value: 'fast' as const, label: 'Fast', detail: 'base' },
    { value: 'balanced' as const, label: 'Balanced', detail: 'small' },
    { value: 'best' as const, label: 'Best', detail: 'medium' },
    { value: 'maximum' as const, label: 'Maximum', detail: 'large-v3' },
  ]
}

const REFRAME_MODES: Array<{
  value: ReframeMode
  label: string
  copy: string
  icon: LucideIcon
}> = [
  {
    value: 'smart',
    label: 'Smart track',
    copy: 'Follows the main face and fills the frame. Falls back to a center crop.',
    icon: ScanFace,
  },
  {
    value: 'center',
    label: 'Center crop',
    copy: 'A steady, predictable center window that fills the frame.',
    icon: Crop,
  },
]

const RESOLUTION_OPTIONS: Array<{
  value: ExportResolution
  label: string
  detail: string
}> = [
  { value: '1080p', label: '1080p', detail: 'Fast · compact' },
  { value: '4k', label: '4K UHD', detail: '2160px · slower' },
]

const QUALITY_OPTIONS: Array<{
  value: ExportQuality
  label: string
  detail: string
}> = [
  { value: 'high', label: 'High', detail: 'Balanced' },
  { value: 'maximum', label: 'Maximum', detail: 'Near-lossless' },
  { value: 'lossless', label: 'Lossless', detail: 'No compression' },
]

const TRANSITION_STYLES: Array<{ value: TransitionStyle; label: string; glyph: string }> = [
  { value: 'fade', label: 'Fade', glyph: '◐' },
  { value: 'zoom', label: 'Zoom', glyph: '⊕' },
  { value: 'slide', label: 'Slide', glyph: '▷' },
  { value: 'whip_pan', label: 'Whip pan', glyph: '≫' },
]

const ASPECT_OPTIONS: Array<{
  value: AspectRatio
  ratio: string
  label: string
  shapeClass: string
}> = [
  { value: '9:16', ratio: '9:16', label: 'Vertical', shapeClass: 'h-6 w-[13.5px]' },
  { value: '1:1', ratio: '1:1', label: 'Square', shapeClass: 'h-[18px] w-[18px]' },
  { value: '4:5', ratio: '4:5', label: 'Portrait', shapeClass: 'h-[22px] w-[17.6px]' },
]

export function SettingsStep({
  preview,
  settings,
  onSettingsChange,
  captionLanguage,
  captionQuality,
  translateCaptions,
  onCaptionLanguageChange,
  onCaptionQualityChange,
  onTranslateCaptionsChange,
  onBack,
  onGenerate,
  generating,
  generationError,
}: SettingsStepProps) {
  const update = (patch: Partial<ClipSettings>) => {
    onSettingsChange({ ...settings, ...patch })
  }
  const updateCaptions = (patch: Partial<ClipSettings['captions']>) => {
    onSettingsChange({
      ...settings,
      captions: { ...settings.captions, ...patch },
    })
  }
  const updateTransitions = (patch: Partial<ClipSettings['transitions']>) => {
    onSettingsChange({
      ...settings,
      transitions: { ...settings.transitions, ...patch },
    })
  }

  const minLength = settings.min_clip_seconds
  const maxLength = settings.max_clip_seconds
  const duration = preview.duration
  const tooShort = duration > 0 && settings.clip_count * minLength > duration + 0.2
  const maxPossibleClips = Math.max(0, Math.floor(duration / Math.max(1, minLength)))
  const evenTooLong =
    settings.selection_mode === 'even' && duration / settings.clip_count > maxLength + 0.2
  const captionsAvailable = preview.has_audio !== false
  const subtitles = settings.captions.enabled && captionsAvailable
  // Auto-highlights trims the count to what fits, so only an explicit even
  // split can be impossible before the render starts.
  const effectiveCount =
    settings.selection_mode === 'auto' && maxPossibleClips > 0
      ? Math.min(settings.clip_count, maxPossibleClips)
      : settings.clip_count
  const autoReduced = settings.selection_mode === 'auto' && effectiveCount < settings.clip_count
  // No mode can make a clip when the whole video is shorter than one clip.
  const tooShortForOne = duration > 0 && duration < minLength
  const blocked = tooShortForOne || evenTooLong || (settings.selection_mode === 'even' && tooShort)
  const issue = tooShortForOne
    ? `This video is only ${formatDurationLong(duration)} long, shorter than the ${Math.round(minLength)}s minimum clip length. Lower the minimum length to continue.`
    : evenTooLong
      ? `An even split needs ${Math.round(duration / settings.clip_count)}s per clip, above your ${Math.round(maxLength)}s maximum. Raise the maximum, use fewer clips, or switch to Auto-highlights.`
      : settings.selection_mode === 'even' && tooShort
        ? `This ${formatDurationLong(duration)} video can fit at most ${maxPossibleClips} clips at a ${Math.round(minLength)}s minimum. Reduce clips or shorten the minimum.`
        : autoReduced
          ? `Auto-highlights will deliver ${effectiveCount} clips — ${settings.clip_count} clips of at least ${Math.round(minLength)}s don't fit this ${formatDurationLong(duration)} video.`
          : null
  const generateLabel = `${subtitles ? 'Generate' : 'Cut'} ${effectiveCount} ${
    effectiveCount === 1 ? 'clip' : 'clips'
  }`

  return (
    <div className="mx-auto max-w-7xl">
      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
        className="mb-7 flex flex-col gap-4 sm:mb-9 sm:flex-row sm:items-end sm:justify-between"
      >
        <div>
          <button
            type="button"
            onClick={onBack}
            className="mb-4 inline-flex items-center gap-1.5 text-[11px] font-semibold text-ink-soft transition hover:text-tomato"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            Back to link
          </button>
          <p className="flex items-center gap-2 text-[9.5px] font-bold uppercase tracking-[0.18em] text-tomato">
            <span className="h-px w-5 bg-tomato" aria-hidden="true" />
            Clip design · {sourceName(preview.source)}
          </p>
          <div className="mt-2 flex flex-wrap items-end gap-x-4">
            <h1 className="font-display text-4xl font-semibold tracking-[-0.05em] text-ink sm:text-[2.9rem]">
              Set the cut.
            </h1>
            <span className="mb-1.5 hidden -rotate-2 font-hand text-[18px] text-ink-soft sm:inline">
              make it feel like you
            </span>
          </div>
          <p className="mt-2 max-w-xl text-[12.5px] leading-6 text-ink-soft">
            Choose how many moments to pull, how they fit the frame, and how they move.
          </p>
        </div>
        <div className="flex max-w-full items-center gap-2 rounded-lg border-[1.5px] border-ink/20 bg-paper-soft/70 px-3 py-2 text-[10px] font-medium text-ink-soft">
          <Clock3 className="h-3.5 w-3.5 shrink-0 text-tomato" aria-hidden="true" />
          <span className="truncate">{preview.title}</span>
          <span className="h-3 border-l border-dashed border-ink/30" />
          <span className="shrink-0 tabular-nums">{formatDuration(duration)}</span>
        </div>
      </motion.div>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_21.5rem] xl:gap-6">
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.04, ease: [0.22, 1, 0.36, 1] }}
          className="min-w-0 space-y-4"
        >
          <SectionCard
            icon={Scissors}
            eyebrow="01 · Export"
            title="Clips only, or clips with subtitles?"
            description="Choose what gets burned into the video before the cut starts. You can add or remove subtitles later without re-cutting."
            tone="mustard"
          >
            <div role="group" aria-label="Export type" className="grid gap-2.5 sm:grid-cols-2">
              <ModeButton
                selected={!subtitles}
                onClick={() => updateCaptions({ enabled: false })}
                title="Just clips"
                copy="Clean MP4s with the original audio and no on-screen text."
                icon={Scissors}
              />
              <ModeButton
                selected={subtitles}
                onClick={() => updateCaptions({ enabled: true })}
                title="Clips + subtitles"
                copy="Burned-in animated captions timed to every spoken word."
                icon={Captions}
                disabled={!captionsAvailable}
              />
            </div>
            {!captionsAvailable ? (
              <p className="mt-3 rounded-lg border-[1.5px] border-ink/30 bg-mustard-soft px-3.5 py-3 text-xs font-medium leading-relaxed text-ink">
                This video has no audio track, so clips are exported without subtitles.
              </p>
            ) : null}

            <div className="mt-5 grid gap-4 border-t border-dashed border-ink/20 pt-5 sm:grid-cols-2">
              <div>
                <p className="mb-2 text-[12.5px] font-semibold text-ink">Resolution</p>
                <div role="group" aria-label="Export resolution" className="grid grid-cols-2 gap-2">
                  {RESOLUTION_OPTIONS.map((option) => {
                    const selected = settings.resolution === option.value
                    return (
                      <button
                        key={option.value}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => update({ resolution: option.value })}
                        className={cn(
                          'rounded-lg border px-2.5 py-2 text-left transition',
                          selected
                            ? 'border-[1.5px] border-ink bg-mustard-soft text-ink shadow-[2px_2px_0_#211d19]'
                            : 'border-[1.5px] border-ink/25 bg-paper-soft text-ink-soft hover:border-ink hover:text-ink',
                        )}
                      >
                        <span className="block text-[12px] font-semibold">{option.label}</span>
                        <span className="mt-0.5 block text-[9px] uppercase tracking-[0.1em] text-ink-faint">
                          {option.detail}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>
              <div>
                <p className="mb-2 text-[12.5px] font-semibold text-ink">Video quality</p>
                <div role="group" aria-label="Export quality" className="grid grid-cols-3 gap-1.5">
                  {QUALITY_OPTIONS.map((option) => {
                    const selected = settings.export_quality === option.value
                    return (
                      <button
                        key={option.value}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => update({ export_quality: option.value })}
                        className={cn(
                          'rounded-lg border px-1.5 py-2 text-center transition',
                          selected
                            ? 'border-[1.5px] border-ink bg-mustard-soft text-ink shadow-[2px_2px_0_#211d19]'
                            : 'border-[1.5px] border-ink/25 bg-paper-soft text-ink-soft hover:border-ink hover:text-ink',
                        )}
                      >
                        <span className="block text-[11px] font-semibold">{option.label}</span>
                        <span className="mt-0.5 block text-[8px] uppercase tracking-[0.08em] text-ink-faint">
                          {option.detail}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>
            <p className="mt-2.5 text-[10px] leading-4 text-ink-faint">
              {settings.export_quality === 'lossless'
                ? 'Lossless video (CRF 0) keeps every pixel but uses software encoding, can produce multi-GB files, and some social platforms reject lossless H.264. Use Maximum for near-lossless uploads.'
                : settings.resolution === '4k'
                  ? '4K exports render about twice as long and create much larger files. Choose Lossless for a bit-exact video stream.'
                  : 'High is visually clean for social. Pick 4K for a 2160-pixel-wide master.'}
            </p>
          </SectionCard>

          <SectionCard
            icon={WandSparkles}
            eyebrow="02 · Selection"
            title="Find the good parts"
            description="Auto-highlights score speech, energy, and scene changes. Even split keeps clips in timeline order."
            tone="tomato"
          >
            <div className="space-y-6">
              <div className="paper-inset p-4">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-[12.5px] font-semibold text-ink">Number of clips</p>
                    <p className="mt-1 text-[11px] text-ink-soft">
                      Between 1 and 20. Auto trims the count only when the video is too short.
                    </p>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <button
                      type="button"
                      aria-label="Remove one clip"
                      onClick={() => update({ clip_count: Math.max(1, settings.clip_count - 1) })}
                      className="flex h-9 w-9 items-center justify-center rounded-lg border-[1.5px] border-ink bg-paper-soft text-ink shadow-[2px_2px_0_#211d19] transition hover:-translate-y-px hover:bg-mustard-soft active:translate-y-px active:shadow-none disabled:opacity-30"
                      disabled={settings.clip_count <= 1}
                    >
                      <Minus className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden="true" />
                    </button>
                    <span className="flex h-12 w-14 items-center justify-center rounded-xl border-[1.5px] border-ink bg-mustard font-display text-[1.7rem] font-semibold tabular-nums tracking-[-0.04em] text-ink shadow-[2px_2px_0_#211d19]">
                      {String(settings.clip_count).padStart(2, '0')}
                    </span>
                    <button
                      type="button"
                      aria-label="Add one clip"
                      onClick={() => update({ clip_count: Math.min(20, settings.clip_count + 1) })}
                      className="flex h-9 w-9 items-center justify-center rounded-lg border-[1.5px] border-ink bg-paper-soft text-ink shadow-[2px_2px_0_#211d19] transition hover:-translate-y-px hover:bg-mustard-soft active:translate-y-px active:shadow-none disabled:opacity-30"
                      disabled={settings.clip_count >= 20}
                    >
                      <span className="text-lg font-semibold leading-none" aria-hidden="true">
                        +
                      </span>
                    </button>
                  </div>
                </div>
                <div className="mt-4">
                  <label htmlFor="clip-count" className="sr-only">
                    Number of clips
                  </label>
                  <input
                    id="clip-count"
                    type="range"
                    min={1}
                    max={20}
                    step={1}
                    value={settings.clip_count}
                    onChange={(event) => update({ clip_count: Number(event.target.value) })}
                    className="range"
                    style={
                      {
                        '--range-progress': `${((settings.clip_count - 1) / 19) * 100}%`,
                      } as CSSProperties
                    }
                  />
                  <div className="flex items-center justify-between text-[9px] font-bold tabular-nums text-ink-faint">
                    <span>01</span>
                    <span>20</span>
                  </div>
                </div>
                {tooShort && !tooShortForOne ? (
                  <p
                    className={cn(
                      'mt-2 text-[11px] font-medium leading-5',
                      settings.selection_mode === 'auto' ? 'text-ink-soft' : 'text-tomato',
                    )}
                  >
                    {settings.selection_mode === 'auto'
                      ? `Auto-highlights will deliver ${effectiveCount} clips at this minimum length.`
                      : `Only ~${maxPossibleClips} clips fit at this minimum length.`}
                  </p>
                ) : null}
              </div>

              <div className="grid gap-5 sm:grid-cols-2">
                <RangeField
                  label="Minimum length"
                  value={minLength}
                  min={5}
                  max={180}
                  display={`${Math.round(minLength)}s`}
                  onValueChange={(value) =>
                    update({
                      min_clip_seconds: value,
                      max_clip_seconds: Math.max(value, maxLength),
                    })
                  }
                />
                <RangeField
                  label="Maximum length"
                  value={maxLength}
                  min={5}
                  max={180}
                  display={`${Math.round(maxLength)}s`}
                  onValueChange={(value) =>
                    update({
                      max_clip_seconds: value,
                      min_clip_seconds: Math.min(value, minLength),
                    })
                  }
                />
              </div>

              <div
                role="group"
                aria-label="Clip selection mode"
                className="grid gap-2.5 sm:grid-cols-2"
              >
                <ModeButton
                  selected={settings.selection_mode === 'auto'}
                  onClick={() => update({ selection_mode: 'auto' })}
                  title="Auto-highlights"
                  copy="Score every segment and pick the strongest non-overlapping moments."
                  icon={Sparkles}
                />
                <ModeButton
                  selected={settings.selection_mode === 'even'}
                  onClick={() => update({ selection_mode: 'even' })}
                  title="Evenly split"
                  copy="Divide the timeline into equal clips that respect sentence boundaries."
                  icon={SlidersHorizontal}
                />
              </div>
            </div>
          </SectionCard>

          <SectionCard
            icon={Crop}
            eyebrow="03 · Frame"
            title="Own the frame"
            description="See every clip in full resolution. Smart framing eases around the main face instead of jumping."
            tone="teal"
          >
            <div className="space-y-6">
              <div>
                <p className="mb-3 text-[13px] font-medium text-ink-soft">Output shape</p>
                <div
                  role="group"
                  aria-label="Output aspect ratio"
                  className="grid grid-cols-3 gap-2"
                >
                  {ASPECT_OPTIONS.map((option) => {
                    const selected = settings.aspect_ratio === option.value
                    return (
                      <button
                        key={option.value}
                        type="button"
                        aria-pressed={selected}

                        onClick={() => update({ aspect_ratio: option.value })}
                        className={cn(
                          'group relative flex flex-col items-center justify-center gap-2 rounded-xl border px-2 py-4 transition duration-200',
                          selected
                            ? 'border-[1.5px] border-ink bg-mustard-soft shadow-[2px_3px_0_#211d19]'
                            : 'border-[1.5px] border-ink/25 bg-paper-soft hover:-translate-y-0.5 hover:border-ink hover:bg-mustard-soft/40',
                        )}
                      >
                        <span
                          className={cn(
                            'rounded-[3px] border transition',
                            option.shapeClass,
                            selected ? 'border-ink bg-mustard' : 'border-ink/40 bg-paper-soft',
                          )}
                          aria-hidden="true"
                        />
                        <span
                          className={cn(
                            'text-[12px] font-medium',
                            selected ? 'text-ink' : 'text-ink-soft',
                          )}
                        >
                          {ASPECT_LABELS[option.value]}
                        </span>
                        <span className="text-[9px] font-medium tabular-nums tracking-[0.15em] text-ink-faint">
                          {option.ratio}
                        </span>
                        {selected ? (
                          <span className="absolute right-2 top-2 h-2 w-2 rounded-full border border-ink bg-tomato" />
                        ) : null}
                      </button>
                    )
                  })}
                </div>
              </div>

              <div>
                <p className="mb-3 text-[13px] font-medium text-ink-soft">Reframing</p>
                <div
                  role="group"
                  aria-label="Reframing method"
                  className="grid gap-2.5 md:grid-cols-3"
                >
                  {REFRAME_MODES.map(({ value, label, copy, icon: Icon }) => {
                    const selected = settings.reframe_mode === value
                    return (
                      <button
                        key={value}
                        type="button"
                        aria-pressed={selected}

                        onClick={() => update({ reframe_mode: value })}
                        className={cn(
                          'relative rounded-xl border p-3.5 text-left transition duration-200',
                          selected
                            ? 'border-[1.5px] border-ink bg-teal-soft shadow-[2px_3px_0_#211d19]'
                            : 'border-[1.5px] border-ink/25 bg-paper-soft hover:-translate-y-0.5 hover:border-ink hover:bg-mustard-soft/40',
                        )}
                      >
                        <div className="flex items-center justify-between">
                          <Icon
                            className={cn('h-4 w-4', selected ? 'text-teal' : 'text-ink-soft')}
                            aria-hidden="true"
                          />
                          {selected ? (
                            <Check className="h-3.5 w-3.5 text-teal" aria-hidden="true" />
                          ) : null}
                        </div>
                        <p
                          className={cn(
                            'mt-2.5 text-[12.5px] font-semibold',
                            selected ? 'text-ink' : 'text-ink-soft',
                          )}
                        >
                          {label}
                        </p>
                        <p className="mt-1 text-[11px] leading-4 text-ink-soft">{copy}</p>
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>
          </SectionCard>

          <SectionCard
            icon={Captions}
            eyebrow="04 · Subtitles"
            title="Words that land"
            description="Burned-in captions use word-level timestamps and phone-safe margins."
            tone="periwinkle"
            action={
              <span
                className={cn(
                  'rounded border-[1.5px] border-ink px-2 py-1 text-[9px] font-bold uppercase tracking-[0.12em] shadow-[1px_1px_0_#211d19]',
                  subtitles ? 'bg-teal-soft text-ink' : 'bg-paper-soft text-ink-soft',
                )}
              >
                {!captionsAvailable ? 'Unavailable' : subtitles ? 'Subtitles on' : 'Just clips'}
              </span>
            }
          >
            {!captionsAvailable ? (
              <p className="rounded-lg border-[1.5px] border-ink/30 bg-mustard-soft px-3.5 py-3 text-xs font-medium leading-relaxed text-ink">
                This video has no audio track, so animated captions are unavailable.
              </p>
            ) : subtitles ? (
              <div className="space-y-4">
                <div className="rounded-xl border-[1.5px] border-ink/25 bg-paper p-3.5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="flex items-center gap-1.5 text-[11.5px] font-semibold text-ink">
                        <Languages className="h-3.5 w-3.5 text-tomato" aria-hidden="true" />
                        Spoken language &amp; translation
                      </p>
                      <p className="mt-0.5 text-[10px] leading-4 text-ink-soft">
                        Drives both the automatic captions and the clip transcript.
                      </p>
                    </div>
                    {translateCaptions ? (
                      <span className="shrink-0 rounded border border-ink bg-teal-soft px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-[0.1em] text-teal shadow-[1px_1px_0_#211d19]">
                        English output
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                    <div>
                      <label
                        htmlFor="clip-caption-language"
                        className="mb-1.5 block text-[11.5px] font-medium text-ink-soft"
                      >
                        Spoken language
                      </label>
                      <select
                        id="clip-caption-language"
                        value={captionLanguage}
                        onChange={(event) => onCaptionLanguageChange(event.target.value)}
                        className="paper-select h-10 w-full"
                      >
                        {CAPTION_LANGUAGES.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <p className="mb-1.5 text-[11.5px] font-medium text-ink-soft">
                        Transcription accuracy
                      </p>
                      {captionLanguage === 'ne' ? (
                        <div className="flex h-[2.65rem] items-center justify-center rounded-lg border-[1.5px] border-ink bg-mustard-soft px-2 text-center text-[10.5px] font-semibold text-ink shadow-[2px_2px_0_#211d19]">
                          Accurate · Nepali fine-tuned model
                        </div>
                      ) : (
                        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                          {captionQualityOptions().map((option) => (
                            <button
                              key={option.value}
                              type="button"
                              aria-pressed={captionQuality === option.value}
                              onClick={() => onCaptionQualityChange(option.value)}
                              className={cn(
                                'rounded-lg border px-1.5 py-1.5 text-[10.5px] font-medium transition',
                                captionQuality === option.value
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
                      )}
                    </div>
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-ink/20 bg-paper-soft px-3 py-2.5">
                    <div>
                      <p className="text-[11.5px] font-semibold text-ink">
                        Translate Nepali to English
                      </p>
                      <p className="mt-0.5 text-[9.5px] leading-4 text-ink-soft">
                        Burns English captions with the same word timing and animations.
                      </p>
                    </div>
                    <Toggle
                      checked={translateCaptions}
                      onChange={onTranslateCaptionsChange}
                      disabled={captionLanguage === 'en'}
                      label="Translate captions to English"
                    />
                  </div>
                  <p className="mt-2 text-[10px] leading-4 text-ink-faint">
                    {translateCaptions
                      ? 'Whisper translates the spoken audio to English in one pass; the selected style below is applied to the English captions.'
                      : captionLanguage === 'ne'
                        ? 'All Nepali captions use the Nepali fine-tuned Whisper model — smaller vanilla models are never used. English words mixed into the speech stay in Latin script while Nepali stays in Devanagari. The first run downloads about 1.5 GB. Auto-detection only chooses English or Nepali. You can edit and translate lines in the Caption studio before rendering.'
                        : 'Nepali is detected automatically and always uses the fine-tuned model. For other languages, Fast / Balanced / Best map to base / small / medium.'}
                  </p>
                </div>
                <CaptionStyleControls settings={settings.captions} onChange={updateCaptions} />
              </div>
            ) : (
              <div className="flex flex-col items-start justify-between gap-3 rounded-xl border-[1.5px] border-dashed border-ink/30 bg-paper-soft px-3.5 py-3 sm:flex-row sm:items-center">
                <p className="text-xs leading-relaxed text-ink-soft">
                  Just clips is selected. Your MP4s keep the original audio and framing with no
                  burned-in text.
                </p>
                <Button
                  variant="secondary"
                  size="sm"
                  icon={Captions}
                  onClick={() => updateCaptions({ enabled: true })}
                >
                  Add subtitles
                </Button>
              </div>
            )}
          </SectionCard>

          <SectionCard
            icon={Sparkles}
            eyebrow="05 · Motion"
            title="Add the polish"
            description="Soft transitions ease viewers between the clip edges and internal cuts."
            tone="mustard"
            action={
              <Toggle
                checked={settings.transitions.enabled}
                onChange={(checked) => updateTransitions({ enabled: checked })}
                label="Transitions"
              />
            }
          >
            {settings.transitions.enabled ? (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                className="overflow-hidden"
              >
                <div className="space-y-6">
                  <div
                    role="group"
                    aria-label="Transition style"
                    className="grid grid-cols-2 gap-2 sm:grid-cols-4"
                  >
                    {TRANSITION_STYLES.map((transition) => {
                      const selected = settings.transitions.style === transition.value
                      return (
                        <button
                          key={transition.value}
                          type="button"
                          aria-pressed={selected}

                          onClick={() => updateTransitions({ style: transition.value })}
                          className={cn(
                            'group rounded-xl border px-2 py-3 transition duration-200',
                            selected
                              ? 'border-[1.5px] border-ink bg-blush-soft shadow-[2px_2px_0_#211d19]'
                              : 'border-[1.5px] border-ink/25 bg-paper-soft hover:-translate-y-0.5 hover:border-ink hover:bg-mustard-soft/40',
                          )}
                        >
                          <span
                            className={cn(
                              'block text-2xl leading-none transition group-hover:scale-110',
                              selected ? 'text-ink' : 'text-ink-soft',
                            )}
                            aria-hidden="true"
                          >
                            {transition.glyph}
                          </span>
                          <span
                            className={cn(
                              'mt-2 block text-[11px] font-medium',
                              selected ? 'text-ink' : 'text-ink-soft',
                            )}
                          >
                            {transition.label}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                  <RangeField
                    label="Transition duration"
                    value={settings.transitions.duration}
                    min={0.2}
                    max={2}
                    step={0.1}
                    display={`${settings.transitions.duration.toFixed(1)}s`}
                    onValueChange={(value) => updateTransitions({ duration: value })}
                    hint="Applied at the start and end of each clip. Kept short by default for social pacing."
                  />
                </div>
              </motion.div>
            ) : (
              <p className="text-xs leading-relaxed text-ink-soft">
                Hard cuts throughout. Turn transitions on for eased edges and motion.
              </p>
            )}
          </SectionCard>

          {issue ? (
            <div
              role="alert"
              className="rounded-xl border-[1.5px] border-ink bg-mustard-soft px-4 py-3 text-[12.5px] font-medium leading-relaxed text-ink shadow-[2px_2px_0_#211d19]"
            >
              {issue}
            </div>
          ) : null}

          {generationError ? (
            <div
              role="alert"
              className="rounded-xl border-[1.5px] border-ink bg-tomato-soft px-4 py-3 text-[12.5px] font-medium leading-relaxed text-ink shadow-[2px_2px_0_#211d19]"
            >
              {generationError}
            </div>
          ) : null}

          <div className="flex items-center justify-between gap-3 pt-1">
            <Button variant="ghost" onClick={onBack} icon={ArrowLeft} disabled={generating}>
              Change link
            </Button>
            <Button
              variant="secondary"
              disabled={generating}
              onClick={() =>
                onSettingsChange({
                  ...structuredClone(DEFAULT_SETTINGS),
                  captions: {
                    ...structuredClone(DEFAULT_SETTINGS.captions),
                    enabled: captionsAvailable ? DEFAULT_SETTINGS.captions.enabled : false,
                  },
                })
              }
            >
              Reset defaults
            </Button>
          </div>

          <div className="glass rounded-2xl p-4 lg:hidden">
            <MobileCta
              label={generateLabel}
              subtitles={subtitles}
              blocked={blocked}
              generating={generating}
              onGenerate={onGenerate}
            />
          </div>
        </motion.div>

        <motion.aside
          initial={{ opacity: 0, y: 22 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
          className="hidden lg:sticky lg:top-[5.25rem] lg:block"
        >
          <PreviewPhone preview={preview} settings={settings} />
          <div className="glass mt-4 rounded-2xl p-4">
            <Button
              onClick={onGenerate}
              disabled={blocked}
              loading={generating}
              size="lg"
              iconRight={generating ? undefined : ArrowRight}
              className="w-full"
            >
              {generating ? 'Starting render' : generateLabel}
            </Button>
            <div className="mt-3 flex items-center justify-between text-[10px] text-ink-soft">
              <span>
                {settings.aspect_ratio} · {settings.resolution === '4k' ? '4K' : '1080p'} ·{' '}
                {subtitles ? 'Subtitles on' : 'Just clips'}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-teal" />
                No watermark
              </span>
            </div>
          </div>
        </motion.aside>
      </div>
    </div>
  )
}

function MobileCta({
  label,
  subtitles,
  blocked,
  generating,
  onGenerate,
}: {
  label: string
  subtitles: boolean
  blocked: boolean
  generating: boolean
  onGenerate: () => void
}) {
  return (
    <>
      <Button
        onClick={onGenerate}
        disabled={blocked}
        loading={generating}
        size="lg"
        iconRight={generating ? undefined : ArrowRight}
        className="w-full"
      >
        {generating ? 'Starting render' : label}
      </Button>
      <p className="mt-2.5 text-center text-[10px] text-ink-soft">
        {subtitles ? 'Burned-in subtitles' : 'Just clips'} · clean MP4 · no watermarks
      </p>
    </>
  )
}

function ModeButton({
  selected,
  onClick,
  title,
  copy,
  icon: Icon,
  disabled = false,
}: {
  selected: boolean
  onClick: () => void
  title: string
  copy: string
  icon: LucideIcon
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'relative flex items-start gap-3 rounded-xl border p-3.5 text-left transition duration-200 disabled:cursor-not-allowed disabled:opacity-50',
        selected
          ? 'border-[1.5px] border-ink bg-periwinkle-soft shadow-[2px_3px_0_#211d19]'
          : 'border-[1.5px] border-ink/25 bg-paper-soft hover:-translate-y-0.5 hover:border-ink hover:bg-mustard-soft/40',
      )}
    >
      <span
        className={cn(
          'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border',
          selected ? 'border-ink/30 bg-paper text-tomato' : 'border-ink/25 bg-paper text-ink-soft',
        )}
      >
        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      </span>
      <span>
        <span
          className={cn(
            'block text-[12.5px] font-semibold',
            selected ? 'text-ink' : 'text-ink-soft',
          )}
        >
          {title}
        </span>
        <span className="mt-1 block text-[10.5px] leading-4 text-ink-soft">{copy}</span>
      </span>
      {selected ? (
        <span className="absolute right-2.5 top-2.5 flex h-4 w-4 items-center justify-center rounded-full border border-ink bg-mustard text-ink">
          <Check className="h-2.5 w-2.5" strokeWidth={3} aria-hidden="true" />
        </span>
      ) : null}
    </button>
  )
}

function PreviewPhone({ preview, settings }: { preview: PreviewResponse; settings: ClipSettings }) {
  const [imageFailed, setImageFailed] = useState(false)

  return (
    <div className="paper-card taped taped-pink rotate-[0.8deg] p-3 pb-2">
      <div className="mb-2.5 flex items-center justify-between px-1">
        <span className="text-[8.5px] font-bold uppercase tracking-[0.16em] text-ink-soft">
          Your cut · live
        </span>
        <span className="font-hand text-[15px] text-tomato">looking good</span>
      </div>
      <div className="relative mx-auto w-full max-w-[18.5rem] overflow-hidden rounded-[1.15rem] border-[1.5px] border-ink bg-[#050814] shadow-[3px_4px_0_#211d19]">
        <div className="relative" style={{ aspectRatio: settings.aspect_ratio.replace(':', '/') }}>
          {preview.thumbnail_url && !imageFailed ? (
            <img
              src={assetUrl(preview.thumbnail_url)}
              alt={`Framing preview for ${preview.title}`}
              className="relative h-full w-full object-cover"
              referrerPolicy="no-referrer"
              onError={() => setImageFailed(true)}
            />
          ) : (
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_25%_20%,rgba(44,232,255,0.22),transparent_50%),radial-gradient(circle_at_80%_80%,rgba(255,79,216,0.18),transparent_45%),linear-gradient(160deg,#0a1228,#0c0a1d)]" />
          )}
          <div className="absolute inset-0 bg-gradient-to-b from-black/25 via-transparent to-black/65" />

          <div className="absolute inset-x-0 top-0 flex items-center justify-between p-3">
            <span className="rounded-md border-[1.5px] border-ink bg-mustard px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-[0.12em] text-ink shadow-[1px_1px_0_#211d19]">
              {settings.aspect_ratio}
            </span>
            <span className="rounded-md border-[1.5px] border-ink bg-paper-soft px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-[0.1em] text-ink shadow-[1px_1px_0_#211d19]">
              {settings.reframe_mode === 'smart' ? 'Face track' : 'Center'}
            </span>
          </div>

          <div className="absolute inset-x-3 top-10 flex gap-1">
            {Array.from({ length: 5 }).map((_, index) => (
              <span
                key={index}
                className={cn(
                  'h-0.5 flex-1 rounded-full',
                  index < 3 ? 'bg-white/80' : 'bg-white/20',
                )}
              />
            ))}
          </div>

          {settings.captions.enabled ? (
            <CaptionPreview settings={settings.captions} loop className="absolute inset-0" />
          ) : null}

          <div className="absolute inset-x-0 bottom-0 flex items-center justify-between px-3 pb-2.5">
            <span className="inline-flex items-center gap-1 rounded border border-ink bg-paper-soft px-1.5 py-1 text-[8px] font-bold tabular-nums text-ink shadow-[1px_1px_0_#211d19]">
              <Clock3 className="h-2.5 w-2.5" aria-hidden="true" />
              {formatDuration(preview.duration)}
            </span>
            {settings.transitions.enabled ? (
              <span className="rounded border border-ink bg-blush-soft px-1.5 py-1 text-[7px] font-bold uppercase tracking-[0.12em] text-ink shadow-[1px_1px_0_#211d19]">
                {settings.transitions.style.replace('_', ' ')} ·{' '}
                {settings.transitions.duration.toFixed(1)}s
              </span>
            ) : null}
          </div>

          <div className="pointer-events-none absolute inset-0 rounded-[1.15rem] ring-1 ring-inset ring-white/10" />
        </div>
      </div>

      <div className="px-1.5 pb-1 pt-3.5">
        <div className="flex items-center justify-between gap-3">
          <p className="min-w-0 truncate font-display text-[12.5px] font-medium text-ink">
            {preview.title}
          </p>
          <span className="shrink-0 text-[10px] tabular-nums text-ink-soft">
            {settings.clip_count} clips
          </span>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <PreviewTag>
            {settings.captions.enabled
              ? (settings.captions.word_style ?? settings.captions.line_style ?? 'No motion')
              : 'Just clips'}
          </PreviewTag>
          <PreviewTag>{settings.selection_mode === 'auto' ? 'Auto cuts' : 'Even split'}</PreviewTag>
          <PreviewTag>{settings.aspect_ratio}</PreviewTag>
          <PreviewTag>{settings.resolution === '4k' ? '4K' : '1080p'}</PreviewTag>
          {settings.export_quality !== 'high' ? (
            <PreviewTag>{settings.export_quality}</PreviewTag>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function PreviewTag({ children }: { children: ReactNode }) {
  return (
    <span className="rounded border border-ink/20 bg-paper px-1.5 py-0.5 text-[9px] font-semibold capitalize text-ink-soft">
      {children}
    </span>
  )
}
