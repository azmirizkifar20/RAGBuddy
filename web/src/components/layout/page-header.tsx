import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'

export function PageHeader({
  icon: Icon,
  title,
  description,
  actions,
}: {
  icon?: LucideIcon
  title: string
  description?: ReactNode
  actions?: ReactNode
}) {
  return (
    <div className="mb-6 flex flex-col gap-3 animate-fade-up sm:flex-row sm:items-start sm:justify-between">
      <div className="flex min-w-0 items-start gap-3">
        {Icon && (
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand">
            <Icon className="size-5" />
          </div>
        )}
        <div className="min-w-0">
          <h1 className="font-heading text-xl font-semibold tracking-tight">{title}</h1>
          {description && <div className="mt-0.5 text-sm text-muted-foreground">{description}</div>}
        </div>
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}
