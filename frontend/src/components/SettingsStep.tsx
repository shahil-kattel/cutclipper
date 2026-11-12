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
  CaptionFont,
  CaptionPosition,
  CaptionStyle,
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
import { Button, FieldLabel, RangeField, SectionCard, Toggle } from './ui'

interface SettingsStepProps {
  preview: PreviewResponse
  settings: ClipSettings
  onSettingsChange: (settings: ClipSettings) => void
  onBack: () => void
  onGenerate: () => void
  generating: boolean
  generationError: string | null
}

const CAPTION_STYLES: Array<{
  value: CaptionStyle
  label: string
  copy: string
}> = [
  { value: 'karaoke', label: 'Karaoke', copy: 'Each word lights up as it lands.' },
  { value: 'pop', label: 'Pop', copy: 'Words bounce in with a springy scale.' },
  { value: 'typewriter', label: 'Typewriter', copy: 'Letters reveal in spoken rhythm.' },
  { value: 'minimal', label: 'Minimal', copy: 'Clean static lines. Nothing extra.' },
]

const CAPTION_FONTS: CaptionFont[] = ['Inter', 'Arial', 'Georgia', 'DejaVu Sans']

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
            className="mb-4 inline-flex items-center gap-1.5 text-[12px] font-medium text-slate-500 transition hover:text-slate-200"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            Back to link
          </button>
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-cyan-300/70">
            Clip design · {sourceName(preview.source)}
          </p>
          <h1 className="mt-2 font-display text-3xl font-semibold tracking-[-0.045em] text-white sm:text-[2.5rem]">
            Set the cut.
          </h1>
          <p className="mt-2 max-w-xl text-sm leading-6 text-slate-400">
            Choose how many moments to pull, how they fit the frame, and how they move.
          </p>
        </div>
        <div className="flex items-center gap-2 text-[11px] text-slate-500">
          <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />
          <span className="truncate">{preview.title}</span>
          <span className="h-3 w-px bg-white/10" />
          <span className="tabular-nums">{formatDuration(duration)}</span>
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
          >
            <div className="space-y-6">
              <div className="rounded-xl border border-white/[0.065] bg-black/10 p-4">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-[13px] font-medium text-slate-300">Number of clips</p>
                    <p className="mt-1 text-xs text-slate-500">
                      Between 1 and 20. Every clip is delivered.
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      aria-label="Remove one clip"
                      onClick={() => update({ clip_count: Math.max(1, settings.clip_count - 1) })}
                      className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-white/[0.035] text-slate-300 transition hover:border-white/20 hover:bg-white/[0.07] disabled:opacity-30"
                      disabled={settings.clip_count <= 1}
                    >
                      <Minus className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                    <span className="w-12 text-center font-display text-3xl font-semibold tabular-nums tracking-[-0.04em] text-white">
                      {String(settings.clip_count).padStart(2, '0')}
                    </span>
                    <button
                      type="button"
                      aria-label="Add one clip"
                      onClick={() => update({ clip_count: Math.min(20, settings.clip_count + 1) })}
                      className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-white/[0.035] text-slate-300 transition hover:border-white/20 hover:bg-white/[0.07] disabled:opacity-30"
                      disabled={settings.clip_count >= 20}
                    >
                      <span className="text-base leading-none" aria-hidden="true">
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
                  <div className="flex items-center justify-between text-[9px] font-medium tabular-nums text-slate-600">
                    <span>01</span>
                    <span>20</span>
                  </div>
                </div>
                {tooShort ? (
                  <p className="mt-2 text-[11px] leading-5 text-amber-200/80">
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
          >
            <div className="space-y-6">
              <div>
                <p className="mb-3 text-[13px] font-medium text-slate-300">Output shape</p>
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
                            ? 'border-cyan-300/35 bg-cyan-300/[0.065] shadow-[inset_0_0_30px_-15px_rgba(44,232,255,0.35)]'
                            : 'border-white/[0.07] bg-white/[0.02] hover:border-white/15 hover:bg-white/[0.035]',
                        )}
                      >
                        <span
                          className={cn(
                            'rounded-[3px] border transition',
                            option.shapeClass,
                            selected
                              ? 'border-cyan-200/70 bg-cyan-300/10'
                              : 'border-slate-600 bg-white/[0.02]',
                          )}
                          aria-hidden="true"
                        />
                        <span
                          className={cn(
                            'text-[12px] font-medium',
                            selected ? 'text-white' : 'text-slate-400',
                          )}
                        >
                          {ASPECT_LABELS[option.value]}
                        </span>
                        <span className="text-[9px] font-medium tabular-nums tracking-[0.15em] text-slate-600">
                          {option.ratio}
                        </span>
                        {selected ? (
                          <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-cyan-300 shadow-[0_0_8px_rgba(44,232,255,0.8)]" />
                        ) : null}
                      </button>
                    )
                  })}
                </div>
              </div>

              <div>
                <p className="mb-3 text-[13px] font-medium text-slate-300">Reframing</p>
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
                            ? 'border-violet-300/35 bg-violet-300/[0.065]'
                            : 'border-white/[0.07] bg-white/[0.02] hover:border-white/15 hover:bg-white/[0.035]',
                        )}
                      >
                        <div className="flex items-center justify-between">
                          <Icon
                            className={cn(
                              'h-4 w-4',
                              selected ? 'text-violet-200' : 'text-slate-500',
                            )}
                            aria-hidden="true"
                          />
                          {selected ? (
                            <Check className="h-3.5 w-3.5 text-violet-200" aria-hidden="true" />
                          ) : null}
                        </div>
                        <p
                          className={cn(
                            'mt-2.5 text-[12.5px] font-semibold',
                            selected ? 'text-white' : 'text-slate-300',
                          )}
                        >
                          {label}
                        </p>
                        <p className="mt-1 text-[11px] leading-4 text-slate-500">{copy}</p>
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
              <p className="rounded-lg border border-amber-300/15 bg-amber-300/[0.05] px-3.5 py-3 text-xs leading-relaxed text-amber-100/80">
                This video has no audio track, so animated captions are unavailable.
              </p>
            ) : settings.captions.enabled ? (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                className="overflow-hidden"
              >
                <div className="space-y-6">
                  <div>
                    <p className="mb-3 text-[13px] font-medium text-slate-300">Caption motion</p>
                    <div role="group" aria-label="Caption style" className="grid grid-cols-2 gap-2">
                      {CAPTION_STYLES.map((style) => {
                        const selected = settings.captions.style === style.value
                        return (
                          <button
                            key={style.value}
                            type="button"
                            aria-pressed={selected}

                            onClick={() => updateCaptions({ style: style.value })}
                            className={cn(
                              'relative rounded-xl border px-3.5 py-3 text-left transition duration-200',
                              selected
                                ? 'border-cyan-300/30 bg-cyan-300/[0.055]'
                                : 'border-white/[0.07] bg-white/[0.02] hover:border-white/15',
                            )}
                          >
                            <div className="flex items-center justify-between">
                              <span
                                className={cn(
                                  'font-display text-[15px] font-semibold tracking-[-0.02em]',
                                  selected ? 'text-cyan-100' : 'text-slate-300',
                                )}
                              >
                                {style.label}
                              </span>
                              <CaptionGlyph style={style.value} active={selected} />
                            </div>
                            <p className="mt-1 text-[10.5px] leading-4 text-slate-500">
                              {style.copy}
                            </p>
                          </button>
                        )
                      })}
                    </div>
                  </div>

                  <div className="grid gap-5 sm:grid-cols-2">
                    <div className="space-y-2">
                      <FieldLabel htmlFor="caption-font">Typeface</FieldLabel>
                      <select
                        id="caption-font"
                        value={settings.captions.font}
                        onChange={(event) =>
                          updateCaptions({ font: event.target.value as CaptionFont })
                        }
                        className="h-10 w-full rounded-lg border border-white/10 bg-[#090e1e] px-3 text-[13px] text-slate-100 outline-none transition focus:border-cyan-300/40"
                      >
                        {CAPTION_FONTS.map((font) => (
                          <option key={font} value={font}>
                            {font}
                          </option>
                        ))}
                      </select>
                    </div>
                    <RangeField
                      label="Caption size"
                      value={settings.captions.font_size}
                      min={40}
                      max={110}
                      display={`${settings.captions.font_size}px`}
                      onValueChange={(value) => updateCaptions({ font_size: value })}
                    />
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <ColorRow
                      label="Text"
                      value={settings.captions.color}
                      onChange={(value) => updateCaptions({ color: value })}
                    />
                    <ColorRow
                      label="Highlight"
                      value={settings.captions.highlight_color}
                      onChange={(value) => updateCaptions({ highlight_color: value })}
                    />
                  </div>

                  <div>
                    <p className="mb-2.5 text-[13px] font-medium text-slate-300">Position</p>
                    <div
                      role="group"
                      aria-label="Caption position"
                      className="grid grid-cols-3 gap-2"
                    >
                      {(['top', 'middle', 'bottom'] as CaptionPosition[]).map((position) => {
                        const selected = settings.captions.position === position
                        return (
                          <button
                            key={position}
                            type="button"
                            aria-pressed={selected}

                            onClick={() => updateCaptions({ position })}
                            className={cn(
                              'h-9 rounded-lg border text-[12px] font-medium capitalize transition',
                              selected
                                ? 'border-white/20 bg-white/[0.085] text-white'
                                : 'border-white/[0.07] bg-white/[0.02] text-slate-500 hover:text-slate-300',
                            )}
                          >
                            {position}
                          </button>
                        )
                      })}
                    </div>
                  </div>

                  <div className="grid gap-5 sm:grid-cols-2">
                    <RangeField
                      label="Outline"
                      value={settings.captions.outline_width}
                      min={0}
                      max={8}
                      step={0.5}
                      display={
                        settings.captions.outline_width === 0
                          ? 'Off'
                          : settings.captions.outline_width.toFixed(1)
                      }
                      onValueChange={(value) => updateCaptions({ outline_width: value })}
                    />
                    <RangeField
                      label="Shadow"
                      value={settings.captions.shadow}
                      min={0}
                      max={8}
                      step={0.5}
                      display={
                        settings.captions.shadow === 0 ? 'Off' : settings.captions.shadow.toFixed(1)
                      }
                      onValueChange={(value) => updateCaptions({ shadow: value })}
                    />
                  </div>
                </div>
              </motion.div>
            ) : (
              <p className="text-xs leading-relaxed text-slate-500">
                Captions are off. The export will keep the original audio and framing only.
              </p>
            )}
          </SectionCard>

          <SectionCard
            icon={Sparkles}
            eyebrow="04 · Motion"
            title="Add the polish"
            description="Soft transitions ease viewers between the clip edges and internal cuts."
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
                              ? 'border-fuchsia-300/30 bg-fuchsia-300/[0.06]'
                              : 'border-white/[0.07] bg-white/[0.02] hover:border-white/15',
                          )}
                        >
                          <span
                            className={cn(
                              'block text-2xl leading-none transition group-hover:scale-110',
                              selected ? 'text-fuchsia-200' : 'text-slate-500',
                            )}
                            aria-hidden="true"
                          >
                            {transition.glyph}
                          </span>
                          <span
                            className={cn(
                              'mt-2 block text-[11px] font-medium',
                              selected ? 'text-white' : 'text-slate-400',
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
              <p className="text-xs leading-relaxed text-slate-500">
                Hard cuts throughout. Turn transitions on for eased edges and motion.
              </p>
            )}
          </SectionCard>

          {issue ? (
            <div
              role="alert"
              className="rounded-xl border border-amber-300/20 bg-amber-300/[0.055] px-4 py-3 text-[12.5px] leading-relaxed text-amber-100/85"
            >
              {issue}
            </div>
          ) : null}

          {generationError ? (
            <div
              role="alert"
              className="rounded-xl border border-rose-300/25 bg-rose-400/[0.07] px-4 py-3 text-[12.5px] leading-relaxed text-rose-100"
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
            <div className="mt-3 flex items-center justify-between text-[10px] text-slate-500">
              <span>
                {settings.aspect_ratio} ·{' '}
                {settings.captions.enabled && captionsAvailable ? 'Captions on' : 'Captions off'}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-300" />
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
      <p className="mt-2.5 text-center text-[10px] text-slate-500">
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
          ? 'border-cyan-300/30 bg-cyan-300/[0.055]'
          : 'border-white/[0.07] bg-white/[0.02] hover:border-white/15 hover:bg-white/[0.035]',
      )}
    >
      <span
        className={cn(
          'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border',
          selected
            ? 'border-cyan-300/20 bg-cyan-300/10 text-cyan-100'
            : 'border-white/[0.07] text-slate-500',
        )}
      >
        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      </span>
      <span>
        <span
          className={cn(
            'block text-[12.5px] font-semibold',
            selected ? 'text-white' : 'text-slate-300',
          )}
        >
          {title}
        </span>
        <span className="mt-1 block text-[10.5px] leading-4 text-slate-500">{copy}</span>
      </span>
      {selected ? (
        <span className="absolute right-2.5 top-2.5 flex h-4 w-4 items-center justify-center rounded-full bg-cyan-300 text-[#041016]">
          <Check className="h-2.5 w-2.5" strokeWidth={3} aria-hidden="true" />
        </span>
      ) : null}
    </button>
  )
}

function ColorRow({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (value: string) => void
}) {
  const inputId = `color-${label.toLowerCase()}`
  return (
    <div className="space-y-2">
      <FieldLabel htmlFor={inputId}>{label}</FieldLabel>
      <div className="flex h-10 items-center gap-2 rounded-lg border border-white/10 bg-white/[0.025] px-2">
        <input
          id={inputId}
          type="color"
          value={value}
          onChange={(event) => onChange(event.target.value.toUpperCase())}
          className="color-input"
        />
        <span className="flex-1 font-mono text-[11px] text-slate-400">{value.toUpperCase()}</span>
        <span
          className="h-2 w-2 rounded-full"
          style={{ backgroundColor: value, boxShadow: `0 0 12px ${value}80` }}
          aria-hidden="true"
        />
      </div>
    </div>
  )
}

function CaptionGlyph({ style, active }: { style: CaptionStyle; active: boolean }) {
  return (
    <span
      className={cn(
        'flex h-6 min-w-9 items-center justify-center rounded border px-1.5 text-[10px] font-semibold tracking-tight',
        active
          ? 'border-cyan-300/25 bg-cyan-300/[0.08] text-cyan-200'
          : 'border-white/[0.08] text-slate-500',
      )}
      aria-hidden="true"
    >
      {style === 'karaoke' ? (
        <span>
          A<span className="text-cyan-300">a</span>
        </span>
      ) : style === 'pop' ? (
        <span className="origin-center scale-110">Aa</span>
      ) : style === 'typewriter' ? (
        <span className="font-mono">A|</span>
      ) : (
        <span className="font-light">Aa</span>
      )}
    </span>
  )
}

const FONT_STACKS: Record<CaptionFont, string> = {
  Inter: 'Inter, sans-serif',
  Arial: 'Arial, sans-serif',
  Georgia: 'Georgia, serif',
  'DejaVu Sans': '"DejaVu Sans", sans-serif',
}

function PreviewPhone({ preview, settings }: { preview: PreviewResponse; settings: ClipSettings }) {
  const [imageFailed, setImageFailed] = useState(false)
  const blur = settings.reframe_mode === 'blur'
  const captions = settings.captions
  const sampleWords = ['Every', 'frame', 'counts.']
  const activeIndex = settings.captions.style === 'minimal' ? -1 : 1
  const fontScale = Math.max(0.17, captions.font_size / 1080)
  const captionFontSize = Math.max(10, Math.round(fontScale * 260))
  const captionShadow = captions.outline_width
    ? [
        `-${captions.outline_width}px 0 0 rgba(0,0,0,.85)`,
        `${captions.outline_width}px 0 0 rgba(0,0,0,.85)`,
        `0 -${captions.outline_width}px 0 rgba(0,0,0,.85)`,
        `0 ${captions.outline_width}px 0 rgba(0,0,0,.85)`,
        `0 ${captions.shadow + 1}px ${captions.shadow + 2}px rgba(0,0,0,.65)`,
      ].join(', ')
    : `0 ${captions.shadow + 1}px ${captions.shadow + 2}px rgba(0,0,0,.65)`
  const captionStyle: CSSProperties = {
    fontFamily: FONT_STACKS[captions.font],
    fontSize: `${captionFontSize}px`,
    color: captions.color,
    textShadow: captionShadow,
    lineHeight: 1.08,
  }
  const positionClass =
    captions.position === 'top'
      ? 'justify-start pt-[14%]'
      : captions.position === 'middle'
        ? 'justify-center'
        : 'justify-end pb-[16%]'

  return (
    <div className="glass overflow-hidden rounded-2xl p-2.5">
      <div className="relative mx-auto w-full max-w-[18.5rem] overflow-hidden rounded-[1.35rem] border border-white/10 bg-[#050814] shadow-[0_25px_80px_-35px_rgba(0,0,0,0.9)]">
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
            <span className="rounded-md border border-white/15 bg-black/35 px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-[0.16em] text-white/90 backdrop-blur">
              {settings.aspect_ratio}
            </span>
            <span className="rounded-md border border-white/15 bg-black/35 px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-[0.13em] text-white/80 backdrop-blur">
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

          <div
            className={cn(
              'absolute inset-0 flex flex-col items-center px-6 text-center',
              positionClass,
            )}
          >
            {captions.enabled ? (
              <p style={captionStyle} className="max-w-full">
                {settings.captions.style === 'typewriter' ? (
                  <>
                    Make every <span style={{ color: captions.highlight_color }}>fra</span>
                    <span className="opacity-50">me</span>
                    <span className="opacity-0"> count.</span>
                  </>
                ) : (
                  <>
                    {sampleWords.map((word, index) => (
                      <span
                        key={word}
                        style={
                          index === activeIndex
                            ? {
                                color: captions.highlight_color,
                                display: 'inline-block',
                                transform: captions.style === 'pop' ? 'scale(1.08)' : undefined,
                              }
                            : undefined
                        }
                      >
                        {word}
                        {index < sampleWords.length - 1 ? ' ' : ''}
                      </span>
                    ))}
                  </>
                )}
              </p>
            ) : null}
          </div>

          <div className="absolute inset-x-0 bottom-0 flex items-center justify-between px-3 pb-2.5">
            <span className="inline-flex items-center gap-1 rounded bg-black/45 px-1.5 py-1 text-[8px] font-medium tabular-nums text-white/80 backdrop-blur">
              <Clock3 className="h-2.5 w-2.5" aria-hidden="true" />
              {formatDuration(preview.duration)}
            </span>
            {settings.transitions.enabled ? (
              <span className="rounded border border-fuchsia-300/20 bg-black/45 px-1.5 py-1 text-[7px] font-semibold uppercase tracking-[0.14em] text-fuchsia-100/80 backdrop-blur">
                {settings.transitions.style.replace('_', ' ')} ·{' '}
                {settings.transitions.duration.toFixed(1)}s
              </span>
            ) : null}
          </div>

          <div className="pointer-events-none absolute inset-0 rounded-[1.35rem] ring-1 ring-inset ring-white/10" />
        </div>
      </div>

      <div className="px-1.5 pb-1 pt-3.5">
        <div className="flex items-center justify-between gap-3">
          <p className="min-w-0 truncate font-display text-[12.5px] font-medium text-slate-200">
            {preview.title}
          </p>
          <span className="shrink-0 text-[10px] tabular-nums text-slate-500">
            {settings.clip_count} clips
          </span>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <PreviewTag>
            {settings.captions.enabled ? settings.captions.style : 'No captions'}
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
    <span className="rounded border border-white/[0.075] bg-white/[0.03] px-1.5 py-0.5 text-[9px] font-medium capitalize text-slate-500">
      {children}
    </span>
  )
}
