import { useEffect, useState } from 'react'
import { Download, Pause, Play, Sparkles, X } from 'lucide-react'
import type { CaptionSettings, Job } from '../types/api'
import { assetUrl, downloadAllUrl, errorMessage } from '../lib/api'
import { cn, formatDuration } from '../lib/utils'
import { Button } from './ui'
import { CaptionPreview } from './CaptionPreview'
import { CaptionStyleControls, CaptionToggleRow } from './CaptionControls'

export function CaptionExportStudio({
  job,
  onApply,
  onClose,
}: {
  job: Job
  onApply: (captions: CaptionSettings) => Promise<void>
  onClose: () => void
}) {
  const [draft, setDraft] = useState<CaptionSettings>(() => structuredClone(job.settings.captions))
  const [playing, setPlaying] = useState(true)
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDraft(structuredClone(job.settings.captions))
    setError(null)
  }, [job.id, job.settings.captions])

  const captionMode = job.mode === 'captions'
  const primaryClip = job.clips[0]
  const aspect =
    captionMode && primaryClip
      ? `${primaryClip.width} / ${primaryClip.height}`
      : job.settings.aspect_ratio.replace(':', ' / ')
  const downloadHref =
    captionMode && primaryClip ? assetUrl(primaryClip.download_url) : downloadAllUrl(job)
  const changed = JSON.stringify(draft) !== JSON.stringify(job.settings.captions)

  const apply = async () => {
    if (applying) return
    setApplying(true)
    setError(null)
    try {
      await onApply(draft)
    } catch (err) {
      setError(errorMessage(err))
      setApplying(false)
    }
  }

  return (
    <section className="paper-card overflow-hidden" aria-label="Edit captions before export">
      <div className="flex flex-col gap-3 border-b-[1.5px] border-ink bg-paper px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div>
          <p className="flex items-center gap-2 text-[9px] font-bold uppercase tracking-[0.18em] text-tomato">
            <span className="h-px w-5 bg-tomato" aria-hidden="true" />
            Pre-export studio
          </p>
          <h2 className="mt-1 font-display text-2xl font-semibold tracking-[-0.035em] text-ink">
            Finish the captions before you download.
          </h2>
          <p className="mt-1 max-w-2xl text-[11.5px] leading-5 text-ink-soft">
            Same cuts, same words, fresh look. The motion preview is a live reference for the
            rendered export. Your current files stay downloadable while the new version renders.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close caption editor"
          className="flex h-8 w-8 shrink-0 items-center justify-center self-start rounded-lg border-[1.5px] border-ink bg-paper-soft text-ink shadow-[1px_2px_0_#211d19] transition hover:bg-tomato-soft sm:self-auto"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      <div className="grid gap-5 p-4 sm:p-5 lg:grid-cols-[minmax(16rem,0.78fr)_minmax(0,1.35fr)]">
        <div className="space-y-3 lg:sticky lg:top-[5.5rem] lg:self-start">
          <div className="paper-card taped taped-pink rotate-[-0.4deg] p-2.5 pb-2">
            <div className="mb-2 flex items-center justify-between px-0.5">
              <span className="flex items-center gap-1.5 text-[8.5px] font-bold uppercase tracking-[0.15em] text-ink-soft">
                <span className="h-1.5 w-1.5 rounded-full border border-ink bg-tomato" />
                Live motion reference
              </span>
              <button
                type="button"
                onClick={() => setPlaying((value) => !value)}
                className="flex h-6 items-center gap-1 rounded-md border border-ink bg-paper-soft px-1.5 text-[8.5px] font-bold text-ink shadow-[1px_1px_0_#211d19] transition hover:bg-mustard-soft"
              >
                {playing ? (
                  <Pause className="h-2.5 w-2.5 fill-current" aria-hidden="true" />
                ) : (
                  <Play className="h-2.5 w-2.5 fill-current" aria-hidden="true" />
                )}
                {playing ? 'Pause' : 'Play'}
              </button>
            </div>
            <div
              className="relative mx-auto max-h-[28rem] w-full max-w-[19rem] overflow-hidden rounded-[0.8rem] border-[1.5px] border-ink bg-[#171411]"
              style={{ aspectRatio: aspect }}
            >
              {job.video?.thumbnail_url ? (
                <img
                  src={assetUrl(job.video.thumbnail_url)}
                  alt=""
                  className="absolute inset-0 h-full w-full object-cover opacity-80"
                />
              ) : (
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(242,190,79,0.34),transparent_52%),radial-gradient(circle_at_78%_72%,rgba(110,121,200,0.28),transparent_48%),linear-gradient(160deg,#373026,#1d1915)]" />
              )}
              <div className="absolute inset-0 bg-gradient-to-b from-black/25 via-transparent to-black/60" />
              {draft.enabled ? (
                <CaptionPreview
                  settings={draft}
                  loop
                  paused={!playing}
                  className="absolute inset-0"
                />
              ) : null}
              <div className="absolute inset-x-0 top-0 flex items-center justify-between p-2.5">
                <span className="rounded-md border border-ink bg-mustard px-1.5 py-0.5 text-[7.5px] font-bold uppercase tracking-[0.1em] text-ink shadow-[1px_1px_0_#211d19]">
                  {captionMode ? 'Full video' : `${job.clips.length} clips`}
                </span>
                <span className="rounded-md border border-ink bg-paper-soft px-1.5 py-0.5 text-[7.5px] font-bold uppercase tracking-[0.1em] text-ink shadow-[1px_1px_0_#211d19]">
                  {playing ? 'Motion on' : 'Paused'}
                </span>
              </div>
              <div className="absolute inset-x-0 bottom-0 px-2.5 pb-2.5">
                <span className="rounded border border-ink bg-paper-soft px-1.5 py-0.5 text-[8px] font-bold tabular-nums text-ink shadow-[1px_1px_0_#211d19]">
                  {formatDuration(primaryClip?.duration ?? job.video?.duration ?? 0)} ·{' '}
                  {draft.font_style.replace('_', ' ')}
                </span>
              </div>
            </div>
          </div>
          <div className="flex items-start gap-2 rounded-lg border border-dashed border-ink/25 bg-mustard-soft/50 px-3 py-2.5 text-[9.5px] font-medium leading-4 text-ink-soft">
            <Sparkles className="mt-0.5 h-3 w-3 shrink-0 text-tomato" aria-hidden="true" />
            FFmpeg burns the same preset, font, size, spacing, casing, colors, outline, and shadow
            into the MP4.
          </div>
        </div>

        <div className="min-w-0 space-y-4">
          <CaptionToggleRow
            enabled={draft.enabled}
            onChange={(enabled) => setDraft((current) => ({ ...current, enabled }))}
            disabled={captionMode || job.video?.has_audio === false}
            note={
              captionMode
                ? 'Caption exports always keep captions on.'
                : job.video?.has_audio === false
                  ? 'This source has no audio track to caption.'
                  : 'Burn styled captions into this fresh export.'
            }
          />
          <div className={cn(!draft.enabled && 'pointer-events-none opacity-50')}>
            <CaptionStyleControls
              settings={draft}
              onChange={(patch) => setDraft((current) => ({ ...current, ...patch }))}
              compactPresets
            />
          </div>

          {error ? (
            <div
              role="alert"
              className="rounded-lg border-[1.5px] border-ink bg-tomato-soft px-3.5 py-2.5 text-[11.5px] font-medium leading-5 text-ink shadow-[2px_2px_0_#211d19]"
            >
              {error}
            </div>
          ) : null}

          <div className="flex flex-col gap-2.5 border-t border-dashed border-ink/25 pt-4 sm:flex-row sm:items-center sm:justify-between">
            <a
              href={downloadHref}
              download={captionMode ? primaryClip?.filename : 'cutclipper-clips.zip'}
              className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border-[1.5px] border-ink/30 bg-paper px-3 text-[11px] font-semibold text-ink-soft transition hover:border-ink hover:bg-mustard-soft hover:text-ink"
            >
              <Download className="h-3.5 w-3.5" aria-hidden="true" />
              Download current export
            </a>
            <Button
              onClick={apply}
              loading={applying}
              disabled={!changed || applying}
              icon={applying ? undefined : Sparkles}
              className="shrink-0"
            >
              {applying
                ? 'Starting fresh render'
                : captionMode
                  ? 'Apply & re-render video'
                  : `Apply & re-render ${job.clips.length} ${job.clips.length === 1 ? 'clip' : 'clips'}`}
            </Button>
          </div>
          {!changed ? (
            <p className="text-right text-[9.5px] text-ink-faint">
              Change a caption property to enable a fresh render.
            </p>
          ) : null}
        </div>
      </div>
    </section>
  )
}
