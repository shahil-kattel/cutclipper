import type { Job } from '../types/api'

const STORAGE_KEY = 'cutclipper.active-job.v1'

interface StoredJob {
  id: string
  savedAt: string
}

/** Remember the server-side job so a closed tab can reconnect to it. */
export function storeActiveJob(job: Job): void {
  try {
    const payload: StoredJob = { id: job.id, savedAt: new Date().toISOString() }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
  } catch {
    // Private mode / blocked storage: rendering still runs server-side.
  }
}

export function readActiveJob(): StoredJob | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<StoredJob> | null
    if (!parsed || typeof parsed.id !== 'string' || !parsed.id) return null
    return { id: parsed.id, savedAt: typeof parsed.savedAt === 'string' ? parsed.savedAt : '' }
  } catch {
    return null
  }
}

export function clearActiveJob(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Ignore blocked storage.
  }
}
