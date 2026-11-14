import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Captions,
  Languages,
  LoaderCircle,
  Plus,
  Scissors,
  Play,
  Trash2,
  TriangleAlert,
  WandSparkles,
  X,
} from 'lucide-react'
import type { CaptionSegment, NepaliScript, TranscriptWord } from '../types/api'
import { cn } from '../lib/utils'
import { useToast } from '../hooks/useToast'
import { Button } from './ui'
import { NepaliScriptToggle } from './CaptionControls'

const DEVANAGARI_RE = /[ऀ-ॿ]/

function captionLanguage(text: string): CaptionSegment['language'] {
  const devanagari = DEVANAGARI_RE.test(text)
  const latin = /[A-Za-z]/.test(text)
  if (devanagari && latin) return 'mixed'
  if (devanagari) return 'ne'
  if (latin) return 'en'
  return null
}

function tokensOf(text: string): string[] {
  return text.split(/\s+/).filter(Boolean)
}

/** Keep exact word timings when a text edit only changes spelling/case. */
function retimeWordsForText(
  words: TranscriptWord[] | undefined,
  text: string,
): TranscriptWord[] | undefined {
  if (!words?.length) return undefined
  const tokens = tokensOf(text)
  if (tokens.length !== words.length) return undefined
  return words.map((word, index) => ({ ...word, text: tokens[index] ?? word.text }))
}

/** Scale existing word timings when the user moves a line's start or end. */
function scaleWords(
  words: TranscriptWord[] | undefined,
  oldStart: number,
  oldEnd: number,
  newStart: number,
  newEnd: number,
): TranscriptWord[] | undefined {
  if (!words?.length) return undefined
  const oldSpan = Math.max(0.01, oldEnd - oldStart)
  const newSpan = Math.max(0.01, newEnd - newStart)
  return words.map((word) => {
    const start = newStart + ((word.start - oldStart) / oldSpan) * newSpan
    const end = newStart + ((word.end - oldStart) / oldSpan) * newSpan
    return {
      ...word,
      start: Math.max(newStart, start),
      end: Math.min(newEnd, Math.max(start + 0.01, end)),
    }
  })
}

function applySegmentPatch(
  segment: CaptionSegment,
  patch: Partial<CaptionSegment>,
): CaptionSegment {
  let words = segment.words
  if (patch.text !== undefined) {
    words = retimeWordsForText(segment.words, patch.text)
  }
  const next: CaptionSegment = {
    ...segment,
    ...patch,
    words,
    language: captionLanguage(patch.text ?? segment.text),
  }
  if (patch.start !== undefined || patch.end !== undefined) {
    next.words = scaleWords(next.words, segment.start, segment.end, next.start, next.end)
  }
  return next
}

/** Editable caption lines with add, split, merge, delete, and timing controls. */
export function CaptionLineEditor({
  segments,
  duration,
  onChange,
  currentTime,
  activeIndex,
  onSeek,
  romanSegments,
  romanising = false,
  showRoman = false,
  disabled = false,
  className,
}: {
  segments: CaptionSegment[]
  duration: number
  onChange: (segments: CaptionSegment[]) => void
  currentTime?: number
  activeIndex?: number
  onSeek?: (time: number) => void
  romanSegments?: CaptionSegment[] | null
  romanising?: boolean
  showRoman?: boolean
  disabled?: boolean
  className?: string
}) {
  const toast = useToast()
  const [selectedSegment, setSelectedSegment] = useState<number | null>(null)
  const romanByStart = useMemo(
    () => new Map((romanSegments ?? []).map((segment) => [segment.start.toFixed(3), segment])),
    [romanSegments],
  )

  const updateSegment = (index: number, patch: Partial<CaptionSegment>) => {
    onChange(
      segments.map((segment, position) =>
        position === index ? applySegmentPatch(segment, patch) : segment,
      ),
    )
  }

  const deleteSegment = (index: number) => {
    onChange(segments.filter((_, position) => position !== index))
    setSelectedSegment(null)
  }

  const mergeWithNext = (index: number) => {
    const current = segments[index]
    const next = segments[index + 1]
    if (!current || !next) return
    const text = `${current.text} ${next.text}`.trim()
    const mergedWords =
      current.words?.length &&
      next.words?.length &&
      current.words.length + next.words.length === tokensOf(text).length
        ? [...current.words, ...next.words]
        : undefined
    const merged: CaptionSegment = {
      start: current.start,
      end: Math.max(current.end, next.end),
      text,
      words: mergedWords,
      language: captionLanguage(text),
    }
    onChange([...segments.slice(0, index), merged, ...segments.slice(index + 2)])
  }

  const splitSegment = (index: number) => {
    const current = segments[index]
    if (!current) return
    const words = current.text.split(/\s+/).filter(Boolean)
    if (words.length < 2) return
    const splitAt =
      currentTime !== undefined &&
      currentTime > current.start + 0.15 &&
      currentTime < current.end - 0.15
        ? currentTime
        : current.start + (current.end - current.start) / 2
    const ratio = (splitAt - current.start) / Math.max(0.05, current.end - current.start)
    const splitIndex = Math.min(words.length - 1, Math.max(1, Math.round(words.length * ratio)))
    const left = words.slice(0, splitIndex).join(' ')
    const right = words.slice(splitIndex).join(' ')
    const splitWords =
      current.words?.length === words.length
        ? {
            left: current.words.slice(0, splitIndex).map((word, sliceIndex) => ({
              ...word,
              end:
                sliceIndex === splitIndex - 1
                  ? Math.min(word.end, Math.max(word.start + 0.01, splitAt))
                  : word.end,
            })),
            right: current.words.slice(splitIndex).map((word, sliceIndex) => ({
              ...word,
              start:
                sliceIndex === 0
                  ? Math.max(word.start, Math.min(splitAt, word.end - 0.01))
                  : word.start,
            })),
          }
        : null
    onChange([
      ...segments.slice(0, index),
      {
        start: current.start,
        end: splitAt,
        text: left,
        words: splitWords?.left,
        language: captionLanguage(left),
      },
      {
        start: splitAt,
        end: current.end,
        text: right,
        words: splitWords?.right,
        language: captionLanguage(right),
      },
      ...segments.slice(index + 1),
    ])
  }

  const addSegment = () => {
    const total = duration > 0.2 ? duration : (segments[segments.length - 1]?.end ?? 0) + 3
    const gap = 0.05
    const minLength = Math.min(1, total)
    const last = segments[segments.length - 1]
    let insertAt = segments.length
    let start = 0
    if (last) {
      start = last.end + gap
      if (start > total - minLength) {
        const previous = segments[segments.length - 2]
        const previousEnd = previous ? previous.end : 0
        if (last.start - previousEnd < minLength + gap) {
          if (duration > 0.2) {
            toast.info('No room for another line. Shorten or split an existing line first.')
            return
          }
          start = last.end + gap
        } else {
          insertAt = segments.length - 1
          start = previousEnd + gap
        }
      }
    }
    const end = Math.min(total, Math.max(start + minLength, start + 3))
    onChange([
      ...segments.slice(0, insertAt),
      { start: Number(start.toFixed(2)), end: Number(end.toFixed(2)), text: 'New caption' },
      ...segments.slice(insertAt),
    ])
    setSelectedSegment(insertAt)
  }

  return (
    <div className={cn('space-y-3', className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] font-semibold text-ink-soft">
          {segments.length} editable {segments.length === 1 ? 'line' : 'lines'}
        </p>
        <Button variant="secondary" size="sm" icon={Plus} onClick={addSegment} disabled={disabled}>
          Add line
        </Button>
      </div>

      {!segments.length ? (
        <div className="rounded-xl border border-dashed border-ink/30 bg-paper px-5 py-10 text-center">
          <Captions className="mx-auto h-6 w-6 text-ink-faint" aria-hidden="true" />
          <p className="mt-3 text-sm font-medium text-ink-soft">No caption lines yet</p>
          <p className="mx-auto mt-1 max-w-md text-[12px] leading-5 text-ink-soft">
            Transcribe the video or add a line manually, then fix any word the model got wrong.
          </p>
        </div>
      ) : (
        <div className="max-h-[min(56vh,34rem)] space-y-2 overflow-y-auto pr-1">
          {segments.map((segment, index) => (
            <SegmentRow
              key={`${segment.start}-${index}`}
              index={index}
              segment={segment}
              duration={duration}
              active={index === activeIndex || index === selectedSegment}
              canMerge={index + 1 < segments.length}
              showRomanHint={
                showRoman && DEVANAGARI_RE.test(segment.text) && segment.text.trim().length > 0
              }
              romanText={romanByStart.get(segment.start.toFixed(3))?.text}
              romanising={romanising}
              disabled={disabled}
              onChange={(patch) => updateSegment(index, patch)}
              onFocus={() => setSelectedSegment(index)}
              onPlay={() => {
                setSelectedSegment(index)
                onSeek?.(segment.start)
              }}
              onSplit={() => splitSegment(index)}
              onMerge={() => mergeWithNext(index)}
              onDelete={() => deleteSegment(index)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function SegmentRow({
  index,
  segment,
  duration,
  active,
  canMerge,
  showRomanHint,
  romanText,
  romanising,
  disabled,
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
  showRomanHint: boolean
  romanText?: string
  romanising: boolean
  disabled?: boolean
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
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <span className="w-6 shrink-0 font-display text-[10px] tabular-nums text-ink-faint">
          {String(index + 1).padStart(2, '0')}
        </span>
        <label className="sr-only" htmlFor={`caption-start-${index}`}>
          Caption {index + 1} start time
        </label>
        <TimeInput
          id={`caption-start-${index}`}
          value={segment.start}
          min={0}
          max={Math.max(0, segment.end - 0.1)}
          label={`Caption ${index + 1} start`}
          disabled={disabled}
          onFocus={onFocus}
          onCommit={(value) => onChange({ start: value })}
        />
        <span className="text-ink-faint">→</span>
        <label className="sr-only" htmlFor={`caption-end-${index}`}>
          Caption {index + 1} end time
        </label>
        <TimeInput
          id={`caption-end-${index}`}
          value={segment.end}
          min={Math.min(duration, segment.start + 0.1)}
          max={duration || segment.end + 0.1}
          label={`Caption ${index + 1} end`}
          disabled={disabled}
          onFocus={onFocus}
          onCommit={(value) => onChange({ end: value })}
        />
        <div className="ml-auto flex items-center gap-0.5">
          <IconAction label="Play this caption" onClick={onPlay} disabled={disabled}>
            <Play className="h-3.5 w-3.5" aria-hidden="true" />
          </IconAction>
          <IconAction label="Split at current time" onClick={onSplit} disabled={disabled}>
            <Scissors className="h-3.5 w-3.5" aria-hidden="true" />
          </IconAction>
          <IconAction label="Merge with next" onClick={onMerge} disabled={disabled || !canMerge}>
            <Plus className="h-3.5 w-3.5 rotate-45" aria-hidden="true" />
          </IconAction>
          <IconAction label="Delete caption" onClick={onDelete} disabled={disabled} danger>
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
          </IconAction>
        </div>
      </div>
      <textarea
        value={segment.text}
        rows={1}
        disabled={disabled}
        onFocus={onFocus}
        onChange={(event) => onChange({ text: event.target.value })}
        className="mt-1.5 w-full resize-none rounded-md border border-transparent bg-transparent px-1 py-0.5 text-[12.5px] font-medium leading-5 text-ink focus:border-ink/30 focus:bg-paper-soft focus:outline-none disabled:opacity-60"
        aria-label={`Caption ${index + 1} text`}
      />
      {showRomanHint ? (
        <p
          className="mt-0.5 line-clamp-2 min-h-4 px-1 text-[10.5px] leading-4 text-ink-faint"
          title={romanText}
        >
          <span className="mr-1 font-bold uppercase tracking-[0.08em] text-ink-soft/70">Roman</span>
          {romanText ?? (romanising ? 'Transliterating…' : '—')}
        </p>
      ) : null}
    </div>
  )
}

function TimeInput({
  id,
  value,
  min,
  max,
  label,
  disabled,
  onFocus,
  onCommit,
}: {
  id: string
  value: number
  min: number
  max: number
  label: string
  disabled?: boolean
  onFocus: () => void
  onCommit: (value: number) => void
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const display = draft ?? value.toFixed(2)

  const commit = () => {
    if (draft === null) return
    const parsed = Number.parseFloat(draft)
    const lower = Math.min(min, max)
    const upper = Math.max(min, max)
    const next = Number.isFinite(parsed) ? Math.min(upper, Math.max(lower, parsed)) : value
    const rounded = Number(next.toFixed(2))
    onCommit(rounded)
    setDraft(null)
  }

  return (
    <input
      id={id}
      type="text"
      inputMode="decimal"
      value={display}
      disabled={disabled}
      onFocus={() => {
        setDraft(value.toFixed(2))
        onFocus()
      }}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur()
      }}
      className="paper-input h-7 w-16 rounded-md px-1.5 text-[10.5px] font-semibold tabular-nums text-tomato outline-none disabled:opacity-60"
      aria-label={label}
    />
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

/**
 * Full caption editor available from every non-home page. It edits the
 * canonical source lines and shows the Roman mirror when that script is on.
 */
export function CaptionEditorDrawer({
  open,
  onClose,
  segments,
  duration,
  onChange,
  script,
  onScriptChange,
  devanagariFont,
  romanSegments,
  romanising,
  loading = false,
  loadingText = 'Loading caption lines…',
  error,
  onTranscribe,
  transcribing = false,
  canTranscribe = false,
  notice,
  applyLabel = 'Save lines',
  onApply,
  applying = false,
  applyDisabled = false,
  title = 'Edit captions',
  description = 'Fix any word the model got wrong, adjust timing, and choose the Nepali script.',
}: {
  open: boolean
  onClose: () => void
  segments: CaptionSegment[]
  duration: number
  onChange: (segments: CaptionSegment[]) => void
  script: NepaliScript
  onScriptChange?: (script: NepaliScript) => void
  devanagariFont?: string
  romanSegments?: CaptionSegment[] | null
  romanising?: boolean
  loading?: boolean
  loadingText?: string
  error?: string | null
  onTranscribe?: () => void
  transcribing?: boolean
  canTranscribe?: boolean
  notice?: string | null
  applyLabel?: string
  onApply?: () => void | Promise<void>
  applying?: boolean
  applyDisabled?: boolean
  title?: string
  description?: string
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    document.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', onKey)
    }
  }, [open, onClose])

  if (typeof document === 'undefined') return null

  return createPortal(
    <AnimatePresence>
      {open ? (
        <motion.div
          className="fixed inset-0 z-[80] flex justify-end bg-ink/45 backdrop-blur-[2px]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) onClose()
          }}
        >
          <motion.section
            role="dialog"
            aria-modal="true"
            aria-label={title}
            className="flex h-full w-full max-w-2xl flex-col border-l-[1.5px] border-ink bg-paper shadow-[-8px_0_0_rgba(33,29,25,0.18)]"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header className="flex items-start justify-between gap-3 border-b-[1.5px] border-ink bg-paper px-4 py-4 sm:px-5">
              <div>
                <p className="flex items-center gap-2 text-[9px] font-bold uppercase tracking-[0.18em] text-tomato">
                  <span className="h-px w-5 bg-tomato" aria-hidden="true" />
                  Caption editor
                </p>
                <h2 className="mt-1 font-display text-2xl font-semibold tracking-[-0.035em] text-ink">
                  {title}
                </h2>
                <p className="mt-1 max-w-xl text-[11.5px] leading-5 text-ink-soft">{description}</p>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close caption editor"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border-[1.5px] border-ink bg-paper-soft text-ink shadow-[1px_2px_0_#211d19] transition hover:bg-tomato-soft"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </header>

            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 sm:px-5">
              {onScriptChange ? (
                <div className="flex flex-col gap-2 rounded-xl border-[1.5px] border-ink/25 bg-paper-soft px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="flex items-center gap-1.5 text-[11.5px] font-semibold text-ink">
                      <Languages className="h-3.5 w-3.5 text-tomato" aria-hidden="true" />
                      Nepali caption script
                    </p>
                    <p className="mt-0.5 text-[10px] leading-4 text-ink-soft">
                      Keep the spoken words in देवनागरी or write the Nepali words in Roman letters.
                      English words stay English either way.
                    </p>
                  </div>
                  <NepaliScriptToggle
                    value={script}
                    onChange={onScriptChange}
                    busy={romanising}
                    devanagariFont={devanagariFont}
                  />
                </div>
              ) : null}

              {notice ? (
                <div className="rounded-xl border border-ink/25 bg-mustard-soft/70 px-3 py-2.5 text-[11px] leading-5 text-ink-soft">
                  {notice}
                </div>
              ) : null}

              {loading ? (
                <div className="paper-inset flex flex-col items-center justify-center gap-3 px-4 py-12 text-center">
                  <LoaderCircle className="h-6 w-6 animate-spin text-tomato" aria-hidden="true" />
                  <p className="text-sm font-medium text-ink">{loadingText}</p>
                </div>
              ) : error ? (
                <div
                  role="alert"
                  className="flex items-start gap-2.5 rounded-xl border-[1.5px] border-ink bg-tomato-soft px-4 py-3 text-sm font-medium text-ink shadow-[2px_2px_0_#211d19]"
                >
                  <TriangleAlert
                    className="mt-0.5 h-4 w-4 shrink-0 text-tomato"
                    aria-hidden="true"
                  />
                  <p className="leading-relaxed">{error}</p>
                </div>
              ) : (
                <>
                  {!segments.length && canTranscribe && onTranscribe ? (
                    <div className="rounded-xl border border-dashed border-ink/30 bg-paper px-4 py-5 text-center">
                      <p className="text-sm font-medium text-ink-soft">
                        No caption lines loaded yet
                      </p>
                      <Button
                        className="mt-3"
                        size="sm"
                        icon={WandSparkles}
                        loading={transcribing}
                        onClick={onTranscribe}
                      >
                        Transcribe this video
                      </Button>
                    </div>
                  ) : null}
                  <CaptionLineEditor
                    segments={segments}
                    duration={duration}
                    onChange={onChange}
                    romanSegments={romanSegments}
                    romanising={romanising}
                    showRoman={script === 'roman'}
                  />
                </>
              )}
            </div>

            <footer className="flex flex-wrap items-center justify-between gap-2 border-t-[1.5px] border-ink bg-paper px-4 py-3 sm:px-5">
              <span className="text-[10px] leading-4 text-ink-faint">
                {script === 'roman'
                  ? 'The editor keeps the canonical lines; Roman is shown under each line.'
                  : 'Timing and edits are used by the preview, SRT, and burned video.'}
              </span>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={onClose} disabled={applying}>
                  Cancel
                </Button>
                {onApply ? (
                  <Button
                    size="sm"
                    icon={WandSparkles}
                    loading={applying}
                    disabled={applyDisabled || applying}
                    onClick={() => void onApply()}
                  >
                    {applyLabel}
                  </Button>
                ) : null}
              </div>
            </footer>
          </motion.section>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  )
}
