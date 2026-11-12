import type { CaptionStyle } from '../types/api'

export interface CaptionPreset {
  value: CaptionStyle
  label: string
  description: string
  kind: 'word' | 'line'
}

export const CAPTION_PRESETS: CaptionPreset[] = [
  { value: 'karaoke', label: 'Karaoke', description: 'Each word lights up as it lands.', kind: 'word' },
  { value: 'pop', label: 'Pop', description: 'Words arrive one by one with a spring.', kind: 'word' },
  { value: 'bounce', label: 'Bounce', description: 'The active word hops into place.', kind: 'word' },
  { value: 'highlight', label: 'Highlight', description: 'A bold marker accent on each word.', kind: 'word' },
  { value: 'neon', label: 'Neon', description: 'A glowing active word with a halo.', kind: 'word' },
  { value: 'spotlight', label: 'Spotlight', description: 'Dim the line, light the spoken word.', kind: 'word' },
  { value: 'underline', label: 'Underline', description: 'A crisp accent under every word.', kind: 'word' },
  { value: 'pulse', label: 'Pulse', description: 'The active word breathes in place.', kind: 'word' },
  { value: 'wiggle', label: 'Wiggle', description: 'A playful wobble on the spoken word.', kind: 'word' },
  { value: 'rainbow', label: 'Rainbow', description: 'A bright colour cycle across the line.', kind: 'word' },
  { value: 'box', label: 'Box', description: 'A translucent marker block behind the active word.', kind: 'word' },
  { value: 'slide', label: 'Slide', description: 'Each caption line glides into frame.', kind: 'line' },
  { value: 'fade_up', label: 'Fade up', description: 'A soft rise with a paper-light fade.', kind: 'line' },
  { value: 'zoom_in', label: 'Zoom in', description: 'The line settles in from slightly back.', kind: 'line' },
  { value: 'stamp', label: 'Stamp', description: 'A punchy entrance with a little snap.', kind: 'line' },
  { value: 'tilt', label: 'Tilt', description: 'The whole line straightens as it appears.', kind: 'line' },
  { value: 'typewriter', label: 'Typewriter', description: 'Letters reveal in spoken rhythm.', kind: 'line' },
  { value: 'soft_blur', label: 'Soft blur', description: 'A focus-pull entrance for the whole line.', kind: 'line' },
  { value: 'minimal', label: 'Minimal', description: 'Clean, calm, and completely static.', kind: 'line' },
]

export const CAPTION_PRESET_BY_VALUE = new Map(
  CAPTION_PRESETS.map((preset) => [preset.value, preset]),
)

export const WORD_PRESETS = CAPTION_PRESETS.filter((preset) => preset.kind === 'word')
export const LINE_PRESETS = CAPTION_PRESETS.filter((preset) => preset.kind === 'line')
