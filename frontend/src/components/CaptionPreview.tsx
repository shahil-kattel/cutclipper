import { useEffect, useRef, useState, type CSSProperties, type RefObject } from 'react'
import type { CaptionSegment, CaptionSettings, CaptionStyle, TranscriptWord } from '../types/api'
import {
  captionFontForText,
  captionFontOption,
  captionFontStack,
  captionFontStyle,
  captionFontWeight,
} from '../lib/captionFonts'
import { cn } from '../lib/utils'

const PREVIEW_WORDS: TranscriptWord[] = [
  { start: 0.18, end: 0.53, text: 'Make' },
  { start: 0.53, end: 0.92, text: 'every' },
  { start: 0.92, end: 1.35, text: 'frame' },
  { start: 1.35, end: 1.92, text: 'count.' },
  { start: 2.55, end: 2.9, text: 'Then' },
  { start: 2.9, end: 3.26, text: 'hit' },
  { start: 3.26, end: 3.78, text: 'export.' },
]

export const CAPTION_PREVIEW_LOOP_SECONDS = 4.03

interface CaptionPreviewProps {
  settings: CaptionSettings
  segments?: CaptionSegment[]
  /** Original-language lines burned above the translated line. */
  secondarySegments?: CaptionSegment[]
  words?: TranscriptWord[]
  time?: number
  loop?: boolean
  /** Freeze the loop clock while keeping the current frame visible. */
  paused?: boolean
  fontSize?: number
  className?: string
  stageRef?: RefObject<HTMLElement | null>
  /** When provided, the overlay reads the video clock directly so playback
   * never has to re-render the surrounding studio at frame rate. */
  video?: RefObject<HTMLVideoElement | null>
}

interface CaptionGroup {
  words: TranscriptWord[]
  start: number
  end: number
}

const RAINBOW = ['#FF6B8A', '#FFD166', '#7BD389', '#4CC9F0', '#B69CFF']
const GROUP_CLASS: Partial<Record<CaptionStyle, string>> = {
  slide: 'caption-group-slide',
  fade_up: 'caption-group-rise',
  zoom_in: 'caption-group-zoom',
  stamp: 'caption-group-stamp',
  tilt: 'caption-group-tilt',
  soft_blur: 'caption-group-blur',
  minimal: 'caption-group-minimal',
}

function transformCase(value: string, textCase: CaptionSettings['text_case']): string {
  if (textCase === 'uppercase') return value.toUpperCase()
  if (textCase === 'lowercase') return value.toLowerCase()
  return value
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase()
}

function groupWords(words: TranscriptWord[]): CaptionGroup[] {
  const groups: CaptionGroup[] = []
  let current: TranscriptWord[] = []
  const flush = () => {
    if (!current.length) return
    const first = current[0]
    const last = current[current.length - 1]
    if (first && last) groups.push({ words: current, start: first.start, end: last.end })
    current = []
  }
  for (const word of words) {
    const previous = current[current.length - 1]
    if (previous) {
      const gap = word.start - previous.end
      const sentence = /[.!?…।॥。！？]["'”’)\]]*$/.test(previous.text)
      if (
        gap > 0.72 ||
        sentence ||
        word.end - (current[0]?.start ?? word.start) > 6.4 ||
        current.length >= 9
      ) {
        flush()
      }
    }
    current.push(word)
  }
  flush()
  return groups
}

function timingWeight(text: string): number {
  let weight = 0
  for (const char of text) {
    if (/\s/.test(char)) weight += 0.35
    else if ('।॥,;:!?…'.includes(char)) weight += 1.4
    else if ('.!?'.includes(char)) weight += 1
    else if (char >= 'ऀ' && char <= 'ॿ') {
      if (char === '्') weight += 0.1
      else if (/\p{M}/u.test(char)) weight += 0.35
      else weight += 1
    } else if (/[\p{L}\p{N}]/u.test(char)) weight += 1
    else weight += 0.4
  }
  return Math.max(1, weight)
}

function splitEditedSegment(segment: CaptionSegment): TranscriptWord[] {
  const tokens = segment.text.split(/\s+/).filter(Boolean)
  if (!tokens.length) return []
  const weights = tokens.map(timingWeight)
  const total = weights.reduce((sum, value) => sum + value, 0)
  const duration = Math.max(0.2, segment.end - segment.start)
  let cursor = segment.start
  return tokens.map((token, index) => {
    const slice = (weights[index] ?? 1) / total
    const end = index === tokens.length - 1 ? segment.end : cursor + duration * slice
    const word = { start: cursor, end, text: token }
    cursor = end
    return word
  })
}

function resolveTimeline(
  time: number,
  segments: CaptionSegment[] | undefined,
  words: TranscriptWord[] | undefined,
): CaptionGroup | null {
  const sourceWords = words ?? []
  if (segments?.length) {
    const segment = segments.find((item) => time >= item.start - 0.02 && time < item.end)
    if (!segment) return null
    const timedWords = segment.words?.length
      ? segment.words
      : sourceWords.filter(
          (word) => word.end > segment.start + 0.01 && word.start < segment.end - 0.01,
        )
    const matchingWords = timedWords
    const editedTokens = segment.text.split(/\s+/).filter(Boolean)
    const textMatches =
      matchingWords.length > 0 &&
      normalizeText(matchingWords.map((word) => word.text).join(' ')) ===
        normalizeText(segment.text)
    // Keep the transcript's word timing while honouring the user's exact
    // text (for example a capitalization-only correction).
    const segmentWords = textMatches
      ? editedTokens.length === matchingWords.length
        ? matchingWords.map((word, index) => ({ ...word, text: editedTokens[index] ?? word.text }))
        : splitEditedSegment(segment)
      : splitEditedSegment(segment)
    if (!segmentWords.length) return null
    return { words: segmentWords, start: segment.start, end: segment.end }
  }
  if (!sourceWords.length) return null
  const groups = groupWords(sourceWords)
  for (let index = 0; index < groups.length; index += 1) {
    const group = groups[index]
    if (!group) continue
    const next = groups[index + 1]
    const visibleEnd = Math.min(group.end + 0.18, next ? next.start - 0.01 : group.end + 0.3)
    if (time >= group.start - 0.02 && time <= visibleEnd) return group
  }
  return null
}

function withAlpha(hex: string, alpha: number): string {
  const value = hex.replace('#', '')
  if (value.length !== 6) return hex
  const red = Number.parseInt(value.slice(0, 2), 16)
  const green = Number.parseInt(value.slice(2, 4), 16)
  const blue = Number.parseInt(value.slice(4, 6), 16)
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`
}

function usePreviewClock(active: boolean): number {
  const [clock, setClock] = useState(0)
  const clockRef = useRef(0)
  useEffect(() => {
    if (!active) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduced) {
      clockRef.current = 1.1
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setClock(1.1)
      return
    }
    let frame = 0
    // Resume from the frozen frame instead of restarting the sample.
    const started = performance.now() - clockRef.current * 1000
    const tick = (now: number) => {
      const next = ((now - started) / 1000) % CAPTION_PREVIEW_LOOP_SECONDS
      clockRef.current = next
      setClock(next)
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [active])
  return clock
}

function useWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const element = ref.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.contentRect.width)
    })
    observer.observe(element)
    setWidth(element.getBoundingClientRect().width)
    return () => observer.disconnect()
  }, [ref])
  return width
}

function useVideoClock(video: RefObject<HTMLVideoElement | null> | undefined): number {
  const [clock, setClock] = useState(0)
  useEffect(() => {
    if (!video) return
    let frame = 0
    let last = 0
    const tick = (now: number) => {
      if (now - last >= 50) {
        last = now
        const element = video.current
        if (element) setClock(element.currentTime)
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [video])
  return clock
}

export function CaptionPreview({
  settings,
  segments,
  secondarySegments,
  words,
  time,
  loop = false,
  paused = false,
  fontSize,
  className,
  stageRef,
  video,
}: CaptionPreviewProps) {
  const ownRef = useRef<HTMLDivElement>(null)
  const observedRef = stageRef ?? ownRef
  const width = useWidth(observedRef)
  const loopTime = usePreviewClock(loop && !paused)
  const videoTime = useVideoClock(video)
  const currentTime = loop ? loopTime : video ? videoTime : (time ?? 0)
  const timeline = loop ? undefined : segments
  const previewWords = loop ? PREVIEW_WORDS : words
  const group = loop
    ? resolveTimeline(currentTime, undefined, PREVIEW_WORDS)
    : resolveTimeline(currentTime, timeline, previewWords)
  const secondary =
    !loop && settings.secondary_enabled
      ? secondarySegments?.find(
          (segment) => currentTime >= segment.start - 0.02 && currentTime < segment.end,
        )
      : undefined

  // This layer sits on top of the video element. It must never intercept
  // pointer input, or the native controls and click-to-play stop working.
  const overlayClass = cn(className, 'pointer-events-none')

  if (!group && !secondary) {
    return <div ref={ownRef} className={overlayClass} aria-hidden="true" />
  }

  const font = captionFontOption(
    captionFontForText(settings.font, group?.words.map((word) => word.text).join(' ') ?? ''),
  )
  // Roman Nepali is Latin text, so it uses the main caption face. Devanagari
  // keeps the separate Nepali font the user picked.
  const secondaryFont = captionFontOption(
    settings.nepali_script === 'roman'
      ? captionFontForText(settings.font, secondary?.text ?? '')
      : (settings.secondary_font ?? 'Mukta'),
  )
  const resolvedFontSize =
    fontSize ??
    Math.max(12, Math.min(72, (settings.font_size / 1080) * Math.max(220, width || 320)))
  const scale = resolvedFontSize / Math.max(1, settings.font_size)
  const outline = settings.outline_width * scale
  const shadow = settings.shadow * scale
  const letterSpacing = settings.letter_spacing * scale
  const activeIndex = group
    ? group.words.reduce(
        (last, word, index) => (currentTime >= word.start - 0.0001 ? index : last),
        -1,
      )
    : -1
  const wordEffect = settings.word_style
  const lineEffect = settings.line_style
  const groupKey = [
    group ? `${group.start.toFixed(2)}-${group.end.toFixed(2)}` : 'no-group',
    secondary ? `${secondary.start.toFixed(2)}-${secondary.text}` : 'no-secondary',
    wordEffect ?? 'none',
    lineEffect ?? 'none',
  ].join('-')
  const groupClass = group && lineEffect ? GROUP_CLASS[lineEffect] : undefined
  const typewriter = lineEffect === 'typewriter'
  const wordGap = `calc(0.26em + ${(settings.word_spacing * scale).toFixed(2)}px)`

  const baseStyle: CSSProperties = {
    fontFamily: captionFontStack(font.name),
    fontWeight: captionFontWeight(settings.font_style),
    fontStyle: captionFontStyle(settings.font_style),
    fontSize: `${resolvedFontSize}px`,
    lineHeight: 1.12,
    color: settings.color,
    letterSpacing: `${letterSpacing}px`,
    textTransform:
      settings.text_case === 'uppercase'
        ? 'uppercase'
        : settings.text_case === 'lowercase'
          ? 'lowercase'
          : 'none',
    WebkitTextStroke: outline > 0 ? `${outline}px rgba(0,0,0,0.74)` : undefined,
    paintOrder: 'stroke fill',
    textShadow: shadow > 0 ? `0 ${shadow}px ${shadow * 1.5}px rgba(0,0,0,0.62)` : undefined,
  }
  const secondaryStyle: CSSProperties = {
    fontFamily: captionFontStack(secondaryFont.name),
    fontWeight: captionFontWeight(settings.font_style),
    fontStyle: captionFontStyle(settings.font_style),
    fontSize: `${resolvedFontSize * 0.8}px`,
    lineHeight: 1.12,
    color: settings.color,
    letterSpacing: `${letterSpacing}px`,
    marginBottom: '0.06em',
    WebkitTextStroke: outline > 0 ? `${outline * 0.8}px rgba(0,0,0,0.74)` : undefined,
    paintOrder: 'stroke fill',
    textShadow: shadow > 0 ? `0 ${shadow}px ${shadow * 1.5}px rgba(0,0,0,0.62)` : undefined,
  }
  const top = settings.position === 'top' ? '16.5%' : settings.position === 'middle' ? '49%' : '80%'
  // Match the ASS export anchors: top captions grow downward from the anchor,
  // bottom captions grow upward, and middle captions stay centered.
  const anchorY =
    settings.position === 'top' ? '0%' : settings.position === 'middle' ? '-50%' : '-100%'

  const wordCss = (wordIndex: number): CSSProperties => {
    const active = wordIndex === activeIndex
    const future = activeIndex >= 0 && wordIndex > activeIndex
    if (wordEffect === 'rainbow') {
      return {
        color: RAINBOW[wordIndex % RAINBOW.length],
        display: 'inline-block',
        opacity: future && !typewriter ? 0 : 1,
        transform: active ? 'scale(1.12)' : undefined,
        transition: 'transform 140ms ease-out',
      }
    }
    if (wordEffect === 'pop' && future && !typewriter) {
      return { display: 'inline-block', opacity: 0 }
    }
    if (!active || !wordEffect) {
      return {
        display: 'inline-block',
        opacity: wordEffect === 'spotlight' && !active ? 0.42 : undefined,
      }
    }
    if (wordEffect === 'box') {
      return {
        display: 'inline-block',
        backgroundColor: withAlpha(settings.highlight_color, 0.7),
        color: settings.color,
        padding: '0 0.08em',
        borderRadius: '0.06em',
      }
    }
    const shared: CSSProperties = { display: 'inline-block', color: settings.highlight_color }
    if (wordEffect === 'highlight') return { ...shared, transform: 'scale(1.07)' }
    if (wordEffect === 'neon') {
      return {
        ...shared,
        color: settings.color,
        textShadow: `0 0 ${Math.max(5, resolvedFontSize * 0.18)}px ${settings.highlight_color}, 0 0 ${Math.max(12, resolvedFontSize * 0.4)}px ${settings.highlight_color}`,
        WebkitTextStroke: `${Math.max(1, outline)}px ${settings.highlight_color}`,
      }
    }
    if (wordEffect === 'spotlight') return { ...shared, opacity: 1 }
    if (wordEffect === 'underline') {
      return {
        ...shared,
        textDecoration: 'underline',
        textDecorationThickness: '0.08em',
        textUnderlineOffset: '0.12em',
      }
    }
    if (wordEffect === 'pulse') return shared
    if (wordEffect === 'wiggle') return { ...shared, transform: 'rotate(-3deg) scale(1.06)' }
    if (wordEffect === 'pop') return { ...shared, transform: 'scale(1.16)' }
    if (wordEffect === 'bounce') {
      return { ...shared, transform: 'translateY(-0.06em) scale(1.1)' }
    }
    return shared
  }

  const visibleCharacterCount = (word: TranscriptWord): number => {
    if (!typewriter) return word.text.length
    const duration = Math.max(0.001, word.end - word.start)
    let visible = 0
    for (let charIndex = 0; charIndex < word.text.length; charIndex += 1) {
      const revealAt = word.start + duration * (charIndex / Math.max(1, word.text.length))
      if (revealAt <= currentTime + 0.0001) visible = charIndex + 1
    }
    return visible
  }

  return (
    <div ref={ownRef} className={overlayClass} aria-hidden="true">
      <div
        key={groupKey}
        className={`caption-preview-line ${groupClass ?? ''}`}
        style={
          {
            position: 'absolute',
            left: '50%',
            top,
            width: '86%',
            '--caption-anchor-y': anchorY,
            transform: 'translate(-50%, var(--caption-anchor-y))',
            textAlign: 'center',
          } as CSSProperties
        }
      >
        {secondary ? <div style={secondaryStyle}>{secondary.text}</div> : null}
        {group ? (
          <div style={baseStyle}>
            {group.words.map((word, wordIndex) => {
              const active = wordIndex === activeIndex
              const display = transformCase(word.text, settings.text_case)
              const visible = visibleCharacterCount(word)
              const shown = typewriter ? display.slice(0, visible) : display
              const hidden = typewriter ? display.slice(visible) : ''
              const activeClass =
                active && wordEffect === 'bounce'
                  ? 'caption-anim-bounce'
                  : active && wordEffect === 'pop'
                    ? 'caption-anim-pop'
                    : active && wordEffect === 'pulse'
                      ? 'caption-anim-pulse'
                      : active && wordEffect === 'wiggle'
                        ? 'caption-anim-wiggle'
                        : undefined
              return (
                <span
                  key={`${wordIndex}-${active ? activeIndex : 'rest'}-${word.start}`}
                  className={activeClass}
                  style={{
                    ...wordCss(wordIndex),
                    marginRight: wordIndex < group.words.length - 1 ? wordGap : 0,
                  }}
                >
                  {shown}
                  {hidden ? <span style={{ opacity: 0 }}>{hidden}</span> : null}
                </span>
              )
            })}
          </div>
        ) : null}
      </div>
    </div>
  )
}
