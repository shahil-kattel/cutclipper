import { useRef, useState } from 'react'
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
  Sparkles,
  Zap,
} from 'lucide-react'
import type { CaptionSettings, Clip, Job } from '../types/api'
import { assetUrl, downloadAllUrl } from '../lib/api'
import { formatBytes, formatDuration, formatTimecode, pluralize, sourceName } from '../lib/utils'
import { Button, Pill } from './ui'
import { useToast } from '../hooks/useToast'
import { CaptionExportStudio } from './CaptionExportStudio'

interface ResultsStepProps {
  job: Job
  onNewProject: () => void
  onEditSettings: () => void
  onRestyle: (captions: CaptionSettings) => Promise<void>
}

export function ResultsStep({ job, onNewProject, onEditSettings, onRestyle }: ResultsStepProps) {
  const toast = useToast()
  const [editingCaptions, setEditingCaptions] = useState(false)
  const clips = [...job.clips].sort((a, b) => a.index - b.index)
  const totalSize = clips.reduce((sum, clip) => sum + clip.file_size, 0)
  const allUrl = downloadAllUrl(job)
  const captionMode = job.mode === 'captions'
  const primaryClip = clips[0]
  const primaryUrl = captionMode && primaryClip ? assetUrl(primaryClip.download_url) : allUrl

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
              Edit captions before export
            </Button>
          ) : null}
          <Button variant="ghost" size="sm" onClick={onEditSettings} icon={ArrowLeft}>
            {captionMode ? 'Edit caption lines' : 'Adjust cut settings'}
          </Button>
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

function ClipCard({
  clip,
  index,
  aspect,
  captionMode = false,
}: {
  clip: Clip
  index: number
  aspect: string
  captionMode?: boolean
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [playing, setPlaying] = useState(false)
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
          onEnded={() => setPlaying(false)}
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
              : 'opacity-0 group-hover:opacity-100'
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
        <a
          href={assetUrl(clip.download_url)}
          download={clip.filename}
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[9.5px] font-bold text-ink-soft transition hover:bg-mustard-soft hover:text-ink"
        >
          Download
          <ExternalLink className="h-2.5 w-2.5" aria-hidden="true" />
        </a>
      </div>
    </motion.article>
  )
}

function cnImageClass(playing: boolean): string {
  return `absolute inset-0 h-full w-full object-cover transition-all duration-500 ${
    playing ? 'scale-105 opacity-0' : 'scale-100 opacity-100 group-hover:scale-[1.035]'
  }`
}
