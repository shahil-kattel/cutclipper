export type SelectionMode = 'auto' | 'even'
export type AspectRatio = '9:16' | '1:1' | '4:5'
export type ReframeMode = 'smart' | 'center'
export type CaptionStyle =
  | 'karaoke'
  | 'pop'
  | 'bounce'
  | 'highlight'
  | 'neon'
  | 'slide'
  | 'typewriter'
  | 'minimal'
  | 'fade_up'
  | 'zoom_in'
  | 'stamp'
  | 'tilt'
  | 'spotlight'
  | 'underline'
  | 'pulse'
  | 'wiggle'
  | 'rainbow'
  | 'box'
  | 'soft_blur'
export type CaptionPosition = 'top' | 'middle' | 'bottom'
export type CaptionFontStyle = 'regular' | 'bold' | 'italic' | 'bold_italic'
export type CaptionTextCase = 'none' | 'uppercase' | 'lowercase'
export type TransitionStyle = 'fade' | 'zoom' | 'slide' | 'whip_pan'
export type CaptionFont = string
export type JobMode = 'clips' | 'captions'

export type JobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
export type JobStage =
  | 'queued'
  | 'fetching'
  | 'probing'
  | 'transcribing'
  | 'finding_highlights'
  | 'reframing'
  | 'captioning'
  | 'rendering'
  | 'packaging'
  | 'complete'
  | 'failed'
  | 'cancelled'

export interface CaptionSettings {
  enabled: boolean
  word_style: CaptionStyle | null
  line_style: CaptionStyle | null
  font: CaptionFont
  font_style: CaptionFontStyle
  font_size: number
  color: string
  highlight_color: string
  position: CaptionPosition
  outline_width: number
  shadow: number
  letter_spacing: number
  word_spacing: number
  text_case: CaptionTextCase
}

export interface TransitionSettings {
  enabled: boolean
  style: TransitionStyle
  duration: number
}

export interface ClipSettings {
  clip_count: number
  min_clip_seconds: number
  max_clip_seconds: number
  selection_mode: SelectionMode
  aspect_ratio: AspectRatio
  reframe_mode: ReframeMode
  captions: CaptionSettings
  transitions: TransitionSettings
}

export interface VideoMetadata {
  title: string
  duration: number
  thumbnail_url: string | null
  uploader: string | null
  source: string | null
  source_url: string
  webpage_url: string | null
  width: number | null
  height: number | null
  fps: number | null
  has_audio: boolean | null
}

export interface PreviewResponse extends VideoMetadata {
  normalized_url: string
  upload_id: string | null
}

export interface JobSource {
  url?: string
  uploadId?: string
}

export interface JobOptions {
  mode?: JobMode
  segments?: CaptionSegment[]
  language?: string | null
  quality?: TranscriptionQuality | null
  task?: TranscriptionTask
}

export interface CaptionSegment {
  start: number
  end: number
  text: string
}

export interface TranscriptWord {
  start: number
  end: number
  text: string
}

export interface TranscriptResponse {
  upload_id: string
  duration: number
  language: string | null
  language_probability: number | null
  segments: CaptionSegment[]
  words: TranscriptWord[]
  warnings: string[]
  cached: boolean
  translated?: boolean
}

export interface Clip {
  id: string
  index: number
  start: number
  end: number
  duration: number
  score: number
  width: number
  height: number
  file_size: number
  filename: string
  video_url: string
  download_url: string
  thumbnail_url: string
}

export interface Job {
  id: string
  status: JobStatus
  stage: JobStage
  stage_label: string
  progress: number
  message: string
  created_at: string
  updated_at: string
  video: VideoMetadata | null
  settings: ClipSettings
  mode: JobMode
  clips: Clip[]
  warnings: string[]
  error_code: string | null
  error_message: string | null
  retryable: boolean
  can_cancel: boolean
  download_all_url: string | null
  is_restyle: boolean
  restyled_from: string | null
}

export interface ApiErrorBody {
  error?: {
    code?: string
    message?: string
    retryable?: boolean
    details?: Record<string, unknown>
  }
}

export type AppStep = 'link' | 'caption' | 'settings' | 'processing' | 'results'
export type ToastTone = 'success' | 'error' | 'info'
export type TranscriptionQuality = 'fast' | 'balanced' | 'best' | 'maximum'
export type TranscriptionTask = 'transcribe' | 'translate'
