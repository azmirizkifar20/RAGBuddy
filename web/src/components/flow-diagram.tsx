import { useState } from 'react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface FlowStage {
  id: string
  icon: LucideIcon
  title: string
  caption: string
  detail: string
  /** Where this step lives in the codebase — the point of the whole page. */
  source?: string
}

/**
 * A dashed connector whose dashes march toward the next stage. Rotates to
 * vertical on small screens where the stages stack.
 */
function Connector() {
  return (
    <div className="flex shrink-0 items-center justify-center py-1 sm:px-1 sm:py-0">
      <svg
        className="h-8 w-6 sm:h-6 sm:w-8"
        viewBox="0 0 32 24"
        fill="none"
        aria-hidden
        preserveAspectRatio="none"
      >
        <line
          x1="2"
          y1="12"
          x2="26"
          y2="12"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeDasharray="4 4"
          strokeLinecap="round"
          className="animate-dash text-brand/60 max-sm:hidden"
        />
        <line
          x1="16"
          y1="2"
          x2="16"
          y2="22"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeDasharray="4 4"
          strokeLinecap="round"
          className="animate-dash text-brand/60 sm:hidden"
        />
        <path d="M26 12l-4-3v6z" fill="currentColor" className="text-brand/60 max-sm:hidden" />
        <path d="M16 22l-3-4h6z" fill="currentColor" className="text-brand/60 sm:hidden" />
      </svg>
    </div>
  )
}

export function FlowDiagram({
  title,
  description,
  stages,
  tone = 'brand',
}: {
  title: string
  description: string
  stages: FlowStage[]
  tone?: 'brand' | 'cyan'
}) {
  const [selected, setSelected] = useState(stages[0].id)
  const active = stages.find((stage) => stage.id === selected) ?? stages[0]

  return (
    <section className="rounded-xl bg-card p-4 ring-1 ring-foreground/10 sm:p-5">
      <h2 className="font-heading font-semibold">{title}</h2>
      <p className="mt-0.5 mb-4 text-sm text-muted-foreground">{description}</p>

      <div className="flex flex-col items-stretch sm:flex-row sm:items-center">
        {stages.map((stage, index) => (
          <div key={stage.id} className="flex flex-col items-stretch sm:flex-1 sm:flex-row sm:items-center">
            <button
              type="button"
              onClick={() => setSelected(stage.id)}
              aria-pressed={stage.id === selected}
              className={cn(
                'group flex flex-1 flex-col items-center gap-1.5 rounded-xl border px-2 py-3 text-center transition-all duration-300',
                stage.id === selected
                  ? 'border-brand/40 bg-brand-soft/60 shadow-sm'
                  : 'border-transparent bg-muted/40 hover:-translate-y-0.5 hover:bg-muted',
              )}
            >
              <span
                className={cn(
                  'flex size-9 items-center justify-center rounded-lg transition-transform duration-300 group-hover:scale-110',
                  tone === 'cyan' ? 'bg-accent-cyan/15 text-accent-cyan' : 'bg-brand-soft text-brand',
                  stage.id === selected && 'animate-pulse-glow',
                )}
              >
                <stage.icon className="size-4.5" />
              </span>
              <span className="text-xs leading-tight font-medium">{stage.title}</span>
              <span className="text-[11px] leading-tight text-muted-foreground">{stage.caption}</span>
            </button>
            {index < stages.length - 1 && <Connector />}
          </div>
        ))}
      </div>

      <div key={active.id} className="mt-4 animate-fade-up rounded-lg bg-muted/50 p-3.5">
        <p className="text-sm font-medium">{active.title}</p>
        <p className="mt-1 text-sm text-muted-foreground">{active.detail}</p>
        {active.source && (
          <p className="mt-2 font-mono text-xs text-brand">{active.source}</p>
        )}
      </div>
    </section>
  )
}
