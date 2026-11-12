import { createContext, useContext } from 'react'
import type { ToastTone } from '../types/api'

export interface ToastApi {
  show: (message: string, tone?: ToastTone) => void
  success: (message: string) => void
  error: (message: string) => void
  info: (message: string) => void
}

export const ToastContext = createContext<ToastApi | null>(null)

export function useToast(): ToastApi {
  const context = useContext(ToastContext)
  if (!context) throw new Error('useToast must be used inside ToastProvider')
  return context
}
