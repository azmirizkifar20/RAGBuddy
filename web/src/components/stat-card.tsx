import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

const TONES = {
  brand: 'bg-brand-soft text-brand',
  success: 'bg-success/12 text-success',
  warning: 'bg-warning/12 text-warning',
  info: 'bg-info/12 text-info',
} as const

export function StatCard({
  icon: Icon,
  label,
  value,
  hint,
  tone = 'brand',
  className,
}: {
  icon: LucideIcon
  label: string
  value: string | number
  hint?: string
  tone?: keyof typeof TONES
  className?: string
}) {
  return (
    <div
      className={cn(
        'surface-glow group relative overflow-hidden rounded-xl bg-card p-4 ring-1 ring-foreground/10 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lg',
        className,
      )}
    >
      <div className="flex items-center gap-3">
        <div className={cn('flex size-9 items-center justify-center rounded-lg transition-transform duration-300 group-hover:scale-110', TONES[tone])}>
          <Icon className="size-4.5" />
        </div>
        <div className="min-w-0">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</p>
          <p className="font-heading text-xl font-semibold tabular-nums">{value}</p>
        </div>
      </div>
      {hint && <p className="mt-2 truncate text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}
