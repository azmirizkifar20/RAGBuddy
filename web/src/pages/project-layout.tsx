import { useCallback, useEffect, useState } from 'react'
import { NavLink, Outlet, useNavigate, useOutletContext, useParams } from 'react-router'
import { PageHeader } from '@/components/layout/page-header'
import { DeleteConfirmModal } from '@/components/delete-confirm-modal'
import { Skeleton } from '@/components/ui/skeleton'
import { useProjects } from '@/lib/projects-context'
import {
  getKnowledge,
  getProject,
  listUploads,
  type IndexedDocument,
  type Project,
  type UploadedDocument,
} from '@/lib/api-client'
import { cn } from '@/lib/utils'

export interface ProjectContext {
  project: Project
  documents: IndexedDocument[]
  chunkCount: number
  uploads: UploadedDocument[]
  refresh: () => Promise<void>
  setProject: (project: Project) => void
}

export function useProjectContext(): ProjectContext {
  return useOutletContext<ProjectContext>()
}

const TABS = [
  { segment: '', label: 'Overview', end: true },
  { segment: '/documents', label: 'Documents', end: false },
  { segment: '/search', label: 'Search', end: false },
  { segment: '/chat', label: 'Chat', end: false },
  { segment: '/history', label: 'History', end: false },
  { segment: '/mcp', label: 'MCP setup', end: false },
]

export function ProjectLayout() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { refresh: refreshProjects } = useProjects()
  const [project, setProject] = useState<Project | null>(null)
  const [documents, setDocuments] = useState<IndexedDocument[]>([])
  const [chunkCount, setChunkCount] = useState(0)
  const [uploads, setUploads] = useState<UploadedDocument[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    if (!id) return
    try {
      const [projectData, knowledge, uploadList] = await Promise.all([
        getProject(id),
        getKnowledge(id),
        listUploads(id),
      ])
      setProject(projectData)
      setDocuments(knowledge.documents)
      setChunkCount(knowledge.chunkCount)
      setUploads(uploadList.uploads)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    setLoading(true)
    refresh()
  }, [refresh])

  if (!id) return null

  if (loading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-8 w-full max-w-md" />
        <Skeleton className="h-20" />
        <Skeleton className="h-64" />
      </div>
    )
  }

  if (error || !project) {
    return (
      <div className="rounded-lg border border-dashed px-6 py-12 text-center">
        <p className="font-medium">Could not load this project</p>
        <p className="mt-1 text-sm text-destructive">{error ?? 'Unknown error'}</p>
      </div>
    )
  }

  const context: ProjectContext = {
    project,
    documents,
    chunkCount,
    uploads,
    refresh: async () => {
      await refresh()
      await refreshProjects()
    },
    setProject,
  }

  return (
    <div className="animate-fade-up">
      <PageHeader
        title={project.name}
        description={<span className="font-mono text-xs break-all">{project.repository}</span>}
        actions={
          <DeleteConfirmModal
            projectId={project.id}
            projectName={project.name}
            onRemoved={() => {
              refreshProjects()
              navigate('/projects')
            }}
          />
        }
      />

      <div className="mb-6 -mx-1 overflow-x-auto border-b px-1">
        <div className="flex w-max gap-1">
          {TABS.map((tab) => (
            <NavLink
              key={tab.segment}
              to={`/projects/${project.id}${tab.segment}`}
              end={tab.end}
              className={({ isActive }) =>
                cn(
                  '-mb-px border-b-2 px-3 py-2 text-sm whitespace-nowrap transition-colors',
                  isActive
                    ? 'border-brand font-medium text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground',
                )
              }
            >
              {tab.label}
            </NavLink>
          ))}
        </div>
      </div>

      <Outlet context={context} />
    </div>
  )
}
