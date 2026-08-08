import { useState } from 'react'
import { cn } from '@/lib/utils'

export interface FlowStage {
  id: string
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
    <div className="flex shrink-0 items-center justify-center text-border py-1 sm:px-1 sm:py-0">
      <svg className="h-6 w-5 sm:h-5 sm:w-6" viewBox="0 0 24 20" fill="none" aria-hidden preserveAspectRatio="none">
        <line
          x1="1"
          y1="10"
          x2="19"
          y2="10"
          stroke="currentColor"
          strokeWidth="1"
          strokeDasharray="3 3"
          className="animate-dash max-sm:hidden"
        />
        <line
          x1="12"
          y1="1"
          x2="12"
          y2="19"
          stroke="currentColor"
          strokeWidth="1"
          strokeDasharray="3 3"
          className="animate-dash sm:hidden"
        />
        <path d="M19 10l-3.5-2.5v5z" fill="currentColor" className="max-sm:hidden" />
        <path d="M12 19l-2.5-3.5h5z" fill="currentColor" className="sm:hidden" />
      </svg>
    </div>
  )
}

export function FlowDiagram({
  title,
  description,
  stages,
}: {
  title: string
  description: string
  stages: FlowStage[]
}) {
  const [selected, setSelected] = useState(stages[0].id)
  const active = stages.find((stage) => stage.id === selected) ?? stages[0]

  return (
    <section className="rounded-lg border p-4">
      <h2 className="text-sm font-medium">{title}</h2>
      <p className="mt-0.5 mb-4 text-sm text-muted-foreground">{description}</p>

      <div className="flex flex-col items-stretch sm:flex-row sm:items-stretch">
        {stages.map((stage, index) => (
          <div key={stage.id} className="flex flex-col items-stretch sm:flex-1 sm:flex-row sm:items-center">
            <button
              type="button"
              onClick={() => setSelected(stage.id)}
              aria-pressed={stage.id === selected}
              className={cn(
                'flex flex-1 flex-col gap-0.5 rounded-md border px-3 py-2.5 text-left transition-colors',
                stage.id === selected
                  ? 'border-brand/50 bg-muted/60'
                  : 'border-transparent bg-muted/30 hover:bg-muted/60',
              )}
            >
              <span className="text-xs text-muted-foreground tabular-nums">{index + 1}</span>
              <span className="text-sm leading-tight font-medium">{stage.title}</span>
              <span className="text-xs leading-tight text-muted-foreground">{stage.caption}</span>
            </button>
            {index < stages.length - 1 && <Connector />}
          </div>
        ))}
      </div>

      <div key={active.id} className="mt-4 animate-fade-in border-t pt-4">
        <p className="text-sm">{active.detail}</p>
        {active.source && <p className="mt-2 font-mono text-xs text-muted-foreground">{active.source}</p>}
      </div>
    </section>
  )
}
