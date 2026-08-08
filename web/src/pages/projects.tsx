import { useMemo, useState } from 'react'
import { BoxesIcon, SearchIcon } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { ProjectCard } from '@/components/project-card'
import { EmptyState } from '@/components/empty-state'
import { AddProjectModal } from '@/components/add-project-modal'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { useProjects } from '@/lib/projects-context'

export function Projects() {
  const { projects, loading, error, refresh } = useProjects()
  const [query, setQuery] = useState('')

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return projects
    return projects.filter(
      (p) =>
        p.name.toLowerCase().includes(needle) ||
        p.id.toLowerCase().includes(needle) ||
        p.repository.toLowerCase().includes(needle),
    )
  }, [projects, query])

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Projects"
        description={`${projects.length} ${projects.length === 1 ? 'repository' : 'repositories'} registered with project-rag.`}
        actions={<AddProjectModal onRegistered={() => refresh()} />}
      />

      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

      {projects.length > 0 && (
        <div className="relative mb-4 max-w-sm">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter projects..."
            className="pl-9"
          />
        </div>
      )}

      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-36" />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <EmptyState
          icon={BoxesIcon}
          title={projects.length === 0 ? 'No projects registered yet' : 'No projects match that filter'}
          description={
            projects.length === 0
              ? 'Register a Git repository to start indexing its documentation.'
              : 'Try a different search term.'
          }
          action={projects.length === 0 ? <AddProjectModal onRegistered={() => refresh()} /> : undefined}
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((project) => (
            <ProjectCard key={project.id} project={project} onSynced={refresh} />
          ))}
        </div>
      )}
    </div>
  )
}
