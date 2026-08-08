import { useState, type MouseEvent } from 'react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { RefreshCwIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { syncProject, type Project } from '@/lib/api-client'
import { timeAgo } from '@/lib/format'
import { cn } from '@/lib/utils'

export function ProjectCard({ project, onSynced }: { project: Project; onSynced?: () => void }) {
  const [syncing, setSyncing] = useState(false)

  async function handleSync(event: MouseEvent) {
    event.preventDefault()
    event.stopPropagation()
    setSyncing(true)
    try {
      await syncProject(project.id, {
        onLog: () => {},
        onDone: () => {
          toast.success(`Sync finished for "${project.name}".`)
          onSynced?.()
        },
        onError: (message) => toast.error(message),
      })
    } finally {
      setSyncing(false)
    }
  }

  return (
    <Link
      to={`/projects/${project.id}`}
      className="flex flex-col rounded-lg border transition-colors hover:border-foreground/25"
    >
      <div className="flex flex-1 flex-col gap-2 p-4">
        <div className="flex items-baseline justify-between gap-2">
          <p className="truncate font-medium">{project.name}</p>
          <span
            className={cn(
              'shrink-0 text-xs',
              project.hookInstalled ? 'text-success' : 'text-muted-foreground',
            )}
          >
            {project.hookInstalled ? 'auto-sync' : 'manual'}
          </span>
        </div>

        <p className="truncate font-mono text-xs text-muted-foreground" title={project.repository}>
          {project.repository}
        </p>

        <dl className="mt-1 flex gap-5 text-sm">
          <div>
            <dt className="text-xs text-muted-foreground">Docs</dt>
            <dd className="tabular-nums">{project.indexedFileCount}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Chunks</dt>
            <dd className="tabular-nums">{project.chunkCount}</dd>
          </div>
          {project.uploadCount > 0 && (
            <div>
              <dt className="text-xs text-muted-foreground">Uploads</dt>
              <dd className="tabular-nums">{project.uploadCount}</dd>
            </div>
          )}
        </dl>
      </div>

      <div className="flex items-center justify-between gap-2 border-t px-4 py-2">
        <span className="truncate text-xs text-muted-foreground">Last run {timeAgo(project.lastRunAt)}</span>
        <Button size="sm" variant="ghost" disabled={syncing} onClick={handleSync} className="gap-1.5">
          <RefreshCwIcon className={cn('size-3.5', syncing && 'animate-spin')} />
          {syncing ? 'Syncing' : 'Sync'}
        </Button>
      </div>
    </Link>
  )
}
