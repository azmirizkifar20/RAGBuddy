import { useCallback, useEffect, useState } from 'react'
import { CheckCircle2Icon, ClockIcon, RefreshCwIcon, TimerIcon, XCircleIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { StatCard } from '@/components/stat-card'
import { EmptyState } from '@/components/empty-state'
import { RunList } from '@/components/run-list'
import { useProjectContext } from '@/pages/project-layout'
import { getHistory, type RunRecord } from '@/lib/api-client'
import { formatDuration } from '@/lib/format'

export function ProjectHistory() {
  const { project } = useProjectContext()
  const [runs, setRuns] = useState<RunRecord[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const { runs } = await getHistory(project.id, 100)
      setRuns(runs)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setRuns([])
    }
  }, [project.id])

  useEffect(() => {
    load()
  }, [load])

  if (runs === null) {
    return (
      <div className="flex flex-col gap-3">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-20" />
        ))}
      </div>
    )
  }

  const succeeded = runs.filter((r) => r.status === 'success').length
  const failed = runs.length - succeeded
  const averageMs = runs.length > 0 ? Math.round(runs.reduce((total, r) => total + r.durationMs, 0) / runs.length) : 0

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Every ingest, sync and upload for this project — whether it came from the dashboard, the CLI, or a{' '}
          <code className="font-mono">git commit</code>.
        </p>
        <Button variant="outline" size="sm" className="gap-1.5 shrink-0" onClick={load}>
          <RefreshCwIcon className="size-3.5" /> Refresh
        </Button>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {runs.length === 0 ? (
        <EmptyState
          icon={ClockIcon}
          title="No runs recorded yet"
          description="Run an ingest or sync from the Overview tab — it will show up here with its full result breakdown."
        />
      ) : (
        <>
          <div className="stagger grid gap-3 sm:grid-cols-3">
            <StatCard icon={CheckCircle2Icon} label="Successful" value={succeeded} tone="success" />
            <StatCard icon={XCircleIcon} label="Failed" value={failed} tone={failed > 0 ? 'warning' : 'brand'} />
            <StatCard icon={TimerIcon} label="Average duration" value={formatDuration(averageMs)} tone="info" />
          </div>
          <RunList runs={runs} />
        </>
      )}
    </div>
  )
}
