import { useMemo, useState } from 'react'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import type { RunRecord } from '@/lib/api-client'
import { cn } from '@/lib/utils'

const WINDOW_DAYS = 7
const PLOT_HEIGHT = 128

const SERIES = [
  { key: 'upload', label: 'Upload', dot: 'bg-chart-4', bar: 'bg-chart-4' },
  { key: 'sync', label: 'Sync', dot: 'bg-chart-2', bar: 'bg-chart-2' },
  { key: 'ingest', label: 'Ingest', dot: 'bg-chart-1', bar: 'bg-chart-1' },
] as const
// Stacking order top -> bottom matches the array above (upload on top, ingest on the baseline).
// This order is fixed — never reassigned based on which kind happens to be biggest that day.

type SeriesKey = (typeof SERIES)[number]['key']

interface DayBucket {
  key: string
  label: string
  full: string
  counts: Record<SeriesKey, number>
  total: number
}

function toSeriesKey(kind: RunRecord['kind']): SeriesKey {
  if (kind === 'ingest') return 'ingest'
  if (kind === 'sync') return 'sync'
  return 'upload' // upload + upload-remove share one bucket — both are upload-panel activity
}

function bucketByDay(runs: RunRecord[]): DayBucket[] {
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const buckets: DayBucket[] = []
  for (let i = WINDOW_DAYS - 1; i >= 0; i--) {
    const date = new Date(today)
    date.setDate(date.getDate() - i)
    buckets.push({
      key: date.toDateString(),
      label: date.toLocaleDateString(undefined, { day: 'numeric' }),
      full: date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }),
      counts: { ingest: 0, sync: 0, upload: 0 },
      total: 0,
    })
  }

  const byKey = new Map(buckets.map((b) => [b.key, b]))
  for (const run of runs) {
    const day = new Date(run.startedAt)
    day.setHours(0, 0, 0, 0)
    const bucket = byKey.get(day.toDateString())
    if (!bucket) continue // outside the window this chart shows
    const seriesKey = toSeriesKey(run.kind)
    bucket.counts[seriesKey] += 1
    bucket.total += 1
  }
  return buckets
}

/** Daily ingest/sync/upload activity for the last week — a frequency-at-a-glance
 * companion to the exact `RunTable` log below it. Built from the same `runs` the table
 * already fetched, so there's no extra request and the two never disagree. */
export function ActivityChart({ runs }: { runs: RunRecord[] }) {
  const [asTable, setAsTable] = useState(false)
  const buckets = useMemo(() => bucketByDay(runs), [runs])
  const maxTotal = Math.max(1, ...buckets.map((b) => b.total))

  return (
    <div className="rounded-lg border p-4">
      <div className="mb-4 flex items-center justify-between gap-2">
        <div className="flex items-center gap-4">
          {SERIES.map((s) => (
            <span key={s.key} className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className={cn('size-2 shrink-0 rounded-full', s.dot)} />
              {s.label}
            </span>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setAsTable((v) => !v)}
          className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          {asTable ? 'View as chart' : 'View as table'}
        </button>
      </div>

      {asTable ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              {SERIES.slice()
                .reverse()
                .map((s) => (
                  <TableHead key={s.key} className="text-right">
                    {s.label}
                  </TableHead>
                ))}
              <TableHead className="text-right">Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {buckets
              .slice()
              .reverse()
              .map((b) => (
                <TableRow key={b.key}>
                  <TableCell className="whitespace-nowrap">{b.full}</TableCell>
                  {SERIES.slice()
                    .reverse()
                    .map((s) => (
                      <TableCell key={s.key} className="text-right tabular-nums">
                        {b.counts[s.key]}
                      </TableCell>
                    ))}
                  <TableCell className="text-right font-medium tabular-nums">{b.total}</TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
      ) : (
        <div className="flex items-end gap-1.5" style={{ height: PLOT_HEIGHT }}>
          {buckets.map((bucket) => {
            const topSeries = SERIES.find((s) => bucket.counts[s.key] > 0)
            return (
              <div
                key={bucket.key}
                tabIndex={bucket.total > 0 ? 0 : undefined}
                className="group relative flex flex-1 flex-col justify-end focus:outline-none"
                style={{ height: PLOT_HEIGHT }}
              >
                {bucket.total > 0 && (
                  <div
                    role="tooltip"
                    className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1.5 -translate-x-1/2 rounded-md border bg-popover px-2.5 py-1.5 text-xs whitespace-nowrap text-popover-foreground opacity-0 shadow-md transition-opacity group-hover:opacity-100 group-focus:opacity-100"
                  >
                    <p className="mb-1 font-medium text-foreground">{bucket.full}</p>
                    {SERIES.map(
                      (s) =>
                        bucket.counts[s.key] > 0 && (
                          <p key={s.key} className="flex items-center gap-1.5">
                            <span className={cn('size-1.5 shrink-0 rounded-full', s.dot)} />
                            <span className="tabular-nums">{bucket.counts[s.key]}</span> {s.label.toLowerCase()}
                          </p>
                        ),
                    )}
                  </div>
                )}
                {SERIES.map((s) => {
                  const count = bucket.counts[s.key]
                  if (count === 0) return null
                  const heightPct = (count / maxTotal) * 100
                  return (
                    <div
                      key={s.key}
                      className={cn(
                        'w-full transition-colors',
                        s.bar,
                        s.key !== 'ingest' && 'mb-0.5',
                        topSeries?.key === s.key && 'rounded-t-[4px]',
                      )}
                      style={{ height: `${heightPct}%`, minHeight: 3 }}
                    />
                  )
                })}
                <span className="mt-1.5 block text-center text-[10px] text-muted-foreground">{bucket.label}</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
