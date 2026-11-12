import { useCallback, useEffect, useState } from 'react'
import type { Job } from '../types/api'
import { getJob, jobEventsUrl } from '../lib/api'

export type StreamConnection = 'idle' | 'connecting' | 'live' | 'polling' | 'offline'

interface StreamState {
  jobId: string | null
  job: Job | null
}

const TERMINAL = new Set(['completed', 'failed', 'cancelled'])

export function useJobStream(jobId: string | null, enabled: boolean) {
  const [state, setState] = useState<StreamState>({ jobId: null, job: null })
  const [connection, setConnection] = useState<StreamConnection>('idle')

  const applyJob = useCallback((nextJob: Job) => {
    setState({ jobId: nextJob.id, job: nextJob })
  }, [])

  useEffect(() => {
    if (!jobId || !enabled) {
      return
    }

    let disposed = false
    let source: EventSource | null = null
    let polling = false
    let finished = false
    let pollTimer: number | null = null
    let failures = 0

    // The stream status intentionally resets when a new job subscription starts.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setConnection('connecting')

    const stop = () => {
      if (source) {
        source.close()
        source = null
      }
      if (pollTimer !== null) {
        window.clearTimeout(pollTimer)
        pollTimer = null
      }
    }

    const finish = () => {
      finished = true
      if (source) {
        source.close()
        source = null
      }
      setConnection('idle')
      if (pollTimer !== null) {
        window.clearTimeout(pollTimer)
        pollTimer = null
      }
    }

    const schedulePoll = (delay: number) => {
      if (disposed || finished || pollTimer !== null) return
      pollTimer = window.setTimeout(() => {
        pollTimer = null
        void poll()
      }, delay)
    }

    const handleJob = (incoming: Job) => {
      if (disposed) return
      applyJob(incoming)
      if (TERMINAL.has(incoming.status)) finish()
    }

    const poll = async () => {
      if (disposed || polling) return
      polling = true
      try {
        const latest = await getJob(jobId)
        if (disposed) return
        failures = 0
        setConnection('polling')
        applyJob(latest)
        if (TERMINAL.has(latest.status)) {
          stop()
          return
        }
      } catch {
        failures += 1
        if (failures >= 2) setConnection('offline')
      } finally {
        polling = false
      }
      if (!disposed && !finished) schedulePoll(1400)
    }

    const startPolling = () => {
      if (disposed || finished) return
      setConnection('polling')
      schedulePoll(400)
    }

    try {
      source = new EventSource(jobEventsUrl(jobId))
      source.onopen = () => {
        if (!disposed) setConnection('live')
      }
      source.onmessage = (event) => {
        try {
          const incoming = JSON.parse(event.data) as Job
          setConnection('live')
          handleJob(incoming)
        } catch {
          // Malformed frames are ignored; polling is started if the stream dies.
        }
      }
      source.onerror = () => {
        if (disposed) return
        if (source) {
          source.close()
          source = null
        }
        startPolling()
      }
    } catch {
      startPolling()
    }

    return () => {
      disposed = true
      stop()
    }
  }, [applyJob, enabled, jobId])

  const job = jobId && state.jobId === jobId ? state.job : null
  return { job, connection }
}
