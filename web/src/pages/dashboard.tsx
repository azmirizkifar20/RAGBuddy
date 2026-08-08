import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { BoxesIcon } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { StatRow } from '@/components/stat-row'
import { ProjectCard } from '@/components/project-card'
import { EmptyState } from '@/components/empty-state'
import { RunTable } from '@/components/run-table'
import { AddProjectModal } from '@/components/add-project-modal'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useProjects } from '@/lib/projects-context'
import { getActivity, type RunRecord } from '@/lib/api-client'

export function Dashboard() {
  const { projects, loading, error, refresh } = useProjects()
  const [activity, setActivity] = useState<RunRecord[] | null>(null)

  useEffect(() => {
    getActivity(25)
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
    <div className="animate-fade-up">
      <PageHeader
        title="Dashboard"
        description="Every registered repository, what's indexed, and what ran recently."
        actions={
          <Button variant="outline" size="sm" asChild>
            <Link to="/flow">How it works</Link>
          </Button>
        }
      />

      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

      <StatRow
        className="mb-8"
        stats={[
          { label: 'Projects', value: projects.length },
          { label: 'Documents', value: totals.docs },
          { label: 'Chunks', value: totals.chunks },
          { label: 'Auto-sync on', value: `${totals.hooks}/${projects.length}` },
        ]}
      />

      <section className="mb-8">
        <h2 className="mb-3 text-sm font-medium">Projects</h2>
        {loading ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-36" />
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
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((project) => (
              <ProjectCard key={project.id} project={project} onSynced={refresh} />
            ))}
          </div>
        )}
      </section>

      <section>
        <div className="mb-3 flex items-baseline justify-between gap-2">
          <h2 className="text-sm font-medium">Recent activity</h2>
          <span className="text-xs text-muted-foreground">Ingests, syncs and uploads across all projects</span>
        </div>
        {activity === null ? (
          <Skeleton className="h-48" />
        ) : activity.length === 0 ? (
          <p className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
            Nothing has run yet. Ingests, syncs and uploads all show up here.
          </p>
        ) : (
          <RunTable runs={activity} showProject />
        )}
      </section>
    </div>
  )
}
