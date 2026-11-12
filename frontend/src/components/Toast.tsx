import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { CheckCircle2, Info, TriangleAlert, X } from 'lucide-react'
import type { ToastTone } from '../types/api'
import { ToastContext, type ToastApi } from '../hooks/useToast'
import { cn } from '../lib/utils'

interface ToastItem {
  id: number
  message: string
  tone: ToastTone
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const nextId = useRef(1)
  const timers = useRef(new Map<number, number>())

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id)
    if (timer) window.clearTimeout(timer)
    timers.current.delete(id)
    setItems((current) => current.filter((item) => item.id !== id))
  }, [])

  const show = useCallback(
    (message: string, tone: ToastTone = 'info') => {
      const id = nextId.current++
      setItems((current) => [...current.slice(-3), { id, message, tone }])
      const timer = window.setTimeout(() => dismiss(id), tone === 'error' ? 6500 : 4200)
      timers.current.set(id, timer)
    },
    [dismiss],
  )

  const api = useMemo<ToastApi>(
    () => ({
      show,
      success: (message) => show(message, 'success'),
      error: (message) => show(message, 'error'),
      info: (message) => show(message, 'info'),
    }),
    [show],
  )

  useEffect(() => {
    const activeTimers = timers.current
    return () => {
      for (const timer of activeTimers.values()) window.clearTimeout(timer)
      activeTimers.clear()
    }
  }, [])

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed inset-x-4 bottom-4 z-[80] flex flex-col items-end gap-2 sm:bottom-6 sm:left-auto sm:right-6 sm:max-w-sm"
      >
        <AnimatePresence initial={false}>
          {items.map((item) => (
            <ToastCard key={item.id} item={item} onDismiss={() => dismiss(item.id)} />
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  )
}

function ToastCard({ item, onDismiss }: { item: ToastItem; onDismiss: () => void }) {
  const Icon = item.tone === 'success' ? CheckCircle2 : item.tone === 'error' ? TriangleAlert : Info
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 16, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 8, scale: 0.96 }}
      transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
      className={cn(
        'glass pointer-events-auto flex w-full items-start gap-3 rounded-2xl px-4 py-3.5 text-sm shadow-card',
        item.tone === 'error' && 'border-rose-400/25',
        item.tone === 'success' && 'border-emerald-300/20',
      )}
      role={item.tone === 'error' ? 'alert' : 'status'}
    >
      <Icon
        className={cn(
          'mt-0.5 h-4.5 w-4.5 shrink-0',
          item.tone === 'success'
            ? 'text-emerald-300'
            : item.tone === 'error'
              ? 'text-rose-300'
              : 'text-cyan-300',
        )}
        aria-hidden="true"
      />
      <p className="min-w-0 flex-1 leading-relaxed text-slate-100">{item.message}</p>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss notification"
        className="-mr-1 rounded-md p-1 text-slate-400 transition hover:bg-white/5 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </motion.div>
  )
}
