import type { ClipSettings } from '../types/api'

export function cn(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ')
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const rounded = Math.round(seconds)
  const hours = Math.floor(rounded / 3600)
  const minutes = Math.floor((rounded % 3600) / 60)
  const secs = rounded % 60
  if (hours > 0)
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
  return `${minutes}:${String(secs).padStart(2, '0')}`
}

export function formatDurationLong(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)} seconds`
  const minutes = Math.floor(seconds / 60)
  const secs = Math.round(seconds % 60)
  if (minutes < 60) return secs ? `${minutes}m ${secs}s` : `${minutes} minutes`
  const hours = Math.floor(minutes / 60)
  const rem = minutes % 60
  return rem ? `${hours}h ${rem}m` : `${hours} hours`
}

export function formatBytes(bytes: number): string {
  if (!bytes || bytes < 0) return '0 MB'
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function formatTimecode(seconds: number): string {
  const minutes = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  const tenths = Math.floor((seconds - Math.floor(seconds)) * 10)
  return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${tenths}`
}

export const DEFAULT_SETTINGS: ClipSettings = {
  clip_count: 5,
  min_clip_seconds: 15,
  max_clip_seconds: 60,
  selection_mode: 'auto',
  aspect_ratio: '9:16',
  resolution: '1080p',
  export_quality: 'high',
  reframe_mode: 'smart',
  captions: {
    enabled: true,
    word_style: 'karaoke',
    line_style: null,
    font: 'Inter',
    font_style: 'bold',
    font_size: 80,
    color: '#FFFFFF',
    highlight_color: '#22D3EE',
    position: 'bottom',
    outline_width: 3,
    shadow: 2,
    letter_spacing: 0,
    word_spacing: 0,
    text_case: 'none',
    nepali_script: 'devanagari',
    secondary_enabled: true,
    secondary_font: 'Mukta',
  },
  transitions: {
    enabled: true,
    style: 'fade',
    duration: 0.4,
  },
}

export const ASPECT_LABELS: Record<ClipSettings['aspect_ratio'], string> = {
  '9:16': 'Vertical',
  '1:1': 'Square',
  '4:5': 'Portrait',
}

export function aspectCss(aspect: ClipSettings['aspect_ratio']): string {
  return aspect.replace(':', ' / ')
}

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return count === 1 ? singular : plural
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function sourceName(source: string | null): string {
  if (!source) return 'Video link'
  const normalized = source.toLowerCase()
  const labels: Record<string, string> = {
    youtube: 'YouTube',
    yt: 'YouTube',
    vimeo: 'Vimeo',
    twitter: 'X',
    x: 'X',
    tiktok: 'TikTok',
    twitch: 'Twitch',
    upload: 'Local file',
    generic: 'Direct video',
  }
  for (const [key, label] of Object.entries(labels)) {
    if (normalized.includes(key)) return label
  }
  return source.replace(/[_-]/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

export function validHexColor(value: string): string {
  return /^#[0-9a-fA-F]{6}$/.test(value) ? value.toUpperCase() : '#FFFFFF'
}
