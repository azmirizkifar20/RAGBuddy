import { SearchPanel } from '@/components/search-panel'
import { useProjectContext } from '@/pages/project-layout'

export function ProjectSearch() {
  const { project } = useProjectContext()

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        This runs the exact same retrieval path an agent hits through the MCP{' '}
        <code className="font-mono text-foreground">search_project_docs</code> tool — same embedding model, same project
        filter, same top-K. Use it to sanity-check what your agent will actually see.
      </p>

      <SearchPanel projectId={project.id} />
    </div>
  )
}
