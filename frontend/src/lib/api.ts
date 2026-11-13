import type {
  ApiErrorBody,
  CaptionSegment,
  CaptionSettings,
  ClipSettings,
  Job,
  JobOptions,
  JobSource,
  PreviewResponse,
  TranscriptResponse,
  TranscriptionQuality,
  TranscriptionTask,
  TranslationResponse,
} from '../types/api'

const configuredBase = (import.meta.env.VITE_API_BASE as string | undefined)?.trim()
export const API_BASE = (configuredBase || '/api').replace(/\/+$/, '')

export class ApiError extends Error {
  code: string
  status: number
  retryable: boolean
  details?: Record<string, unknown>

  constructor(
    message: string,
    options: {
      code?: string
      status?: number
      retryable?: boolean
      details?: Record<string, unknown>
    } = {},
  ) {
    super(message)
    this.name = 'ApiError'
    this.code = options.code ?? 'request_failed'
    this.status = options.status ?? 0
    this.retryable = options.retryable ?? false
    this.details = options.details
  }
}

export function apiUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path
  return `${API_BASE}${path.startsWith('/') ? path : `/${path}`}`
}

/** Media URLs come back as /api/...; keep them relative for the Vite proxy,
 * or anchor them to the configured API origin in a split deployment. */
export function assetUrl(path: string): string {
  if (!path) return path
  if (/^https?:\/\//i.test(path)) return path
  if (!/^https?:\/\//i.test(API_BASE)) return path
  try {
    return new URL(path, new URL(API_BASE).origin).toString()
  } catch {
    return path
  }
}

async function request<T>(path: string, init: RequestInit = {}, timeoutMs = 30_000): Promise<T> {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(apiUrl(path), {
      ...init,
      headers: {
        Accept: 'application/json',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...init.headers,
      },
      signal: controller.signal,
    })
    const contentType = response.headers.get('content-type') || ''
    const payload = contentType.includes('application/json')
      ? await response.json().catch(() => null)
      : null
    if (!response.ok) {
      const body = payload as {
        error?: {
          code?: string
          message?: string
          retryable?: boolean
          details?: Record<string, unknown>
        }
      } | null
      throw new ApiError(body?.error?.message || `The server returned ${response.status}.`, {
        code: body?.error?.code,
        retryable: body?.error?.retryable,
        status: response.status,
        details: body?.error?.details,
      })
    }
    return payload as T
  } catch (error) {
    if (error instanceof ApiError) throw error
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new ApiError('The request took too long. Check your connection and try again.', {
        code: 'request_timeout',
        retryable: true,
      })
    }
    throw new ApiError(
      'Could not reach CutClipper. Make sure the backend is running and try again.',
      { code: 'network_error', retryable: true },
    )
  } finally {
    window.clearTimeout(timer)
  }
}

export async function previewVideo(url: string): Promise<PreviewResponse> {
  return request<PreviewResponse>(
    '/preview',
    {
      method: 'POST',
      body: JSON.stringify({ url }),
    },
    160_000,
  )
}

export async function createJob(
  source: JobSource,
  settings: ClipSettings,
  options: JobOptions = {},
): Promise<Job> {
  return request<Job>(
    '/jobs',
    {
      method: 'POST',
      body: JSON.stringify({
        url: source.url || undefined,
        upload_id: source.uploadId || undefined,
        settings,
        mode: options.mode || 'clips',
        language: options.language || undefined,
        quality: options.quality || undefined,
        task: options.task && options.task !== 'transcribe' ? options.task : undefined,
        segments: options.segments,
        secondary_segments: options.secondarySegments,
      }),
    },
    45_000,
  )
}

export async function restyleJob(jobId: string, captions: CaptionSettings): Promise<Job> {
  return request<Job>(
    `/jobs/${encodeURIComponent(jobId)}/restyle`,
    {
      method: 'POST',
      body: JSON.stringify({ captions }),
    },
    120_000,
  )
}

export async function transcribeCaptions(
  uploadId: string,
  language: string | null,
  force = false,
  quality?: TranscriptionQuality | null,
  task: TranscriptionTask = 'transcribe',
): Promise<TranscriptResponse> {
  return request<TranscriptResponse>(
    '/captions/transcribe',
    {
      method: 'POST',
      body: JSON.stringify({
        upload_id: uploadId,
        language: language && language !== 'auto' ? language : undefined,
        quality: quality || undefined,
        task,
        force,
      }),
    },
    60 * 60 * 1000,
  )
}

export async function translateCaptions(
  uploadId: string,
  segments: CaptionSegment[],
  quality: TranscriptionQuality | null,
  language: string,
): Promise<TranslationResponse> {
  return request<TranslationResponse>(
    '/captions/translate',
    {
      method: 'POST',
      body: JSON.stringify({
        upload_id: uploadId,
        segments,
        quality: quality || undefined,
        language,
      }),
    },
    60 * 60 * 1000,
  )
}

export function uploadVideoUrl(uploadId: string): string {
  return assetUrl(`/api/uploads/${encodeURIComponent(uploadId)}/video`)
}

export function uploadVideo(
  file: File,
  onProgress?: (fraction: number) => void,
): Promise<PreviewResponse> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', apiUrl('/uploads'))
    xhr.setRequestHeader('Accept', 'application/json')
    xhr.timeout = 30 * 60 * 1000
    xhr.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable && event.total > 0) {
        onProgress?.(Math.min(event.loaded / event.total, 1))
      }
    })
    xhr.addEventListener('load', () => {
      let payload: unknown
      try {
        payload = xhr.responseText ? JSON.parse(xhr.responseText) : null
      } catch {
        payload = null
      }
      if (xhr.status >= 200 && xhr.status < 300 && payload) {
        resolve(payload as PreviewResponse)
        return
      }
      const body = payload as ApiErrorBody | null
      reject(
        new ApiError(body?.error?.message || `The upload failed (${xhr.status}).`, {
          code: body?.error?.code,
          status: xhr.status,
          retryable: body?.error?.retryable,
          details: body?.error?.details,
        }),
      )
    })
    xhr.addEventListener('error', () => {
      reject(
        new ApiError(
          'Could not reach CutClipper. Make sure the backend is running and try again.',
          {
            code: 'network_error',
            retryable: true,
          },
        ),
      )
    })
    xhr.addEventListener('timeout', () => {
      reject(
        new ApiError('The upload took too long. Check your connection and try again.', {
          code: 'request_timeout',
          retryable: true,
        }),
      )
    })
    const form = new FormData()
    form.append('file', file, file.name)
    xhr.send(form)
  })
}

export async function getJob(jobId: string): Promise<Job> {
  return request<Job>(`/jobs/${encodeURIComponent(jobId)}`, {}, 20_000)
}

export async function cancelJob(jobId: string): Promise<Job> {
  return request<Job>(`/jobs/${encodeURIComponent(jobId)}/cancel`, { method: 'POST' }, 20_000)
}

export function jobEventsUrl(jobId: string): string {
  return apiUrl(`/jobs/${encodeURIComponent(jobId)}/events`)
}

export function downloadAllUrl(job: Job): string {
  return assetUrl(job.download_all_url || `/api/jobs/${job.id}/download.zip`)
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message
  if (error instanceof Error) return error.message
  return 'Something unexpected happened. Please try again.'
}

export function isRetryable(error: unknown): boolean {
  return error instanceof ApiError ? error.retryable : true
}
