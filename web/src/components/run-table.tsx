import { Link } from 'react-router'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatDateTime, formatDuration, timeAgo } from '@/lib/format'
import type { RunKind, RunRecord, RunTrigger } from '@/lib/api-client'
import { cn } from '@/lib/utils'

const KIND_LABEL: Record<RunKind, string> = {
  ingest: 'Full ingest',
  sync: 'Sync',
  upload: 'Upload',
  'upload-remove': 'Upload removed',
}

const TRIGGER_LABEL: Record<RunTrigger, string> = {
  hook: 'git commit',
  web: 'dashboard',
  cli: 'CLI',
}

/** Compact one-line rendering of whatever counters the run recorded. */
function summaryText(run: RunRecord): string {
  if (run.status === 'error') return run.error ?? 'failed'
  const parts = Object.entries(run.summary)
    .filter(([, value]) => value !== 0 && value !== false && value !== '')
    .map(([key, value]) => (typeof value === 'boolean' ? key : `${key} ${value}`))
  return parts.length > 0 ? parts.join(' · ') : 'no changes'
}

export function RunTable({ runs, showProject = false }: { runs: RunRecord[]; showProject?: boolean }) {
  return (
    <div className="overflow-hidden rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/40 hover:bg-muted/40">
            <TableHead className="w-32">When</TableHead>
            {showProject && <TableHead className="w-40">Project</TableHead>}
            <TableHead className="w-32">Action</TableHead>
            <TableHead className="w-28">Triggered by</TableHead>
            <TableHead className="w-20">Result</TableHead>
            <TableHead>Details</TableHead>
            <TableHead className="w-20 text-right">Duration</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {runs.map((run) => (
            <TableRow key={run.id}>
              <TableCell className="whitespace-nowrap text-muted-foreground" title={formatDateTime(run.startedAt)}>
                {timeAgo(run.startedAt)}
              </TableCell>
              {showProject && (
                <TableCell>
                  <Link to={`/projects/${run.project}`} className="font-mono text-xs hover:underline">
                    {run.project}
                  </Link>
                </TableCell>
              )}
              <TableCell className="whitespace-nowrap">{KIND_LABEL[run.kind] ?? run.kind}</TableCell>
              <TableCell className="whitespace-nowrap text-muted-foreground">
                {TRIGGER_LABEL[run.trigger] ?? run.trigger}
              </TableCell>
              <TableCell>
                <span
                  className={cn(
                    'inline-flex items-center gap-1.5 whitespace-nowrap',
                    run.status === 'error' ? 'text-destructive' : 'text-muted-foreground',
                  )}
                >
                  <span
                    className={cn(
                      'size-1.5 rounded-full',
                      run.status === 'error' ? 'bg-destructive' : 'bg-success',
                    )}
                  />
                  {run.status === 'error' ? 'failed' : 'ok'}
                </span>
              </TableCell>
              <TableCell
                className={cn('font-mono text-xs', run.status === 'error' ? 'text-destructive' : 'text-muted-foreground')}
              >
                <span className="line-clamp-2">{summaryText(run)}</span>
              </TableCell>
              <TableCell className="text-right whitespace-nowrap tabular-nums text-muted-foreground">
                {formatDuration(run.durationMs)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
