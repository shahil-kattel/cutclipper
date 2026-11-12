import { useState, type CSSProperties, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import {
  ArrowLeft,
  ArrowRight,
  Captions,
  Check,
  Clock3,
  Crop,
  Layers,
  Minus,
  ScanFace,
  SlidersHorizontal,
  Sparkles,
  WandSparkles,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type {
  AspectRatio,
  ClipSettings,
  PreviewResponse,
  ReframeMode,
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
import { Button, RangeField, SectionCard, Toggle } from './ui'
import { CaptionPreview } from './CaptionPreview'
import { CaptionStyleControls } from './CaptionControls'

interface SettingsStepProps {
  preview: PreviewResponse
  settings: ClipSettings
  onSettingsChange: (settings: ClipSettings) => void
  onBack: () => void
  onGenerate: () => void
  generating: boolean
  generationError: string | null
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
    copy: 'Follows the main face with stabilized easing.',
    icon: ScanFace,
  },
  {
    value: 'center',
    label: 'Center crop',
    copy: 'A steady, predictable center window.',
    icon: Crop,
  },
  {
    value: 'blur',
    label: 'Blur fit',
    copy: 'Full frame centered over a blurred backdrop.',
    icon: Layers,
  },
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
  const blocked = tooShort || evenTooLong
  const issue = tooShort
    ? `This ${formatDurationLong(duration)} video can fit at most ${maxPossibleClips} clips at a ${Math.round(minLength)}s minimum. Reduce clips or shorten the minimum.`
    : evenTooLong
      ? `An even split needs ${Math.round(duration / settings.clip_count)}s per clip, above your ${Math.round(maxLength)}s maximum. Raise the maximum, use fewer clips, or switch to Auto-highlights.`
      : null

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
            icon={WandSparkles}
            eyebrow="01 · Selection"
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
                      Between 1 and 20. Every clip is delivered.
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
                {tooShort ? (
                  <p className="mt-2 text-[11px] font-medium leading-5 text-tomato">
                    Only ~{maxPossibleClips} clips fit at this minimum length.
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
            eyebrow="02 · Frame"
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
            eyebrow="03 · Type"
            title="Words that land"
            description="Burned-in captions use word-level timestamps and phone-safe margins."
            tone="periwinkle"
            action={
              <Toggle
                checked={settings.captions.enabled && captionsAvailable}
                onChange={(checked) => updateCaptions({ enabled: checked })}
                disabled={!captionsAvailable}
                label="Animated captions"
              />
            }
          >
            {!captionsAvailable ? (
              <p className="rounded-lg border-[1.5px] border-ink/30 bg-mustard-soft px-3.5 py-3 text-xs font-medium leading-relaxed text-ink">
                This video has no audio track, so animated captions are unavailable.
              </p>
            ) : settings.captions.enabled ? (
              <CaptionStyleControls settings={settings.captions} onChange={updateCaptions} />
            ) : (
              <p className="text-xs leading-relaxed text-ink-soft">
                Captions are off. The export will keep the original audio and framing only.
              </p>
            )}
          </SectionCard>

          <SectionCard
            icon={Sparkles}
            eyebrow="04 · Motion"
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
              settings={settings}
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
              {generating
                ? 'Starting render'
                : `Generate ${settings.clip_count} ${settings.clip_count === 1 ? 'clip' : 'clips'}`}
            </Button>
            <div className="mt-3 flex items-center justify-between text-[10px] text-ink-soft">
              <span>
                {settings.aspect_ratio} ·{' '}
                {settings.captions.enabled && captionsAvailable ? 'Captions on' : 'Captions off'}
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
  settings,
  blocked,
  generating,
  onGenerate,
}: {
  settings: ClipSettings
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
        {generating
          ? 'Starting render'
          : `Generate ${settings.clip_count} ${settings.clip_count === 1 ? 'clip' : 'clips'}`}
      </Button>
      <p className="mt-2.5 text-center text-[10px] text-ink-soft">
        Clean MP4 exports · no watermarks · no usage limits
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
}: {
  selected: boolean
  onClick: () => void
  title: string
  copy: string
  icon: LucideIcon
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}

      onClick={onClick}
      className={cn(
        'relative flex items-start gap-3 rounded-xl border p-3.5 text-left transition duration-200',
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
  const blur = settings.reframe_mode === 'blur'

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
            <>
              {blur ? (
                <img
                  src={preview.thumbnail_url}
                  alt=""
                  className="absolute inset-0 h-full w-full scale-110 object-cover blur-2xl brightness-[0.45]"
                  referrerPolicy="no-referrer"
                  onError={() => setImageFailed(true)}
                />
              ) : null}
              <img
                src={preview.thumbnail_url}
                alt={`Framing preview for ${preview.title}`}
                className={cn('relative h-full w-full', blur ? 'object-contain' : 'object-cover')}
                referrerPolicy="no-referrer"
                onError={() => setImageFailed(true)}
              />
            </>
          ) : (
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_25%_20%,rgba(44,232,255,0.22),transparent_50%),radial-gradient(circle_at_80%_80%,rgba(255,79,216,0.18),transparent_45%),linear-gradient(160deg,#0a1228,#0c0a1d)]" />
          )}
          <div className="absolute inset-0 bg-gradient-to-b from-black/25 via-transparent to-black/65" />

          <div className="absolute inset-x-0 top-0 flex items-center justify-between p-3">
            <span className="rounded-md border-[1.5px] border-ink bg-mustard px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-[0.12em] text-ink shadow-[1px_1px_0_#211d19]">
              {settings.aspect_ratio}
            </span>
            <span className="rounded-md border-[1.5px] border-ink bg-paper-soft px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-[0.1em] text-ink shadow-[1px_1px_0_#211d19]">
              {settings.reframe_mode === 'smart'
                ? 'Face track'
                : settings.reframe_mode === 'blur'
                  ? 'Blur fit'
                  : 'Center'}
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
            {settings.captions.enabled ? settings.captions.word_style ?? settings.captions.line_style ?? 'No motion' : 'No captions'}
          </PreviewTag>
          <PreviewTag>{settings.selection_mode === 'auto' ? 'Auto cuts' : 'Even split'}</PreviewTag>
          <PreviewTag>{settings.aspect_ratio}</PreviewTag>
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
