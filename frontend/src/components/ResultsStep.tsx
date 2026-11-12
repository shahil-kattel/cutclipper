import { useRef, useState } from 'react'
import { motion } from 'framer-motion'
import {
  ArrowLeft,
  Check,
  Download,
  ExternalLink,
  Info,
  Pause,
  Play,
  RotateCcw,
  Sparkles,
  Zap,
} from 'lucide-react'
import type { Clip, Job } from '../types/api'
import { assetUrl, downloadAllUrl } from '../lib/api'
import { formatBytes, formatDuration, formatTimecode, pluralize, sourceName } from '../lib/utils'
import { Button, Pill } from './ui'
import { useToast } from '../hooks/useToast'

interface ResultsStepProps {
  job: Job
  onNewProject: () => void
  onEditSettings: () => void
}

export function ResultsStep({ job, onNewProject, onEditSettings }: ResultsStepProps) {
  const toast = useToast()
  const clips = [...job.clips].sort((a, b) => a.index - b.index)
  const totalSize = clips.reduce((sum, clip) => sum + clip.file_size, 0)
  const allUrl = downloadAllUrl(job)

  const handleDownloadAll = () => {
    toast.success(`Preparing ${clips.length} ${pluralize(clips.length, 'clip')} as a ZIP.`)
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
          <h1 className="mt-4 font-display text-4xl font-semibold tracking-[-0.055em] text-white sm:text-5xl">
            Your clips <span className="text-gradient">are ready.</span>
          </h1>
          <p className="mt-3 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-sm text-slate-400">
            <span className="max-w-lg truncate">{job.video?.title ?? 'Your video'}</span>
            <span className="hidden h-3 w-px bg-white/10 sm:block" />
            <span className="text-slate-500">
              {clips.length} {pluralize(clips.length, 'clip')} ·{' '}
              {formatDuration(clips.reduce((sum, clip) => sum + clip.duration, 0))} total
            </span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <Button variant="ghost" size="sm" onClick={onEditSettings} icon={ArrowLeft}>
            Adjust settings
          </Button>
          <Button variant="secondary" size="sm" onClick={onNewProject} icon={RotateCcw}>
            New video
          </Button>
          <a
            href={allUrl}
            download="cutclipper-clips.zip"
            onClick={handleDownloadAll}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-[linear-gradient(110deg,#20c7e8_0%,#8161f6_50%,#f254cb_100%)] px-4 text-[13px] font-semibold text-white shadow-[0_12px_40px_-14px_rgba(100,120,255,0.85)] transition hover:brightness-110 active:translate-y-px"
          >
            <Download className="h-4 w-4" aria-hidden="true" />
            Download all
            <span className="rounded bg-black/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider">
              ZIP
            </span>
          </a>
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.08 }}
        className="mt-6 flex flex-wrap items-center gap-2.5 border-y border-white/[0.055] py-3 text-[11px] text-slate-500"
      >
        <span className="inline-flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-300" />
          H.264 + AAC · faststart
        </span>
        <span className="h-3 w-px bg-white/10" />
        <span>
          {job.settings.aspect_ratio} · {clips[0]?.width ?? 1080}×{clips[0]?.height ?? 1920}
        </span>
        <span className="h-3 w-px bg-white/10" />
        <span>{formatBytes(totalSize)} total</span>
        <span className="h-3 w-px bg-white/10" />
        <span>{sourceName(job.video?.source ?? null)}</span>
        <span className="ml-auto hidden items-center gap-1.5 sm:inline-flex">
          <span className="h-1.5 w-1.5 rounded-full bg-slate-500" />
          Hover any clip to preview
        </span>
      </motion.div>

      <div className="mt-7 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {clips.map((clip, index) => (
          <ClipCard key={clip.id} clip={clip} index={index} aspect={job.settings.aspect_ratio} />
        ))}
      </div>

      {job.warnings.length > 0 ? (
        <motion.details
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.35 }}
          className="group mt-7 rounded-xl border border-white/[0.065] bg-white/[0.02] px-4 py-3.5"
        >
          <summary className="flex cursor-pointer list-none items-center gap-2 text-[11px] font-medium text-slate-400 transition hover:text-slate-200">
            <Info className="h-3.5 w-3.5 text-cyan-300/70" aria-hidden="true" />
            {job.warnings.length} {pluralize(job.warnings.length, 'note')} about this render
            <span
              className="ml-auto text-slate-600 transition group-open:rotate-180"
              aria-hidden="true"
            >
              ▾
            </span>
          </summary>
          <ul className="mt-3 space-y-1.5 border-t border-white/[0.055] pt-3">
            {[...new Set(job.warnings)].map((warning) => (
              <li
                key={warning}
                className="flex items-start gap-2 text-[11px] leading-5 text-slate-500"
              >
                <span className="mt-[0.48rem] h-1 w-1 shrink-0 rounded-full bg-slate-600" />
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
        className="mt-8 flex flex-col items-start justify-between gap-3 border-t border-white/[0.055] pt-5 text-[11px] text-slate-600 sm:flex-row sm:items-center"
      >
        <p>Ready for TikTok, Reels, Shorts, and every other vertical surface.</p>
        <p className="inline-flex items-center gap-1.5">
          <Sparkles className="h-3 w-3 text-violet-300/60" aria-hidden="true" />
          No watermarks. No caps. Your clips, clean.
        </p>
      </motion.div>
    </div>
  )
}

function ClipCard({
  clip,
  index,
  aspect,
}: {
  clip: Clip
  index: number
  aspect: Job['settings']['aspect_ratio']
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [playing, setPlaying] = useState(false)
  const [thumbnailFailed, setThumbnailFailed] = useState(false)
  const toast = useToast()

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
      initial={{ opacity: 0, y: 20, scale: 0.985 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{
        duration: 0.45,
        delay: Math.min(0.04 * index, 0.3),
        ease: [0.22, 1, 0.36, 1],
      }}
      whileHover={{ y: -4 }}
      className="group relative"
    >
      <div
        className="relative overflow-hidden rounded-2xl border border-white/[0.075] bg-[#070b18] shadow-[0_30px_80px_-50px_rgba(0,0,0,0.95)] transition duration-300 group-hover:border-white/15 group-hover:shadow-[0_36px_90px_-45px_rgba(62,89,180,0.5)]"
        style={{ aspectRatio: aspect.replace(':', '/') }}
        onPointerEnter={(event) => {
          if (event.pointerType === 'mouse') startPlayback()
        }}
        onPointerLeave={(event) => {
          if (event.pointerType === 'mouse') stopPlayback()
        }}
      >
        {thumbnailFailed ? (
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_25%_20%,rgba(44,232,255,0.15),transparent_50%),radial-gradient(circle_at_80%_80%,rgba(255,79,216,0.13),transparent_45%),linear-gradient(160deg,#0a1228,#0c0a1d)]" />
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
          aria-label={`Preview of clip ${clip.index}`}
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
            <span className="inline-flex items-center gap-1 rounded-md border border-white/15 bg-black/45 px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.12em] text-white/85 backdrop-blur">
              <Zap className="h-2.5 w-2.5 text-cyan-300" aria-hidden="true" />
              Score {clip.score}
            </span>
            <span className="rounded-md border border-white/10 bg-black/40 px-2 py-1 text-[9px] font-semibold tabular-nums text-white/65 backdrop-blur">
              #{String(clip.index).padStart(2, '0')}
            </span>
          </div>
          <a
            href={assetUrl(clip.download_url)}
            download={clip.filename}
            onClick={() => toast.success(`Downloading clip ${clip.index}.`)}
            aria-label={`Download clip ${clip.index}`}
            className="pointer-events-auto flex h-8 w-8 items-center justify-center rounded-lg border border-white/15 bg-black/45 text-white/80 backdrop-blur transition hover:border-cyan-300/40 hover:bg-cyan-300/15 hover:text-white"
          >
            <Download className="h-3.5 w-3.5" aria-hidden="true" />
          </a>
        </div>

        <button
          type="button"
          onClick={togglePlayback}
          aria-label={playing ? `Pause clip ${clip.index}` : `Play clip ${clip.index}`}
          className={`absolute left-1/2 top-1/2 flex h-12 w-12 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-white/20 bg-black/45 text-white backdrop-blur-md transition duration-300 focus-visible:opacity-100 focus-visible:outline-2 ${
            playing
              ? 'pointer-events-none opacity-0 focus-visible:pointer-events-auto'
              : 'opacity-0 group-hover:opacity-100'
          }`}
        >
          {playing ? (
            <Pause className="h-4.5 w-4.5 fill-white/90" aria-hidden="true" />
          ) : (
            <Play className="ml-0.5 h-4.5 w-4.5 fill-white/90" aria-hidden="true" />
          )}
        </button>

        <div className="pointer-events-none absolute inset-x-0 bottom-0 p-3.5">
          <div className="flex items-end justify-between gap-2">
            <div>
              <p className="font-display text-[13px] font-medium text-white/90">
                Clip {String(clip.index).padStart(2, '0')}
              </p>
              <p className="mt-1 text-[9.5px] tabular-nums text-white/55">
                {formatTimecode(clip.start)} → {formatTimecode(clip.end)}
              </p>
            </div>
            <div className="text-right">
              <p className="rounded border border-white/10 bg-black/35 px-1.5 py-0.5 text-[9px] font-medium tabular-nums text-white/75 backdrop-blur">
                {formatDuration(clip.duration)}
              </p>
              <p className="mt-1 text-[8.5px] uppercase tracking-[0.12em] text-white/40">
                {formatBytes(clip.file_size)}
              </p>
            </div>
          </div>
        </div>

        <div className="pointer-events-none absolute inset-0 rounded-2xl ring-1 ring-inset ring-white/[0.06]" />
      </div>

      <div className="mt-2.5 flex items-center justify-between gap-2 px-0.5">
        <span className="text-[10px] text-slate-600">
          {clip.width}×{clip.height} · MP4
        </span>
        <a
          href={assetUrl(clip.download_url)}
          download={clip.filename}
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[10px] font-medium text-slate-500 transition hover:bg-white/[0.04] hover:text-slate-200"
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
