import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { DeleteConfirmModal } from '@/components/delete-confirm-modal'
import { HookToggle } from '@/components/hook-toggle'
import { LogStream } from '@/components/log-stream'
import { SearchPanel } from '@/components/search-panel'
import { ScrollArea } from '@/components/ui/scroll-area'
import { getKnowledge, getProject, type Project } from '@/lib/api-client'

export function ProjectDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [project, setProject] = useState<Project | null>(null)
  const [files, setFiles] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!id) return
    try {
      const [projectData, knowledge] = await Promise.all([getProject(id), getKnowledge(id)])
      setProject(projectData)
      setFiles(knowledge.files)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [id])

  useEffect(() => {
    refresh()
  }, [refresh])

  if (!id) return null
  if (error) return <p className="p-6 text-sm text-destructive">{error}</p>
  if (!project) return <p className="p-6 text-sm text-muted-foreground">Loading...</p>

  return (
    <div className="mx-auto max-w-5xl p-6">
      <Link to="/" className="text-sm text-muted-foreground hover:underline">
        &larr; Back to dashboard
      </Link>

      <div className="mt-2 mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-medium">{project.name}</h1>
          <p className="text-sm text-muted-foreground">{project.repository}</p>
        </div>
        <DeleteConfirmModal projectId={project.id} projectName={project.name} onRemoved={() => navigate('/')} />
      </div>

      <div className="mb-6">
        <HookToggle
          projectId={project.id}
          installed={project.hookInstalled}
          onChange={(installed) => setProject({ ...project, hookInstalled: installed })}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <div>
          <h2 className="mb-2 text-sm font-medium">Indexed files ({files.length})</h2>
          <ScrollArea className="h-64 rounded-lg border">
            <div className="flex flex-col divide-y">
              {files.map((file) => (
                <div key={file} className="p-2 font-mono text-xs">
                  {file}
                </div>
              ))}
            </div>
          </ScrollArea>
        </div>
        <div>
          <h2 className="mb-2 text-sm font-medium">Search</h2>
          <SearchPanel projectId={project.id} />
        </div>
      </div>

      <div className="mt-6">
        <h2 className="mb-2 text-sm font-medium">Ingest / Sync</h2>
        <LogStream projectId={project.id} onFinished={() => refresh()} />
      </div>
    </div>
  )
}
