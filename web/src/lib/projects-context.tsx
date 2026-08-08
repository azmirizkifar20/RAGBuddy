import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { listProjects, type Project } from '@/lib/api-client'

interface ProjectsContextValue {
  projects: Project[]
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
}

const ProjectsContext = createContext<ProjectsContextValue | null>(null)

/**
 * One registry fetch shared by the sidebar and every page — otherwise each
 * route would re-fetch the same list and the sidebar would flicker on
 * navigation.
 */
export function ProjectsProvider({ children }: { children: ReactNode }) {
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      setProjects(await listProjects())
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const value = useMemo(
    () => ({ projects, loading, error, refresh }),
    [projects, loading, error, refresh],
  )

  return <ProjectsContext.Provider value={value}>{children}</ProjectsContext.Provider>
}

export function useProjects(): ProjectsContextValue {
  const context = useContext(ProjectsContext)
  if (!context) throw new Error('useProjects must be used inside <ProjectsProvider>')
  return context
}
