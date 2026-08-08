import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import {
  ActivityIcon,
  BoxesIcon,
  FileTextIcon,
  GitBranchIcon,
  LayersIcon,
  LayoutDashboardIcon,
  WorkflowIcon,
} from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { StatCard } from '@/components/stat-card'
import { ProjectCard } from '@/components/project-card'
import { EmptyState } from '@/components/empty-state'
import { RunList } from '@/components/run-list'
import { AddProjectModal } from '@/components/add-project-modal'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useProjects } from '@/lib/projects-context'
import { getActivity, type RunRecord } from '@/lib/api-client'

export function Dashboard() {
  const { projects, loading, error, refresh } = useProjects()
  const [activity, setActivity] = useState<RunRecord[] | null>(null)

  useEffect(() => {
    getActivity(8)
      .then(({ runs }) => setActivity(runs))
      .catch(() => setActivity([]))
  }, [projects])

  const totals = projects.reduce(
    (acc, project) => ({
      docs: acc.docs + project.indexedFileCount,
      chunks: acc.chunks + project.chunkCount,
      hooks: acc.hooks + (project.hookInstalled ? 1 : 0),
    }),
    { docs: 0, chunks: 0, hooks: 0 },
  )

  return (
    <div>
      <PageHeader
        icon={LayoutDashboardIcon}
        title="Dashboard"
        description="Every registered repository, what's indexed, and what ran recently."
        actions={
          <Button variant="outline" size="sm" asChild className="gap-1.5">
            <Link to="/flow">
              <WorkflowIcon className="size-3.5" /> How it works
            </Link>
          </Button>
        }
      />

      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

      <div className="stagger mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={BoxesIcon} label="Projects" value={projects.length} hint="Registered repositories" />
        <StatCard icon={FileTextIcon} label="Documents" value={totals.docs} tone="info" hint="Indexed across all projects" />
        <StatCard icon={LayersIcon} label="Chunks" value={totals.chunks} tone="success" hint="Embedded vectors in Qdrant" />
        <StatCard
          icon={GitBranchIcon}
          label="Auto-sync on"
          value={`${totals.hooks}/${projects.length}`}
          tone="warning"
          hint="Projects with the commit hook"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <section>
          <h2 className="mb-3 font-heading text-sm font-semibold tracking-wide uppercase">Projects</h2>
          {loading ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-40" />
              ))}
            </div>
          ) : projects.length === 0 ? (
            <EmptyState
              icon={BoxesIcon}
              title="No projects registered yet"
              description="Point project-rag at a Git repository and it will index that repo's docs into a searchable knowledge base your coding agents can query."
              action={<AddProjectModal onRegistered={() => refresh()} />}
            />
          ) : (
            <div className="stagger grid gap-3 sm:grid-cols-2">
              {projects.map((project, i) => (
                <div key={project.id} style={{ '--stagger-index': i } as React.CSSProperties}>
                  <ProjectCard project={project} onSynced={refresh} />
                </div>
              ))}
            </div>
          )}
        </section>

        <section>
          <h2 className="mb-3 font-heading text-sm font-semibold tracking-wide uppercase">Recent activity</h2>
          {activity === null ? (
            <div className="flex flex-col gap-2">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-20" />
              ))}
            </div>
          ) : activity.length === 0 ? (
            <EmptyState
              icon={ActivityIcon}
              title="Nothing has run yet"
              description="Ingests, syncs and uploads all show up here."
            />
          ) : (
            <RunList runs={activity} showProject />
          )}
        </section>
      </div>
    </div>
  )
}
