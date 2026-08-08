import { Link } from 'react-router'
import { StatRow } from '@/components/stat-row'
import { HookToggle } from '@/components/hook-toggle'
import { LogStream } from '@/components/log-stream'
import { useProjectContext } from '@/pages/project-layout'
import { timeAgo } from '@/lib/format'

export function ProjectOverview() {
  const { project, documents, chunkCount, uploads, refresh, setProject } = useProjectContext()
  const repositoryDocs = documents.filter((d) => d.source === 'repository').length

  return (
    <div className="flex flex-col gap-6">
      <StatRow
        stats={[
          { label: 'Indexed docs', value: documents.length, hint: `${repositoryDocs} from the repo` },
          { label: 'Chunks', value: chunkCount, hint: 'Embedded vectors in Qdrant' },
          { label: 'Uploaded', value: uploads.length, hint: 'Stored outside the repo' },
          { label: 'Last run', value: timeAgo(project.lastRunAt), hint: 'Ingest, sync or upload' },
        ]}
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_18rem]">
        <LogStream projectId={project.id} onFinished={refresh} />

        <div className="flex flex-col gap-4">
          <HookToggle
            projectId={project.id}
            installed={project.hookInstalled}
            onChange={(hookInstalled) => setProject({ ...project, hookInstalled })}
          />

          <div className="rounded-lg border p-4">
            <p className="mb-2 text-sm font-medium">Indexed paths</p>
            <div className="flex flex-wrap gap-1.5">
              {project.paths.map((path) => (
                <code key={path} className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                  {path}
                </code>
              ))}
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Only these paths are scanned. Everything else in the repository stays invisible to agents.
            </p>
            <Link
              to={`/projects/${project.id}/documents`}
              className="mt-3 inline-block text-xs text-brand hover:underline"
            >
              Browse indexed documents →
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
