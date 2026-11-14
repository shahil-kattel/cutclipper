import type { CaptionSegment, NepaliScript } from '../types/api'

const STORAGE_KEY = 'cutclipper.caption-drafts.v1'

export interface CaptionDraft {
  segments: CaptionSegment[]
  romanSegments: CaptionSegment[] | null
  romanEdited: boolean
  script: NepaliScript
  updatedAt: string
}

interface DraftStore {
  [key: string]: CaptionDraft
}

function readStore(): DraftStore {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    return parsed && typeof parsed === 'object' ? (parsed as DraftStore) : {}
  } catch {
    return {}
  }
}

function isSegment(value: unknown): value is CaptionSegment {
  if (!value || typeof value !== 'object') return false
  const segment = value as Partial<CaptionSegment>
  return (
    typeof segment.start === 'number' &&
    typeof segment.end === 'number' &&
    typeof segment.text === 'string' &&
    segment.text.length > 0 &&
    segment.end > segment.start
  )
}

/** Read the last instant-saved caption edits for an upload or rendered job. */
export function readCaptionDraft(key: string | null): CaptionDraft | null {
  if (!key) return null
  const draft = readStore()[key]
  if (!draft || !Array.isArray(draft.segments) || !draft.segments.every(isSegment)) {
    return null
  }
  return {
    segments: draft.segments,
    romanSegments: Array.isArray(draft.romanSegments)
      ? draft.romanSegments.filter(isSegment)
      : null,
    romanEdited: draft.romanEdited === true,
    script: draft.script === 'roman' ? 'roman' : 'devanagari',
    updatedAt: typeof draft.updatedAt === 'string' ? draft.updatedAt : '',
  }
}

/** Persist caption edits immediately so a reload or page change keeps them. */
export function writeCaptionDraft(
  key: string | null,
  draft: Omit<CaptionDraft, 'updatedAt'>,
): void {
  if (!key) return
  try {
    const store = readStore()
    store[key] = { ...draft, updatedAt: new Date().toISOString() }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
  } catch {
    // Private mode / blocked storage: the in-memory editor still works.
  }
}

export function clearCaptionDraft(key: string | null): void {
  if (!key) return
  try {
    const store = readStore()
    delete store[key]
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
  } catch {
    // Ignore blocked storage.
  }
}
