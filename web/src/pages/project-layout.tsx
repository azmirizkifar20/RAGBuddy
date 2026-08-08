import { useCallback, useEffect, useState } from 'react'
import { NavLink, Outlet, useNavigate, useOutletContext, useParams } from 'react-router'
import { ClockIcon, DatabaseZapIcon, FilesIcon, PlugZapIcon, SearchIcon, TriangleAlertIcon } from 'lucide-react'
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
  { segment: '', label: 'Overview', icon: DatabaseZapIcon, end: true },
  { segment: '/documents', label: 'Documents', icon: FilesIcon, end: false },
  { segment: '/search', label: 'Search', icon: SearchIcon, end: false },
  { segment: '/history', label: 'History', icon: ClockIcon, end: false },
  { segment: '/mcp', label: 'MCP setup', icon: PlugZapIcon, end: false },
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
        <Skeleton className="h-12 w-72" />
        <Skeleton className="h-10 w-full max-w-md" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
        <Skeleton className="h-64" />
      </div>
    )
  }

  if (error || !project) {
    return (
      <div className="flex animate-fade-up flex-col items-center rounded-xl border border-dashed px-6 py-14 text-center">
        <TriangleAlertIcon className="mb-3 size-8 text-destructive" />
        <p className="font-heading font-medium">Could not load this project</p>
        <p className="mt-1 max-w-md text-sm text-muted-foreground">{error ?? 'Unknown error'}</p>
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
    <div>
      <PageHeader
        icon={DatabaseZapIcon}
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

      <div className="mb-6 -mx-1 overflow-x-auto px-1 pb-1">
        <div className="inline-flex w-fit items-center gap-1 rounded-xl bg-muted/60 p-1">
          {TABS.map((tab) => (
            <NavLink
              key={tab.segment}
              to={`/projects/${project.id}${tab.segment}`}
              end={tab.end}
              className={({ isActive }) =>
                cn(
                  'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-all duration-200',
                  isActive
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground',
                )
              }
            >
              <tab.icon className="size-4" />
              {tab.label}
            </NavLink>
          ))}
        </div>
      </div>

      <Outlet context={context} />
    </div>
  )
}
