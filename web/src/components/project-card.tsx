import { useState, type MouseEvent } from 'react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import {
  ArrowRightIcon,
  ClockIcon,
  FileTextIcon,
  GitBranchIcon,
  LayersIcon,
  RefreshCwIcon,
  UploadIcon,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { syncProject, type Project } from '@/lib/api-client'
import { timeAgo } from '@/lib/format'

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
      className="surface-glow group relative flex flex-col overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10 transition-all duration-300 hover:-translate-y-1 hover:shadow-xl"
    >
      <div className="absolute inset-x-0 top-0 h-0.5 scale-x-0 bg-linear-to-r from-brand to-accent-cyan transition-transform duration-300 group-hover:scale-x-100" />

      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate font-heading font-medium">{project.name}</p>
            <p className="truncate font-mono text-xs text-muted-foreground" title={project.repository}>
              {project.repository}
            </p>
          </div>
          <ArrowRightIcon className="size-4 shrink-0 text-muted-foreground opacity-0 transition-all duration-300 group-hover:translate-x-0.5 group-hover:opacity-100" />
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="secondary" className="gap-1">
            <FileTextIcon /> {project.indexedFileCount} docs
          </Badge>
          <Badge variant="secondary" className="gap-1">
            <LayersIcon /> {project.chunkCount} chunks
          </Badge>
          {project.uploadCount > 0 && (
            <Badge variant="secondary" className="gap-1">
              <UploadIcon /> {project.uploadCount}
            </Badge>
          )}
          <Badge
            variant={project.hookInstalled ? 'default' : 'outline'}
            className="gap-1"
            title={project.hookInstalled ? 'Auto-sync runs on every git commit' : 'Auto-sync is off'}
          >
            <GitBranchIcon /> {project.hookInstalled ? 'Auto-sync' : 'Manual'}
          </Badge>
        </div>

        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <ClockIcon className="size-3.5" />
          Last run {timeAgo(project.lastRunAt)}
        </p>
      </div>

      <div className="flex items-center justify-between border-t bg-muted/40 px-4 py-2.5">
        <span className="truncate font-mono text-xs text-muted-foreground">{project.paths.join(', ')}</span>
        <Button size="sm" variant="outline" disabled={syncing} onClick={handleSync} className="gap-1.5">
          <RefreshCwIcon className={syncing ? 'size-3.5 animate-spin' : 'size-3.5'} />
          {syncing ? 'Syncing' : 'Sync'}
        </Button>
      </div>
    </Link>
  )
}
