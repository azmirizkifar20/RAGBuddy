import { useCallback, useEffect, useState } from 'react'
import { ClockIcon, RefreshCwIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { StatRow } from '@/components/stat-row'
import { EmptyState } from '@/components/empty-state'
import { RunTable } from '@/components/run-table'
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

  if (runs === null) return <Skeleton className="h-64" />

  const succeeded = runs.filter((r) => r.status === 'success').length
  const failed = runs.length - succeeded
  const averageMs = runs.length > 0 ? Math.round(runs.reduce((total, r) => total + r.durationMs, 0) / runs.length) : 0

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Every ingest, sync and upload for this project — from the dashboard, the CLI, or a{' '}
          <code className="font-mono">git commit</code>.
        </p>
        <Button variant="outline" size="sm" className="shrink-0 gap-1.5" onClick={load}>
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
          <StatRow
            stats={[
              { label: 'Total runs', value: runs.length },
              { label: 'Successful', value: succeeded },
              { label: 'Failed', value: failed },
              { label: 'Average duration', value: formatDuration(averageMs) },
            ]}
          />
          <RunTable runs={runs} />
        </>
      )}
    </div>
  )
}
