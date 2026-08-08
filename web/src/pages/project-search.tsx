import { SparklesIcon } from 'lucide-react'
import { SearchPanel } from '@/components/search-panel'
import { useProjectContext } from '@/pages/project-layout'

export function ProjectSearch() {
  const { project } = useProjectContext()

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-3 rounded-xl bg-brand-soft/50 p-4 ring-1 ring-brand/15">
        <SparklesIcon className="mt-0.5 size-4 shrink-0 text-brand" />
        <p className="text-sm text-muted-foreground">
          This runs the exact same retrieval path an agent hits through the MCP{' '}
          <code className="font-mono text-foreground">search_project_docs</code> tool — same embedding model, same
          project filter, same top-K. Use it to sanity-check what your agent will actually see.
        </p>
      </div>

      <SearchPanel projectId={project.id} />
    </div>
  )
}
