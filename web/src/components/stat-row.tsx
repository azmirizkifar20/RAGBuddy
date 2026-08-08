import { cn } from '@/lib/utils'

export interface Stat {
  label: string
  value: string | number
  hint?: string
}

/**
 * Metrics as one hairline-divided row rather than a grid of tinted icon
 * tiles — the numbers are the content, so nothing else competes with them.
 */
export function StatRow({ stats, className }: { stats: Stat[]; className?: string }) {
  return (
    <dl
      className={cn(
        'grid grid-cols-2 divide-x divide-y rounded-lg border sm:grid-cols-4 sm:divide-y-0',
        className,
      )}
    >
      {stats.map((stat) => (
        <div key={stat.label} className="px-4 py-3 first:border-l-0">
          <dt className="text-xs text-muted-foreground">{stat.label}</dt>
          <dd className="mt-1 font-heading text-2xl leading-none font-semibold tabular-nums">{stat.value}</dd>
          {stat.hint && <p className="mt-1.5 truncate text-xs text-muted-foreground">{stat.hint}</p>}
        </div>
      ))}
    </dl>
  )
}
