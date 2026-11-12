export type SelectionMode = 'auto' | 'even'
export type AspectRatio = '9:16' | '1:1' | '4:5'
export type ReframeMode = 'smart' | 'center' | 'blur'
export type CaptionStyle = 'karaoke' | 'pop' | 'typewriter' | 'minimal'
export type CaptionPosition = 'top' | 'middle' | 'bottom'
export type TransitionStyle = 'fade' | 'zoom' | 'slide' | 'whip_pan'
export type CaptionFont = 'Inter' | 'Arial' | 'Georgia' | 'DejaVu Sans'

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
  style: CaptionStyle
  font: CaptionFont
  font_size: number
  color: string
  highlight_color: string
  position: CaptionPosition
  outline_width: number
  shadow: number
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
  clips: Clip[]
  warnings: string[]
  error_code: string | null
  error_message: string | null
  retryable: boolean
  can_cancel: boolean
  download_all_url: string | null
}

export interface ApiErrorBody {
  error?: {
    code?: string
    message?: string
    retryable?: boolean
    details?: Record<string, unknown>
  }
}

export type AppStep = 'link' | 'settings' | 'processing' | 'results'
export type ToastTone = 'success' | 'error' | 'info'
