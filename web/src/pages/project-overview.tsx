import { Link } from 'react-router'
import { ClockIcon, FileTextIcon, FolderTreeIcon, LayersIcon, UploadIcon } from 'lucide-react'
import { StatCard } from '@/components/stat-card'
import { HookToggle } from '@/components/hook-toggle'
import { LogStream } from '@/components/log-stream'
import { Badge } from '@/components/ui/badge'
import { useProjectContext } from '@/pages/project-layout'
import { timeAgo } from '@/lib/format'

export function ProjectOverview() {
  const { project, documents, chunkCount, uploads, refresh, setProject } = useProjectContext()
  const repositoryDocs = documents.filter((d) => d.source === 'repository').length

  return (
    <div className="flex flex-col gap-6">
      <div className="stagger grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={FileTextIcon} label="Indexed docs" value={documents.length} hint={`${repositoryDocs} from the repo`} />
        <StatCard icon={LayersIcon} label="Chunks" value={chunkCount} tone="info" hint="Embedded vectors in Qdrant" />
        <StatCard icon={UploadIcon} label="Uploaded" value={uploads.length} tone="success" hint="Stored outside the repo" />
        <StatCard icon={ClockIcon} label="Last run" value={timeAgo(project.lastRunAt)} tone="warning" hint="Ingest, sync or upload" />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <LogStream projectId={project.id} onFinished={refresh} />

        <div className="flex flex-col gap-4">
          <HookToggle
            projectId={project.id}
            installed={project.hookInstalled}
            onChange={(hookInstalled) => setProject({ ...project, hookInstalled })}
          />

          <div className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
            <div className="mb-2 flex items-center gap-2 text-sm font-medium">
              <FolderTreeIcon className="size-4 text-brand" />
              Indexed paths
            </div>
            <div className="flex flex-wrap gap-1.5">
              {project.paths.map((path) => (
                <Badge key={path} variant="secondary" className="font-mono">
                  {path}
                </Badge>
              ))}
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Only these paths are scanned. Everything else in the repository stays invisible to agents.
            </p>
            <Link
              to={`/projects/${project.id}/documents`}
              className="mt-3 inline-block text-xs font-medium text-brand hover:underline"
            >
              Browse indexed documents →
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
