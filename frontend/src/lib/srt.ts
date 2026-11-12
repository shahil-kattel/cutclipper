import type { CaptionSegment } from '../types/api'

function srtTimestamp(seconds: number): string {
  const totalMillis = Math.max(0, Math.round(seconds * 1000))
  const millis = totalMillis % 1000
  const totalSeconds = Math.floor(totalMillis / 1000)
  const secs = totalSeconds % 60
  const minutes = Math.floor(totalSeconds / 60) % 60
  const hours = Math.floor(totalSeconds / 3600)
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(
    secs,
  ).padStart(2, '0')},${String(millis).padStart(3, '0')}`
}

export function buildSrt(segments: CaptionSegment[]): string {
  return segments
    .filter((segment) => segment.text.trim() && segment.end > segment.start)
    .map(
      (segment, index) =>
        `${index + 1}\n${srtTimestamp(segment.start)} --> ${srtTimestamp(
          segment.end,
        )}\n${segment.text.trim()}\n`,
    )
    .join('\n')
}

/** Save the edited caption lines as a standard SRT sidecar file. */
export function downloadSrt(segments: CaptionSegment[], filename: string): void {
  const blob = new Blob([buildSrt(segments)], { type: 'application/x-subrip;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename.endsWith('.srt') ? filename : `${filename}.srt`
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
