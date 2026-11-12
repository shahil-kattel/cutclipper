import type { ButtonHTMLAttributes, CSSProperties, InputHTMLAttributes, ReactNode } from 'react'
import { LoaderCircle } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '../lib/utils'

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
type ButtonSize = 'sm' | 'md' | 'lg'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
  icon?: LucideIcon
  iconRight?: LucideIcon
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  icon: Icon,
  iconRight: IconRight,
  className,
  children,
  disabled,
  ...props
}: ButtonProps) {
  const sizes: Record<ButtonSize, string> = {
    sm: 'h-9 rounded-lg px-3.5 text-[13px]',
    md: 'h-11 rounded-xl px-5 text-sm',
    lg: 'h-[3.25rem] rounded-xl px-6 text-[15px]',
  }
  const variants: Record<ButtonVariant, string> = {
    primary:
      'bg-[linear-gradient(110deg,#20c7e8_0%,#8161f6_50%,#f254cb_100%)] text-white shadow-[0_12px_40px_-14px_rgba(100,120,255,0.85)] hover:brightness-110 hover:shadow-[0_16px_48px_-12px_rgba(100,140,255,0.9)]',
    secondary:
      'border border-white/12 bg-white/[0.045] text-slate-100 hover:border-white/20 hover:bg-white/[0.075]',
    ghost: 'text-slate-300 hover:bg-white/[0.06] hover:text-white',
    danger:
      'border border-rose-300/25 bg-rose-400/[0.08] text-rose-100 hover:border-rose-300/40 hover:bg-rose-400/[0.14]',
  }

  return (
    <button
      type="button"
      {...props}
      disabled={disabled || loading}
      className={cn(
        'relative inline-flex select-none items-center justify-center gap-2 font-semibold tracking-[-0.01em] transition-all duration-200',
        'active:translate-y-px disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:brightness-100',
        sizes[size],
        variants[variant],
        className,
      )}
    >
      {loading ? (
        <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
      ) : Icon ? (
        <Icon className="h-4 w-4" aria-hidden="true" />
      ) : null}
      <span>{children}</span>
      {IconRight && !loading ? <IconRight className="h-4 w-4" aria-hidden="true" /> : null}
    </button>
  )
}

interface ToggleProps {
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  label: string
  id?: string
}

export function Toggle({ checked, onChange, disabled, label, id }: ToggleProps) {
  return (
    <button
      type="button"
      id={id}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative h-6 w-11 shrink-0 rounded-full border transition-colors duration-300',
        'after:absolute after:left-[3px] after:top-[3px] after:h-4 after:w-4 after:rounded-full after:bg-white after:shadow-sm after:transition-transform after:duration-300',
        checked
          ? 'border-cyan-200/30 bg-gradient-to-r from-cyan-400 to-violet-500 after:translate-x-5'
          : 'border-white/12 bg-white/10 after:translate-x-0',
        disabled && 'cursor-not-allowed opacity-40',
      )}
    >
      <span className="sr-only">{label}</span>
    </button>
  )
}

interface RangeFieldProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'type' | 'value' | 'onChange'
> {
  label: string
  value: number
  display?: ReactNode
  hint?: string
  onValueChange: (value: number) => void
}

export function RangeField({
  label,
  value,
  display,
  hint,
  min = 0,
  max = 100,
  step = 1,
  onValueChange,
  className,
  id,
  ...props
}: RangeFieldProps) {
  const numericMin = Number(min)
  const numericMax = Number(max)
  const progress = ((value - numericMin) / Math.max(1, numericMax - numericMin)) * 100
  const fieldId = id || `range-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
  return (
    <div className={cn('space-y-2.5', className)}>
      <div className="flex items-baseline justify-between gap-4">
        <label htmlFor={fieldId} className="text-[13px] font-medium text-slate-300">
          {label}
        </label>
        <span className="font-display text-sm font-medium tabular-nums text-white">
          {display ?? value}
        </span>
      </div>
      <input
        id={fieldId}
        type="range"
        className="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onValueChange(Number(event.target.value))}
        style={{ '--range-progress': `${Math.max(0, Math.min(100, progress))}%` } as CSSProperties}
        {...props}
      />
      {hint ? <p className="text-xs leading-relaxed text-slate-500">{hint}</p> : null}
    </div>
  )
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={cn('inline-flex h-5 w-5 animate-spin text-cyan-300', className)}
    >
      <LoaderCircle className="h-full w-full" aria-hidden="true" />
    </span>
  )
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('shimmer rounded-lg bg-white/[0.04]', className)} aria-hidden="true" />
}

export function SectionCard({
  icon: Icon,
  eyebrow,
  title,
  description,
  action,
  children,
  className,
}: {
  icon: LucideIcon
  eyebrow?: string
  title: string
  description?: string
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={cn('glass rounded-2xl p-5 sm:p-6', className)}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3.5">
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-cyan-200/15 bg-gradient-to-br from-cyan-400/[0.13] to-violet-500/[0.08] text-cyan-200">
            <Icon className="h-4.5 w-4.5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            {eyebrow ? (
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-cyan-300/65">
                {eyebrow}
              </p>
            ) : null}
            <h2 className="font-display text-[17px] font-semibold tracking-[-0.02em] text-white">
              {title}
            </h2>
            {description ? (
              <p className="mt-1 text-[13px] leading-relaxed text-slate-400">{description}</p>
            ) : null}
          </div>
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      <div className="mt-5">{children}</div>
    </section>
  )
}

export function Pill({
  children,
  tone = 'default',
  className,
}: {
  children: ReactNode
  tone?: 'default' | 'cyan' | 'violet' | 'success' | 'danger'
  className?: string
}) {
  const tones = {
    default: 'border-white/10 bg-white/[0.045] text-slate-300',
    cyan: 'border-cyan-300/20 bg-cyan-300/[0.08] text-cyan-200',
    violet: 'border-violet-300/20 bg-violet-300/[0.08] text-violet-200',
    success: 'border-emerald-300/20 bg-emerald-300/[0.08] text-emerald-200',
    danger: 'border-rose-300/20 bg-rose-300/[0.08] text-rose-200',
  }
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium tracking-wide',
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  )
}

export function FieldLabel({ children, htmlFor }: { children: ReactNode; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="text-[13px] font-medium text-slate-300">
      {children}
    </label>
  )
}
