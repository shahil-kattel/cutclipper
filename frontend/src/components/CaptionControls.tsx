import { useEffect, useRef, useState, type ReactNode } from 'react'
import { CaseSensitive, Check, Palette, Search, Sparkles, Type, X } from 'lucide-react'
import type {
  CaptionFontStyle,
  CaptionPosition,
  CaptionSettings,
  CaptionTextCase,
} from '../types/api'
import { cn } from '../lib/utils'
import {
  CAPTION_FONT_CATEGORIES,
  CAPTION_FONT_OPTIONS,
  CAPTION_FONT_STYLE_OPTIONS,
  captionFontOption,
  captionFontStack,
  fontMatchesSearch,
} from '../lib/captionFonts'
import { LINE_PRESETS, WORD_PRESETS, type CaptionPreset } from '../lib/captionPresets'
import { FieldLabel, RangeField } from './ui'

const QUICK_COLORS = ['#FFFFFF', '#211D19', '#F2BE4F', '#22D3EE', '#FF6B8A', '#7BD389', '#B69CFF']
const POSITIONS: Array<{ value: CaptionPosition; label: string }> = [
  { value: 'top', label: 'Top' },
  { value: 'middle', label: 'Middle' },
  { value: 'bottom', label: 'Bottom' },
]
const CASE_OPTIONS: Array<{ value: CaptionTextCase; label: string }> = [
  { value: 'none', label: 'As typed' },
  { value: 'uppercase', label: 'UPPER' },
  { value: 'lowercase', label: 'lower' },
]

export function FontPicker({
  value,
  onChange,
  disabled,
  compact = false,
}: {
  value: string
  onChange: (font: string) => void
  disabled?: boolean
  compact?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const triggerRef = useRef<HTMLButtonElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const current = captionFontOption(value)
  const filtered = CAPTION_FONT_OPTIONS.filter((font) => fontMatchesSearch(font, query))

  useEffect(() => {
    if (!open) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const timer = window.setTimeout(() => searchRef.current?.focus(), 30)
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
        triggerRef.current?.focus()
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('keydown', handleKey)
      document.body.style.overflow = previousOverflow
    }
  }, [open])

  const choose = (font: string) => {
    onChange(font)
    setOpen(false)
    setQuery('')
    requestAnimationFrame(() => triggerRef.current?.focus())
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className={cn(
          'flex w-full items-center justify-between gap-3 rounded-lg border-[1.5px] border-ink bg-paper-soft px-3 text-left shadow-[1px_2px_0_rgba(33,29,25,0.16)] transition hover:-translate-y-px hover:shadow-[2px_3px_0_rgba(33,29,25,0.18)] disabled:cursor-not-allowed disabled:opacity-45',
          compact ? 'h-9' : 'h-11',
        )}
      >
        <span className="min-w-0">
          <span
            className="block truncate text-[14px] font-semibold text-ink"
            style={{ fontFamily: captionFontStack(current.name) }}
          >
            {current.name}
          </span>
          {!compact ? (
            <span className="block text-[9px] font-medium uppercase tracking-[0.12em] text-ink-faint">
              {current.category} · {CAPTION_FONT_OPTIONS.length} fonts
            </span>
          ) : null}
        </span>
        <span className="flex shrink-0 items-center gap-1 text-ink-soft">
          <span className="font-hand text-[14px]">browse</span>
          <Type className="h-4 w-4" aria-hidden="true" />
        </span>
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-[90] flex items-end justify-center bg-ink/35 p-3 backdrop-blur-[2px] sm:items-center sm:p-6"
          role="dialog"
          aria-modal="true"
          aria-labelledby="caption-font-dialog-title"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setOpen(false)
              triggerRef.current?.focus()
            }
          }}
        >
          <div className="paper-card taped flex max-h-[88dvh] w-full max-w-2xl flex-col overflow-hidden p-0">
            <div className="flex items-start justify-between gap-4 border-b-[1.5px] border-ink px-4 py-3.5 sm:px-5">
              <div>
                <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-tomato">
                  Font shelf
                </p>
                <h2
                  id="caption-font-dialog-title"
                  className="mt-0.5 font-display text-2xl font-semibold tracking-[-0.03em] text-ink"
                >
                  Pick a voice for your words.
                </h2>
                <p className="mt-1 text-[10.5px] text-ink-soft">
                  {CAPTION_FONT_OPTIONS.length} families · regular, bold, italic, and bold italic.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setOpen(false)
                  triggerRef.current?.focus()
                }}
                aria-label="Close font picker"
                className="flex h-8 w-8 shrink-0 -rotate-2 items-center justify-center rounded-lg border-[1.5px] border-ink bg-paper-soft text-ink shadow-[1px_2px_0_#211d19] transition hover:bg-tomato-soft"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            <div className="border-b border-dashed border-ink/20 px-4 py-3 sm:px-5">
              <label className="relative block">
                <span className="sr-only">Search caption fonts</span>
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-soft"
                  aria-hidden="true"
                />
                <input
                  ref={searchRef}
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search by name, style, or script…"
                  className="paper-input h-10 w-full rounded-lg pl-9 pr-3 text-[12.5px] font-medium outline-none focus:border-tomato"
                />
              </label>
            </div>
            <div className="scrollbar-thin flex-1 overflow-y-auto px-3 py-3 sm:px-4">
              {CAPTION_FONT_CATEGORIES.map((category) => {
                const fonts = filtered.filter((font) => font.category === category)
                if (!fonts.length) return null
                return (
                  <section key={category} className="mb-4 last:mb-0">
                    <div className="mb-2 flex items-center gap-2 px-1">
                      <span className="text-[9px] font-bold uppercase tracking-[0.16em] text-ink-soft">
                        {category}
                      </span>
                      <span className="h-px flex-1 bg-ink/15" aria-hidden="true" />
                    </div>
                    <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                      {fonts.map((font) => {
                        const selected = font.name === value
                        return (
                          <button
                            key={font.name}
                            type="button"
                            onClick={() => choose(font.name)}
                            aria-pressed={selected}
                            className={cn(
                              'group flex min-h-[3.2rem] items-center justify-between gap-2 rounded-lg border-[1.5px] px-3 py-2 text-left transition',
                              selected
                                ? 'border-ink bg-mustard-soft shadow-[2px_2px_0_#211d19]'
                                : 'border-ink/20 bg-paper-soft hover:-translate-y-px hover:border-ink hover:bg-periwinkle-soft/50',
                            )}
                          >
                            <span className="min-w-0">
                              <span
                                className="block truncate text-[16px] leading-tight text-ink"
                                style={{ fontFamily: captionFontStack(font.name) }}
                              >
                                {font.name}
                              </span>
                              <span className="mt-0.5 block text-[8.5px] font-semibold uppercase tracking-[0.1em] text-ink-faint">
                                {font.scripts.includes('devanagari')
                                  ? 'Latin + Devanagari'
                                  : 'Latin'}
                              </span>
                            </span>
                            {selected ? (
                              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-ink bg-paper text-ink">
                                <Check className="h-3 w-3" strokeWidth={3} aria-hidden="true" />
                              </span>
                            ) : null}
                          </button>
                        )
                      })}
                    </div>
                  </section>
                )
              })}
              {!filtered.length ? (
                <div className="px-4 py-10 text-center">
                  <p className="font-display text-xl font-semibold text-ink">No font found.</p>
                  <p className="mt-1 text-[11px] text-ink-soft">
                    Try a name, serif, mono, or Nepali.
                  </p>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}

export function CaptionStyleControls({
  settings,
  onChange,
  showHeader = true,
  compactPresets = false,
}: {
  settings: CaptionSettings
  onChange: (patch: Partial<CaptionSettings>) => void
  showHeader?: boolean
  compactPresets?: boolean
}) {
  const style = settings.font_style
  const setStyle = (value: CaptionFontStyle) => onChange({ font_style: value })
  const current = captionFontOption(settings.font)

  return (
    <div className="space-y-5">
      {showHeader ? (
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.16em] text-ink-soft">
              <Palette className="h-3 w-3 text-tomato" aria-hidden="true" />
              Caption style
            </p>
            <p className="mt-1 font-display text-[15px] font-semibold text-ink">
              {WORD_PRESETS.length + LINE_PRESETS.length} motion presets ·{' '}
              {CAPTION_FONT_OPTIONS.length} fonts
            </p>
          </div>
          <span className="hidden rotate-2 rounded border border-ink/25 bg-mustard-soft px-2 py-1 font-hand text-[13px] text-ink-soft sm:block">
            make it move
          </span>
        </div>
      ) : null}

      <div>
        <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1">
          <Sparkles className="h-3.5 w-3.5 text-tomato" aria-hidden="true" />
          <p className="text-[11.5px] font-semibold text-ink">Word play</p>
          <span className="text-[9px] text-ink-faint">the spoken word leads</span>
          <span className="ml-auto rounded border border-ink/20 bg-paper px-1.5 py-0.5 font-hand text-[12px] leading-none text-ink-soft">
            mix one from each row
          </span>
        </div>
        <div
          className={cn(
            'grid gap-1.5',
            compactPresets ? 'grid-cols-2 sm:grid-cols-3' : 'grid-cols-2',
          )}
        >
          <NonePresetButton
            selected={settings.word_style === null}
            bucket="word"
            label="No word effect"
            hint="Words stay still while the line moves."
            onClick={() => onChange({ word_style: null })}
          />
          {WORD_PRESETS.map((preset) => (
            <PresetButton
              key={preset.value}
              preset={preset}
              bucket="word"
              selected={settings.word_style === preset.value}
              onClick={() => onChange({ word_style: preset.value })}
            />
          ))}
        </div>
      </div>

      <div>
        <div className="mb-2 flex items-center gap-2">
          <Type className="h-3.5 w-3.5 text-teal" aria-hidden="true" />
          <p className="text-[11.5px] font-semibold text-ink">Line entrances</p>
          <span className="text-[9px] text-ink-faint">whole caption blocks</span>
        </div>
        <div
          className={cn(
            'grid gap-1.5',
            compactPresets ? 'grid-cols-2 sm:grid-cols-3' : 'grid-cols-2',
          )}
        >
          <NonePresetButton
            selected={settings.line_style === null}
            bucket="line"
            label="No line entrance"
            hint="No whole-block movement."
            onClick={() => onChange({ line_style: null })}
          />
          {LINE_PRESETS.map((preset) => (
            <PresetButton
              key={preset.value}
              preset={preset}
              bucket="line"
              selected={settings.line_style === preset.value}
              onClick={() => onChange({ line_style: preset.value })}
            />
          ))}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <div className="space-y-1.5">
          <FieldLabel>Typeface</FieldLabel>
          <FontPicker value={settings.font} onChange={(font) => onChange({ font })} />
        </div>
        <div className="space-y-1.5">
          <FieldLabel>Font style</FieldLabel>
          <div role="group" aria-label="Font style" className="grid grid-cols-2 gap-1">
            {CAPTION_FONT_STYLE_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={style === option.value}
                onClick={() => setStyle(option.value)}
                className={cn(
                  'h-7 rounded-md border text-[10px] font-semibold transition',
                  style === option.value
                    ? 'border-ink bg-mustard-soft text-ink shadow-[1px_1px_0_#211d19]'
                    : 'border-ink/20 bg-paper-soft text-ink-soft hover:border-ink hover:text-ink',
                )}
                style={{
                  fontFamily: captionFontStack(current.name),
                  fontWeight: option.weight,
                  fontStyle: option.style,
                }}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <RangeField
          label="Caption size"
          value={settings.font_size}
          min={32}
          max={160}
          display={`${settings.font_size}px`}
          onValueChange={(value) => onChange({ font_size: value })}
          tone="tomato"
        />
        <RangeField
          label="Letter spacing"
          value={settings.letter_spacing}
          min={-5}
          max={20}
          step={0.5}
          display={`${settings.letter_spacing}px`}
          onValueChange={(value) => onChange({ letter_spacing: value })}
          tone="teal"
        />
        <RangeField
          label="Word gap"
          value={settings.word_spacing}
          min={0}
          max={40}
          step={0.5}
          display={`${settings.word_spacing}px`}
          onValueChange={(value) => onChange({ word_spacing: value })}
          tone="periwinkle"
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <ColorControl
          label="Text color"
          value={settings.color}
          onChange={(color) => onChange({ color })}
        />
        <ColorControl
          label="Highlight color"
          value={settings.highlight_color}
          onChange={(highlight_color) => onChange({ highlight_color })}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <p className="text-[11.5px] font-medium text-ink-soft">Position</p>
          <div role="group" aria-label="Caption position" className="grid grid-cols-3 gap-1.5">
            {POSITIONS.map((position) => (
              <button
                key={position.value}
                type="button"
                aria-pressed={settings.position === position.value}
                onClick={() => onChange({ position: position.value })}
                className={cn(
                  'h-8 rounded-md border text-[10.5px] font-semibold transition',
                  settings.position === position.value
                    ? 'border-ink bg-periwinkle-soft text-ink shadow-[1px_1px_0_#211d19]'
                    : 'border-ink/20 bg-paper-soft text-ink-soft hover:border-ink hover:text-ink',
                )}
              >
                {position.label}
              </button>
            ))}
          </div>
        </div>
        <div className="space-y-1.5">
          <p className="flex items-center gap-1 text-[11.5px] font-medium text-ink-soft">
            <CaseSensitive className="h-3.5 w-3.5" aria-hidden="true" /> Text case
          </p>
          <div role="group" aria-label="Caption text case" className="grid grid-cols-3 gap-1.5">
            {CASE_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={settings.text_case === option.value}
                onClick={() => onChange({ text_case: option.value })}
                className={cn(
                  'h-8 rounded-md border text-[10px] font-semibold transition',
                  settings.text_case === option.value
                    ? 'border-ink bg-teal-soft text-ink shadow-[1px_1px_0_#211d19]'
                    : 'border-ink/20 bg-paper-soft text-ink-soft hover:border-ink hover:text-ink',
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <RangeField
          label="Outline"
          value={settings.outline_width}
          min={0}
          max={10}
          step={0.5}
          display={settings.outline_width === 0 ? 'Off' : settings.outline_width.toFixed(1)}
          onValueChange={(value) => onChange({ outline_width: value })}
          tone="periwinkle"
        />
        <RangeField
          label="Shadow"
          value={settings.shadow}
          min={0}
          max={10}
          step={0.5}
          display={settings.shadow === 0 ? 'Off' : settings.shadow.toFixed(1)}
          onValueChange={(value) => onChange({ shadow: value })}
          tone="mustard"
        />
      </div>
    </div>
  )
}

function NonePresetButton({
  selected,
  bucket,
  label,
  hint,
  onClick,
}: {
  selected: boolean
  bucket: 'word' | 'line'
  label: string
  hint: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      data-bucket={bucket}
      data-preset="none"
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        'group flex min-h-[3rem] items-center gap-2 rounded-lg border-[1.5px] px-2.5 py-2 text-left transition',
        selected
          ? 'border-ink bg-paper-deep shadow-[2px_2px_0_#211d19]'
          : 'border-dashed border-ink/30 bg-paper/55 hover:-translate-y-px hover:border-ink hover:bg-paper-soft',
      )}
    >
      <span
        className={cn(
          'flex h-7 w-7 shrink-0 items-center justify-center rounded-md border text-[13px] font-semibold',
          selected ? 'border-ink bg-paper-soft text-ink' : 'border-ink/20 bg-paper text-ink-faint',
        )}
        aria-hidden="true"
      >
        —
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[11px] font-semibold leading-tight text-ink">
          {label}
        </span>
        <span className="mt-0.5 block truncate text-[9px] leading-tight text-ink-soft">{hint}</span>
      </span>
      {selected ? (
        <Check
          className="ml-auto h-3.5 w-3.5 shrink-0 text-ink"
          strokeWidth={3}
          aria-hidden="true"
        />
      ) : null}
    </button>
  )
}

function PresetButton({
  preset,
  bucket,
  selected,
  onClick,
}: {
  preset: CaptionPreset
  bucket: 'word' | 'line'
  selected: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      data-bucket={bucket}
      data-preset={preset.value}
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        'group relative flex min-h-[3rem] items-center gap-2 rounded-lg border-[1.5px] px-2.5 py-2 text-left transition',
        selected
          ? 'border-ink bg-mustard-soft shadow-[2px_2px_0_#211d19]'
          : 'border-ink/20 bg-paper-soft hover:-translate-y-px hover:border-ink hover:bg-periwinkle-soft/45',
      )}
    >
      <span
        className={cn(
          'flex h-7 w-7 shrink-0 items-center justify-center rounded-md border text-[11px] font-bold',
          selected
            ? 'border-ink bg-tomato text-paper-soft'
            : 'border-ink/20 bg-paper text-ink-soft',
        )}
        aria-hidden="true"
      >
        {preset.kind === 'word' ? 'Aa' : '¶'}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[11px] font-semibold leading-tight text-ink">
          {preset.label}
        </span>
        <span className="mt-0.5 block truncate text-[9px] leading-tight text-ink-soft">
          {preset.description}
        </span>
      </span>
      {selected ? (
        <Check
          className="ml-auto h-3.5 w-3.5 shrink-0 text-ink"
          strokeWidth={3}
          aria-hidden="true"
        />
      ) : null}
    </button>
  )
}

function ColorControl({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <div className="space-y-1.5">
      <FieldLabel>{label}</FieldLabel>
      <div className="flex items-center gap-1.5">
        <input
          type="color"
          value={value}
          onChange={(event) => onChange(event.target.value.toUpperCase())}
          className="color-input h-9 w-9 shrink-0"
          aria-label={label}
        />
        <span className="font-display text-[11px] font-semibold tabular-nums text-ink-soft">
          {value.toUpperCase()}
        </span>
        <div className="ml-auto hidden items-center gap-1 sm:flex">
          {QUICK_COLORS.map((color) => (
            <button
              key={color}
              type="button"
              aria-label={`Use ${color}`}
              onClick={() => onChange(color)}
              className={cn(
                'h-3.5 w-3.5 rounded-full border border-ink/40 transition hover:scale-125',
                value.toUpperCase() === color ? 'ring-2 ring-ink ring-offset-1' : '',
              )}
              style={{ backgroundColor: color }}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

export function CaptionToggleRow({
  enabled,
  onChange,
  disabled,
  note,
}: {
  enabled: boolean
  onChange: (value: boolean) => void
  disabled?: boolean
  note?: ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-ink/20 bg-paper px-3 py-2.5">
      <div>
        <p className="text-[11.5px] font-semibold text-ink">Captions</p>
        <p className="mt-0.5 text-[9.5px] text-ink-soft">
          {note ?? 'Burn styled captions into this export.'}
        </p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label="Captions"
        disabled={disabled}
        onClick={() => onChange(!enabled)}
        className={cn(
          'relative h-[1.6rem] w-[3rem] shrink-0 rounded-full border-[1.5px] border-ink transition-colors duration-200',
          'after:absolute after:left-[3px] after:top-[3px] after:h-[1.1rem] after:w-[1.1rem] after:rounded-full after:border-[1.5px] after:border-ink after:bg-paper-soft after:shadow-[1px_1px_0_#211d19] after:transition-transform after:duration-200',
          enabled ? 'bg-teal after:translate-x-[1.3rem]' : 'bg-paper-deep after:translate-x-0',
          disabled && 'cursor-not-allowed opacity-40',
        )}
      >
        <span className="sr-only">Captions</span>
      </button>
    </div>
  )
}
