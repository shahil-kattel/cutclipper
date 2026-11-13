import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { motion } from 'framer-motion'
import {
  ArrowLeft,
  Check,
  Download,
  ExternalLink,
  Info,
  Palette,
  Pause,
  Play,
  RotateCcw,
  SkipBack,
  SkipForward,
  Sparkles,
  Volume2,
  VolumeX,
  Zap,
} from 'lucide-react'
import type { CaptionSettings, Clip, Job } from '../types/api'
import { assetUrl, downloadAllUrl } from '../lib/api'
import {
  clamp,
  formatBytes,
  formatDuration,
  formatTimecode,
  pluralize,
  sourceName,
} from '../lib/utils'
import { Button, Pill } from './ui'
import { useToast } from '../hooks/useToast'
import { CaptionExportStudio } from './CaptionExportStudio'

interface ResultsStepProps {
  job: Job
  onNewProject: () => void
  onEditSettings: () => void
  onRestyle: (captions: CaptionSettings) => Promise<void>
  canEditSettings?: boolean
}

export function ResultsStep({
  job,
  onNewProject,
  onEditSettings,
  onRestyle,
  canEditSettings = true,
}: ResultsStepProps) {
  const toast = useToast()
  const [editingCaptions, setEditingCaptions] = useState(false)
  const [previewClipId, setPreviewClipId] = useState<string | null>(null)
  const previewRef = useRef<HTMLDivElement>(null)
  const clips = [...job.clips].sort((a, b) => a.index - b.index)
  const totalSize = clips.reduce((sum, clip) => sum + clip.file_size, 0)
  const allUrl = downloadAllUrl(job)
  const captionMode = job.mode === 'captions'
  const primaryClip = clips[0]
  const activePreviewClip = clips.find((clip) => clip.id === previewClipId) ?? primaryClip
  const primaryUrl = captionMode && primaryClip ? assetUrl(primaryClip.download_url) : allUrl

  const previewClip = (clip: Clip) => {
    setPreviewClipId(clip.id)
    previewRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const handleDownloadAll = () => {
    toast.success(
      captionMode
        ? 'Downloading your captioned video.'
        : `Preparing ${clips.length} ${pluralize(clips.length, 'clip')} as a ZIP.`,
    )
  }

  return (
    <div className="mx-auto max-w-7xl">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
        className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between"
      >
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Pill tone="success">
              <Check className="h-3 w-3" aria-hidden="true" />
              Export complete
            </Pill>
            <Pill tone="violet">
              <Sparkles className="h-3 w-3" aria-hidden="true" />
              Watermark-free
            </Pill>
          </div>
          <div className="mt-4 flex flex-wrap items-end gap-x-4">
            <h1 className="font-display text-4xl font-semibold tracking-[-0.055em] text-ink sm:text-[3.4rem]">
              {captionMode ? (
                <>
                  Your video <span className="text-gradient">is captioned.</span>
                </>
              ) : (
                <>
                  Your clips <span className="text-gradient">are ready.</span>
                </>
              )}
            </h1>
            <span className="mb-1.5 hidden -rotate-2 font-hand text-[19px] text-ink-soft sm:inline">
              fresh off the cutting mat
            </span>
          </div>
          <p className="mt-3 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12px] font-medium text-ink-soft">
            <span className="max-w-lg truncate">{job.video?.title ?? 'Your video'}</span>
            <span className="hidden h-3 border-l border-dashed border-ink/30 sm:block" />
            <span className="text-ink-soft">
              {captionMode
                ? `${formatDuration(primaryClip?.duration ?? 0)} · captions burned in`
                : `${clips.length} ${pluralize(clips.length, 'clip')} · ${formatDuration(
                    clips.reduce((sum, clip) => sum + clip.duration, 0),
                  )} total`}
            </span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          {!editingCaptions ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setEditingCaptions(true)}
              icon={Palette}
              aria-expanded={false}
            >
              {captionMode || job.settings.captions.enabled
                ? 'Edit captions before export'
                : 'Add subtitles'}
            </Button>
          ) : null}
          {canEditSettings ? (
            <Button variant="ghost" size="sm" onClick={onEditSettings} icon={ArrowLeft}>
              {captionMode ? 'Edit caption lines' : 'Adjust cut settings'}
            </Button>
          ) : null}
          <Button variant="secondary" size="sm" onClick={onNewProject} icon={RotateCcw}>
            New video
          </Button>
          <a
            href={primaryUrl}
            download={captionMode ? primaryClip?.filename : 'cutclipper-clips.zip'}
            onClick={handleDownloadAll}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border-[1.5px] border-ink bg-tomato px-4 text-[12.5px] font-semibold text-paper-soft shadow-[3px_4px_0_#211d19] transition hover:-translate-y-0.5 hover:bg-tomato-bright hover:shadow-[4px_5px_0_#211d19] active:translate-y-[3px] active:shadow-none"
          >
            <Download className="h-4 w-4" aria-hidden="true" />
            {captionMode ? 'Download video' : 'Download all'}
            {captionMode ? null : (
              <span className="rounded bg-black/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider">
                ZIP
              </span>
            )}
          </a>
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.08 }}
        className="mt-6 flex flex-wrap items-center gap-2.5 border-y border-dashed border-ink/25 py-3 text-[10px] font-semibold text-ink-soft"
      >
        <span className="inline-flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full border border-ink bg-teal" />
          H.264 + AAC · faststart
        </span>
        <span className="h-3 border-l border-dashed border-ink/30" />
        <span>
          {captionMode ? '' : `${job.settings.aspect_ratio} · `}
          {clips[0]?.width ?? 1080}×{clips[0]?.height ?? 1920}
        </span>
        <span className="h-3 border-l border-dashed border-ink/30" />
        <span>{formatBytes(totalSize)} total</span>
        <span className="h-3 border-l border-dashed border-ink/30" />
        <span>{sourceName(job.video?.source ?? null)}</span>
        <span className="ml-auto hidden items-center gap-1.5 sm:inline-flex">
          <span className="h-1.5 w-1.5 rounded-full bg-slate-500" />
          {captionMode ? 'Hover to preview the full video' : 'Hover any clip to preview'}
        </span>
      </motion.div>

      {activePreviewClip ? (
        <div ref={previewRef} className="scroll-mt-24">
          <ClipPreview
            key={activePreviewClip.id}
            clips={clips}
            activeClip={activePreviewClip}
            captionMode={captionMode}
            onSelect={setPreviewClipId}
          />
        </div>
      ) : null}

      {editingCaptions ? (
        <div className="mt-6">
          <CaptionExportStudio
            key={job.id}
            job={job}
            onApply={onRestyle}
            onClose={() => setEditingCaptions(false)}
          />
        </div>
      ) : null}

      <div
        className={
          captionMode
            ? 'mt-7 grid max-w-3xl grid-cols-1 gap-4'
            : 'mt-7 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'
        }
      >
        {clips.map((clip, index) => (
          <ClipCard
            key={clip.id}
            clip={clip}
            index={index}
            aspect={captionMode ? `${clip.width}:${clip.height}` : job.settings.aspect_ratio}
            captionMode={captionMode}
            onPreview={() => previewClip(clip)}
          />
        ))}
      </div>

      {job.warnings.length > 0 ? (
        <motion.details
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.35 }}
          className="group mt-7 rounded-xl border-[1.5px] border-ink bg-mustard-soft px-4 py-3.5 shadow-[2px_3px_0_#211d19]"
        >
          <summary className="flex cursor-pointer list-none items-center gap-2 text-[11px] font-semibold text-ink transition hover:text-tomato">
            <Info className="h-3.5 w-3.5 text-tomato" aria-hidden="true" />
            {job.warnings.length} {pluralize(job.warnings.length, 'note')} about this render
            <span
              className="ml-auto text-ink-soft transition group-open:rotate-180"
              aria-hidden="true"
            >
              ▾
            </span>
          </summary>
          <ul className="mt-3 space-y-1.5 border-t border-dashed border-ink/25 pt-3">
            {[...new Set(job.warnings)].map((warning) => (
              <li
                key={warning}
                className="flex items-start gap-2 text-[11px] leading-5 text-ink-soft"
              >
                <span className="mt-[0.48rem] h-1 w-1 shrink-0 rounded-full bg-ink/40" />
                {warning}
              </li>
            ))}
          </ul>
        </motion.details>
      ) : null}

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.45 }}
        className="mt-8 flex flex-col items-start justify-between gap-3 border-t border-dashed border-ink/25 pt-5 text-[10.5px] font-medium text-ink-soft sm:flex-row sm:items-center"
      >
        <p>
          {captionMode
            ? 'Captions are burned in and ready to post anywhere.'
            : 'Ready for TikTok, Reels, Shorts, and every other vertical surface.'}
        </p>
        <p className="inline-flex items-center gap-1.5">
          <Sparkles className="h-3 w-3 text-tomato" aria-hidden="true" />
          {captionMode
            ? 'Editable captions. Clean MP4. No watermark.'
            : 'No watermarks. No caps. Your clips, clean.'}
        </p>
      </motion.div>
    </div>
  )
}

function ClipPreview({
  clips,
  activeClip,
  captionMode,
  onSelect,
}: {
  clips: Clip[]
  activeClip: Clip
  captionMode: boolean
  onSelect: (clipId: string) => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [playing, setPlaying] = useState(false)
  const [muted, setMuted] = useState(false)
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(activeClip.duration || 0)
  const index = clips.findIndex((clip) => clip.id === activeClip.id)
  const length = duration || activeClip.duration || 0
  const title = captionMode
    ? 'Captioned video'
    : `Clip ${String(activeClip.index).padStart(2, '0')}`

  // Smooth playhead while the browser only fires timeupdate a few times a second.
  useEffect(() => {
    if (!playing) return
    let frame = 0
    const tick = () => {
      const video = videoRef.current
      if (video) setTime(video.currentTime)
      frame = window.requestAnimationFrame(tick)
    }
    frame = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(frame)
  }, [playing])

  const togglePlayback = () => {
    const video = videoRef.current
    if (!video) return
    if (!video.paused) {
      video.pause()
      setPlaying(false)
      return
    }
    if (video.ended || (length > 0 && video.currentTime >= length - 0.05)) {
      video.currentTime = 0
      setTime(0)
    }
    video.play().then(
      () => setPlaying(true),
      () => setPlaying(false),
    )
  }

  const seek = (value: number) => {
    const video = videoRef.current
    if (!video) return
    const next = clamp(value, 0, length)
    video.currentTime = next
    setTime(next)
  }

  const step = (offset: number) => {
    const next = clips[index + offset]
    if (next) onSelect(next.id)
  }

  const progress = length > 0 ? clamp((time / length) * 100, 0, 100) : 0

  return (
    <motion.section
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.14, ease: [0.22, 1, 0.36, 1] }}
      className="paper-card taped mt-6 p-2.5 sm:p-3.5"
      aria-label="Clip preview player"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 px-1 pb-2.5">
        <span className="inline-flex items-center gap-1.5 text-[9.5px] font-bold uppercase tracking-[0.16em] text-tomato">
          <span className="h-px w-4 bg-tomato" aria-hidden="true" />
          Preview · playhead
        </span>
        <span className="font-hand text-[15px] text-ink-soft">scrub, play, download</span>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
        <div className="mx-auto w-full max-w-[21rem] lg:mx-0">
          <div
            className="relative overflow-hidden rounded-[0.9rem] border-[1.5px] border-ink bg-[#070b18]"
            style={{ aspectRatio: `${activeClip.width} / ${activeClip.height}` }}
          >
            <video
              key={activeClip.id}
              ref={videoRef}
              src={assetUrl(activeClip.video_url)}
              poster={assetUrl(activeClip.thumbnail_url)}
              muted={muted}
              playsInline
              preload="metadata"
              className="h-full w-full object-cover"
              aria-label={`Preview of ${title.toLowerCase()}`}
              onClick={togglePlayback}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onEnded={() => {
                setPlaying(false)
                setTime(length)
              }}
              onTimeUpdate={(event) => setTime(event.currentTarget.currentTime)}
              onLoadedMetadata={(event) => {
                const loaded = event.currentTarget.duration
                if (Number.isFinite(loaded) && loaded > 0) setDuration(loaded)
              }}
            />
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/35 via-transparent to-black/85" />

            <div className="absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-3">
              <div className="flex items-center gap-1.5">
                {captionMode ? (
                  <span className="inline-flex items-center gap-1 rounded-md border-[1.5px] border-ink bg-periwinkle-soft px-2 py-1 text-[8.5px] font-bold uppercase tracking-[0.1em] text-ink shadow-[1px_1px_0_#211d19]">
                    <Sparkles className="h-2.5 w-2.5 text-periwinkle" aria-hidden="true" />
                    Captioned
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-md border-[1.5px] border-ink bg-mustard px-2 py-1 text-[8.5px] font-bold uppercase tracking-[0.1em] text-ink shadow-[1px_1px_0_#211d19]">
                    <Zap className="h-2.5 w-2.5 text-tomato" aria-hidden="true" />
                    Score {activeClip.score}
                  </span>
                )}
                <span className="rounded-md border-[1.5px] border-ink bg-paper-soft px-2 py-1 text-[8.5px] font-bold tabular-nums text-ink shadow-[1px_1px_0_#211d19]">
                  {captionMode ? 'FULL' : `#${String(activeClip.index).padStart(2, '0')}`}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setMuted((value) => !value)}
                aria-label={muted ? 'Unmute preview' : 'Mute preview'}
                aria-pressed={muted}
                className="pointer-events-auto flex h-8 w-8 items-center justify-center rounded-lg border-[1.5px] border-ink bg-paper-soft text-ink shadow-[1px_2px_0_#211d19] transition hover:-translate-y-px hover:bg-mustard-soft active:translate-y-px active:shadow-none"
              >
                {muted ? (
                  <VolumeX className="h-3.5 w-3.5" aria-hidden="true" />
                ) : (
                  <Volume2 className="h-3.5 w-3.5" aria-hidden="true" />
                )}
              </button>
            </div>

            <button
              type="button"
              onClick={togglePlayback}
              aria-label={playing ? `Pause ${title}` : `Play ${title}`}
              className={`absolute left-1/2 top-1/2 flex h-14 w-14 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-[1.5px] border-ink bg-paper-soft text-ink shadow-[2px_3px_0_#211d19] transition duration-300 focus-visible:opacity-100 ${
                playing ? 'pointer-events-none opacity-0' : 'opacity-100'
              }`}
            >
              {playing ? (
                <Pause className="h-5 w-5 fill-current" aria-hidden="true" />
              ) : (
                <Play className="ml-0.5 h-5 w-5 fill-current" aria-hidden="true" />
              )}
            </button>

            <div className="pointer-events-none absolute inset-x-0 bottom-0 p-3.5">
              <div className="flex items-end justify-between gap-2">
                <div>
                  <p className="font-display text-[14px] font-medium text-white/90">{title}</p>
                  <p className="mt-1 text-[9.5px] tabular-nums text-white/55">
                    {formatTimecode(activeClip.start)} → {formatTimecode(activeClip.end)}
                  </p>
                </div>
                <div className="text-right">
                  <p className="rounded border border-ink bg-paper-soft px-1.5 py-0.5 text-[8.5px] font-bold tabular-nums text-ink shadow-[1px_1px_0_#211d19]">
                    {formatDuration(activeClip.duration)}
                  </p>
                  <p className="mt-1 text-[8.5px] uppercase tracking-[0.12em] text-white/40">
                    {formatBytes(activeClip.file_size)}
                  </p>
                </div>
              </div>
            </div>

            <div className="pointer-events-none absolute inset-0 rounded-[0.9rem] ring-1 ring-inset ring-white/10" />
          </div>

          <div className="mt-2.5 rounded-xl border-[1.5px] border-ink bg-paper-soft px-3 pb-2 pt-2.5 shadow-[2px_3px_0_#211d19]">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => step(-1)}
                disabled={index <= 0}
                aria-label="Previous clip"
                className="flex h-9 w-9 items-center justify-center rounded-lg border-[1.5px] border-ink bg-paper text-ink shadow-[1px_2px_0_#211d19] transition hover:-translate-y-px hover:bg-mustard-soft active:translate-y-px active:shadow-none disabled:cursor-not-allowed disabled:border-ink/15 disabled:bg-paper-deep disabled:text-ink-faint disabled:shadow-none"
              >
                <SkipBack className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={togglePlayback}
                aria-label={playing ? `Pause ${title}` : `Play ${title}`}
                className="flex h-10 w-10 items-center justify-center rounded-lg border-[1.5px] border-ink bg-tomato text-paper-soft shadow-[2px_2px_0_#211d19] transition hover:-translate-y-px hover:bg-tomato-bright active:translate-y-px active:shadow-none"
              >
                {playing ? (
                  <Pause className="h-4 w-4 fill-current" aria-hidden="true" />
                ) : (
                  <Play className="ml-0.5 h-4 w-4 fill-current" aria-hidden="true" />
                )}
              </button>
              <button
                type="button"
                onClick={() => step(1)}
                disabled={index >= clips.length - 1}
                aria-label="Next clip"
                className="flex h-9 w-9 items-center justify-center rounded-lg border-[1.5px] border-ink bg-paper text-ink shadow-[1px_2px_0_#211d19] transition hover:-translate-y-px hover:bg-mustard-soft active:translate-y-px active:shadow-none disabled:cursor-not-allowed disabled:border-ink/15 disabled:bg-paper-deep disabled:text-ink-faint disabled:shadow-none"
              >
                <SkipForward className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
              <span className="ml-auto font-display text-[12px] font-semibold tabular-nums text-ink">
                {formatTimecode(time)}
                <span className="text-ink-soft"> / {formatTimecode(length)}</span>
              </span>
            </div>
            <input
              type="range"
              className="range mt-1"
              min={0}
              max={Math.max(0.01, length)}
              step={0.01}
              value={Math.min(time, Math.max(0.01, length))}
              onChange={(event) => seek(Number(event.target.value))}
              style={
                {
                  '--range-progress': `${progress}%`,
                  '--accent': 'var(--tomato)',
                } as CSSProperties
              }
              aria-label="Preview playhead"
              aria-valuetext={`${formatTimecode(time)} of ${formatTimecode(length)}`}
            />
            <div className="flex items-center justify-between px-0.5 text-[8.5px] font-bold uppercase tracking-[0.14em] text-ink-soft">
              <span>Playhead</span>
              <span className="tabular-nums">
                {activeClip.width}×{activeClip.height} · MP4
              </span>
            </div>
          </div>
        </div>

        <div className="flex min-w-0 flex-col gap-3.5 lg:py-1">
          <div>
            <p className="text-[9.5px] font-bold uppercase tracking-[0.18em] text-ink-soft">
              Ready to watch
            </p>
            <h2 className="mt-1.5 font-display text-[1.65rem] font-semibold leading-tight tracking-[-0.04em] text-ink sm:text-[1.9rem]">
              {title} <span className="text-gradient">at a glance.</span>
            </h2>
            <p className="mt-2 max-w-xl text-[12px] leading-5 text-ink-soft">
              {captionMode
                ? 'Your captioned export plays here with a full playhead. Scrub anywhere, then download the clean MP4.'
                : 'Every clip fills the full vertical frame — no letterboxing, no blur padding. Drag the playhead to scrub, then download the cut you like.'}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <PreviewStat label="Clip length" value={formatDuration(activeClip.duration)} />
            <PreviewStat
              label="Source range"
              value={`${formatTimecode(activeClip.start)} → ${formatTimecode(activeClip.end)}`}
            />
            <PreviewStat label="File size" value={formatBytes(activeClip.file_size)} />
          </div>

          {clips.length > 1 ? (
            <div>
              <p className="text-[8.5px] font-bold uppercase tracking-[0.16em] text-ink-soft">
                Switch clip
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {clips.map((clip) => {
                  const selected = clip.id === activeClip.id
                  return (
                    <button
                      key={clip.id}
                      type="button"
                      onClick={() => onSelect(clip.id)}
                      aria-pressed={selected}
                      className={`inline-flex items-center gap-1.5 rounded-lg border-[1.5px] px-2.5 py-1.5 text-[10px] font-bold tabular-nums transition ${
                        selected
                          ? 'border-ink bg-mustard text-ink shadow-[1px_2px_0_#211d19]'
                          : 'border-ink/25 bg-paper text-ink-soft hover:-translate-y-0.5 hover:border-ink hover:bg-mustard-soft/50'
                      }`}
                    >
                      #{String(clip.index).padStart(2, '0')}
                      <span className={selected ? 'text-ink/60' : 'text-ink-soft/70'}>
                        {formatDuration(clip.duration)}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          ) : null}

          <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
            <a
              href={assetUrl(activeClip.download_url)}
              download={activeClip.filename}
              className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border-[1.5px] border-ink bg-tomato px-3.5 text-[11.5px] font-semibold text-paper-soft shadow-[2px_3px_0_#211d19] transition hover:-translate-y-0.5 hover:bg-tomato-bright active:translate-y-[2px] active:shadow-none"
            >
              <Download className="h-3.5 w-3.5" aria-hidden="true" />
              Download this clip
            </a>
            <a
              href={assetUrl(activeClip.video_url)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border-[1.5px] border-ink bg-paper px-3 text-[11.5px] font-semibold text-ink shadow-[1px_2px_0_#211d19] transition hover:-translate-y-0.5 hover:bg-mustard-soft active:translate-y-[2px] active:shadow-none"
            >
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              Open MP4
            </a>
          </div>
        </div>
      </div>
    </motion.section>
  )
}

function PreviewStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-dashed border-ink/25 bg-paper px-2.5 py-2">
      <p className="text-[8px] font-bold uppercase tracking-[0.14em] text-ink-soft">{label}</p>
      <p className="mt-1 truncate font-display text-[12px] font-semibold tabular-nums text-ink">
        {value}
      </p>
    </div>
  )
}

function ClipCard({
  clip,
  index,
  aspect,
  captionMode = false,
  onPreview,
}: {
  clip: Clip
  index: number
  aspect: string
  captionMode?: boolean
  onPreview: () => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [playing, setPlaying] = useState(false)
  const [progress, setProgress] = useState(0)
  const [thumbnailFailed, setThumbnailFailed] = useState(false)
  const toast = useToast()
  const tilt = captionMode ? -0.35 : [-0.7, 0.45, -0.3, 0.6][index % 4] || 0

  const startPlayback = () => {
    const video = videoRef.current
    if (!video) return
    video.play().then(
      () => setPlaying(true),
      () => setPlaying(false),
    )
  }

  const stopPlayback = () => {
    const video = videoRef.current
    if (!video) return
    video.pause()
    video.currentTime = 0
    setPlaying(false)
    setProgress(0)
  }

  const togglePlayback = () => {
    if (playing) stopPlayback()
    else startPlayback()
  }

  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 20, scale: 0.985, rotate: tilt }}
      animate={{ opacity: 1, y: 0, scale: 1, rotate: tilt }}
      transition={{
        duration: 0.45,
        delay: Math.min(0.04 * index, 0.3),
        ease: [0.22, 1, 0.36, 1],
      }}
      whileHover={{ y: -4, rotate: 0 }}
      className="group relative rounded-[1.15rem] border-[1.5px] border-ink bg-paper-soft p-2 shadow-[4px_5px_0_#211d19] transition-shadow duration-300 hover:shadow-[5px_7px_0_#211d19]"
    >
      <div
        className="relative overflow-hidden rounded-[0.78rem] border-[1.5px] border-ink bg-[#070b18]"
        style={{ aspectRatio: aspect.replace(':', '/') }}
        onPointerEnter={(event) => {
          if (event.pointerType === 'mouse') startPlayback()
        }}
        onPointerLeave={(event) => {
          if (event.pointerType === 'mouse') stopPlayback()
        }}
      >
        {thumbnailFailed ? (
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_25%_20%,rgba(242,190,79,0.26),transparent_50%),radial-gradient(circle_at_80%_80%,rgba(80,91,166,0.22),transparent_45%),linear-gradient(160deg,#2c2822,#1f1b16)]" />
        ) : (
          <img
            src={assetUrl(clip.thumbnail_url)}
            alt=""
            className={cnImageClass(playing)}
            loading="lazy"
            onError={() => setThumbnailFailed(true)}
          />
        )}
        <video
          ref={videoRef}
          src={assetUrl(clip.video_url)}
          poster={thumbnailFailed ? undefined : assetUrl(clip.thumbnail_url)}
          muted
          loop
          playsInline
          preload="metadata"
          aria-label={
            captionMode ? 'Preview of the captioned video' : `Preview of clip ${clip.index}`
          }
          className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-300 ${
            playing ? 'opacity-100' : 'opacity-0'
          }`}
          onClick={togglePlayback}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onTimeUpdate={(event) => {
            const video = event.currentTarget
            setProgress(
              video.duration > 0 ? clamp((video.currentTime / video.duration) * 100, 0, 100) : 0,
            )
          }}
          onEnded={() => {
            setPlaying(false)
            setProgress(0)
          }}
        />
        {playing ? (
          <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-[3px] bg-black/30">
            <div
              className="h-full rounded-r-full bg-mustard"
              style={{ width: `${progress}%` }}
              aria-hidden="true"
            />
          </div>
        ) : null}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/35 via-transparent to-black/85" />

        <div className="absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-3">
          <div className="flex items-center gap-1.5">
            {captionMode ? (
              <span className="inline-flex items-center gap-1 rounded-md border-[1.5px] border-ink bg-periwinkle-soft px-2 py-1 text-[8.5px] font-bold uppercase tracking-[0.1em] text-ink shadow-[1px_1px_0_#211d19]">
                <Sparkles className="h-2.5 w-2.5 text-periwinkle" aria-hidden="true" />
                Captioned
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-md border-[1.5px] border-ink bg-mustard px-2 py-1 text-[8.5px] font-bold uppercase tracking-[0.1em] text-ink shadow-[1px_1px_0_#211d19]">
                <Zap className="h-2.5 w-2.5 text-tomato" aria-hidden="true" />
                Score {clip.score}
              </span>
            )}
            <span className="rounded-md border-[1.5px] border-ink bg-paper-soft px-2 py-1 text-[8.5px] font-bold tabular-nums text-ink shadow-[1px_1px_0_#211d19]">
              {captionMode ? 'FULL' : `#${String(clip.index).padStart(2, '0')}`}
            </span>
          </div>
          <a
            href={assetUrl(clip.download_url)}
            download={clip.filename}
            onClick={() =>
              toast.success(
                captionMode
                  ? 'Downloading the captioned video.'
                  : `Downloading clip ${clip.index}.`,
              )
            }
            aria-label={captionMode ? 'Download captioned video' : `Download clip ${clip.index}`}
            className="pointer-events-auto flex h-8 w-8 items-center justify-center rounded-lg border-[1.5px] border-ink bg-paper-soft text-ink shadow-[1px_2px_0_#211d19] transition hover:-translate-y-px hover:bg-tomato hover:text-paper-soft active:translate-y-px active:shadow-none"
          >
            <Download className="h-3.5 w-3.5" aria-hidden="true" />
          </a>
        </div>

        <button
          type="button"
          onClick={togglePlayback}
          aria-label={
            captionMode
              ? playing
                ? 'Pause captioned video'
                : 'Play captioned video'
              : playing
                ? `Pause clip ${clip.index}`
                : `Play clip ${clip.index}`
          }
          className={`absolute left-1/2 top-1/2 flex h-12 w-12 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-[1.5px] border-ink bg-paper-soft text-ink shadow-[2px_2px_0_#211d19] transition duration-300 focus-visible:opacity-100 focus-visible:outline-2 ${
            playing
              ? 'pointer-events-none opacity-0 focus-visible:pointer-events-auto'
              : 'opacity-100 sm:opacity-0 sm:group-hover:opacity-100'
          }`}
        >
          {playing ? (
            <Pause className="h-4.5 w-4.5 fill-current" aria-hidden="true" />
          ) : (
            <Play className="ml-0.5 h-4.5 w-4.5 fill-current" aria-hidden="true" />
          )}
        </button>

        <div className="pointer-events-none absolute inset-x-0 bottom-0 p-3.5">
          <div className="flex items-end justify-between gap-2">
            <div>
              <p className="font-display text-[13px] font-medium text-white/90">
                {captionMode ? 'Captioned video' : `Clip ${String(clip.index).padStart(2, '0')}`}
              </p>
              <p className="mt-1 text-[9.5px] tabular-nums text-white/55">
                {formatTimecode(clip.start)} → {formatTimecode(clip.end)}
              </p>
            </div>
            <div className="text-right">
              <p className="rounded border border-ink bg-paper-soft px-1.5 py-0.5 text-[8.5px] font-bold tabular-nums text-ink shadow-[1px_1px_0_#211d19]">
                {formatDuration(clip.duration)}
              </p>
              <p className="mt-1 text-[8.5px] uppercase tracking-[0.12em] text-white/40">
                {formatBytes(clip.file_size)}
              </p>
            </div>
          </div>
        </div>

        <div className="pointer-events-none absolute inset-0 rounded-[0.78rem] ring-1 ring-inset ring-white/10" />
      </div>

      <div className="mt-2 flex items-center justify-between gap-2 border-t border-dashed border-ink/20 px-1 pt-2">
        <span className="text-[9px] font-semibold text-ink-soft">
          {clip.width}×{clip.height} · MP4
        </span>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={onPreview}
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[9.5px] font-bold text-ink-soft transition hover:bg-periwinkle-soft hover:text-ink"
          >
            <Play className="h-2.5 w-2.5 fill-current" aria-hidden="true" />
            Preview
          </button>
          <a
            href={assetUrl(clip.download_url)}
            download={clip.filename}
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[9.5px] font-bold text-ink-soft transition hover:bg-mustard-soft hover:text-ink"
          >
            Download
            <ExternalLink className="h-2.5 w-2.5" aria-hidden="true" />
          </a>
        </div>
      </div>
    </motion.article>
  )
}

function cnImageClass(playing: boolean): string {
  return `absolute inset-0 h-full w-full object-cover transition-all duration-500 ${
    playing ? 'scale-105 opacity-0' : 'scale-100 opacity-100 group-hover:scale-[1.035]'
  }`
}
