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
    sm: 'h-9 rounded-lg px-3.5 text-[12.5px]',
    md: 'h-11 rounded-xl px-5 text-[13.5px]',
    lg: 'h-[3.25rem] rounded-xl px-6 text-[14.5px]',
  }
  const variants: Record<ButtonVariant, string> = {
    primary:
      'border-[1.5px] border-ink bg-tomato text-paper-soft shadow-[3px_4px_0_#211d19] hover:-translate-x-0.5 hover:-translate-y-0.5 hover:bg-tomato-bright hover:shadow-[4px_5px_0_#211d19]',
    secondary:
      'border-[1.5px] border-ink bg-mustard text-ink shadow-[3px_3px_0_#211d19] hover:-translate-y-0.5 hover:bg-[#f7ca69] hover:shadow-[4px_4px_0_#211d19]',
    ghost:
      'border-[1.5px] border-transparent text-ink-soft hover:border-ink/25 hover:bg-paper-deep/60 hover:text-ink',
    danger:
      'border-[1.5px] border-ink bg-tomato-soft text-ink shadow-[2px_3px_0_#211d19] hover:bg-[#f2c5b8]',
  }

  return (
    <button
      type="button"
      {...props}
      disabled={disabled || loading}
      className={cn(
        'relative inline-flex select-none items-center justify-center gap-2 font-semibold tracking-[-0.01em] transition-all duration-150',
        'active:translate-x-[2px] active:translate-y-[3px] active:shadow-none disabled:cursor-not-allowed disabled:border-ink/15 disabled:bg-paper-deep disabled:text-ink-faint disabled:opacity-100 disabled:shadow-none disabled:hover:translate-x-0 disabled:hover:translate-y-0',
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
        'relative h-[1.6rem] w-[3rem] shrink-0 rounded-full border-[1.5px] border-ink transition-colors duration-200',
        'after:absolute after:left-[3px] after:top-[3px] after:h-[1.1rem] after:w-[1.1rem] after:rounded-full after:border-[1.5px] after:border-ink after:bg-paper-soft after:shadow-[1px_1px_0_#211d19] after:transition-transform after:duration-200',
        checked ? 'bg-teal after:translate-x-[1.3rem]' : 'bg-paper-deep after:translate-x-0',
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
  tone?: 'tomato' | 'teal' | 'periwinkle' | 'mustard'
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
  tone = 'tomato',
  ...props
}: RangeFieldProps) {
  const numericMin = Number(min)
  const numericMax = Number(max)
  const progress = ((value - numericMin) / Math.max(1, numericMax - numericMin)) * 100
  const fieldId = id || `range-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
  const tones = {
    tomato: 'var(--tomato)',
    teal: 'var(--teal)',
    periwinkle: 'var(--periwinkle)',
    mustard: 'var(--mustard)',
  }
  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex items-baseline justify-between gap-4">
        <label htmlFor={fieldId} className="text-[12.5px] font-medium text-ink-soft">
          {label}
        </label>
        <span className="rounded-md border border-ink/20 bg-paper px-1.5 py-0.5 font-display text-[12px] font-semibold tabular-nums text-ink">
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
        style={
          {
            '--range-progress': `${Math.max(0, Math.min(100, progress))}%`,
            '--accent': tones[tone],
          } as CSSProperties
        }
        {...props}
      />
      {hint ? <p className="text-[11px] leading-relaxed text-ink-soft">{hint}</p> : null}
    </div>
  )
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={cn('inline-flex h-5 w-5 animate-spin text-tomato', className)}
    >
      <LoaderCircle className="h-full w-full" aria-hidden="true" />
    </span>
  )
}

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn('shimmer rounded-lg border border-ink/10 bg-paper-deep/60', className)}
      aria-hidden="true"
    />
  )
}

type SectionTone = 'tomato' | 'mustard' | 'teal' | 'periwinkle'

export function SectionCard({
  icon: Icon,
  eyebrow,
  title,
  description,
  action,
  children,
  className,
  tone = 'tomato',
}: {
  icon: LucideIcon
  eyebrow?: string
  title: string
  description?: string
  action?: ReactNode
  children: ReactNode
  className?: string
  tone?: SectionTone
}) {
  const tones: Record<SectionTone, string> = {
    tomato: 'bg-tomato-soft text-tomato',
    mustard: 'bg-mustard-soft text-ink',
    teal: 'bg-teal-soft text-teal',
    periwinkle: 'bg-periwinkle-soft text-periwinkle',
  }
  return (
    <section className={cn('glass rounded-[1.2rem] p-4 sm:p-5', className)}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-[12rem] flex-1 items-start gap-3.5">
          <span
            className={cn(
              'mt-0.5 flex h-10 w-10 shrink-0 -rotate-2 items-center justify-center rounded-[0.8rem] border-[1.5px] border-ink shadow-[2px_2px_0_#211d19]',
              tones[tone],
            )}
          >
            <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            {eyebrow ? (
              <p className="mb-1 flex items-center gap-2 text-[9.5px] font-bold uppercase tracking-[0.18em] text-ink-soft">
                <span className="inline-block h-px w-4 bg-tomato" aria-hidden="true" />
                {eyebrow}
              </p>
            ) : null}
            <h2 className="font-display text-[20px] font-semibold leading-tight tracking-[-0.025em] text-ink">
              {title}
            </h2>
            {description ? (
              <p className="mt-1.5 text-[12px] leading-5 text-ink-soft">{description}</p>
            ) : null}
          </div>
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      <div className="mt-4 border-t border-dashed border-ink/20 pt-4">{children}</div>
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
    default: 'border-ink bg-paper-soft text-ink-soft',
    cyan: 'border-ink bg-teal-soft text-teal',
    violet: 'border-ink bg-periwinkle-soft text-periwinkle',
    success: 'border-ink bg-mustard-soft text-ink',
    danger: 'border-ink bg-tomato-soft text-tomato',
  }
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border-[1.5px] px-2 py-1 text-[10px] font-bold uppercase tracking-[0.1em] shadow-[1px_2px_0_#211d19]',
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
    <label htmlFor={htmlFor} className="text-[12px] font-medium text-ink-soft">
      {children}
    </label>
  )
}
