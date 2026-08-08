import { NavLink, useParams } from 'react-router'
import {
  BoxesIcon,
  ClockIcon,
  DatabaseZapIcon,
  FilesIcon,
  GitBranchIcon,
  LayoutDashboardIcon,
  PlugZapIcon,
  SearchIcon,
  SettingsIcon,
  WorkflowIcon,
  XIcon,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import type { Project } from '@/lib/api-client'

const MAIN_NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboardIcon, end: true },
  { to: '/projects', label: 'Projects', icon: BoxesIcon, end: false },
  { to: '/flow', label: 'How RAG works', icon: WorkflowIcon, end: false },
  { to: '/settings', label: 'Settings', icon: SettingsIcon, end: false },
]

const PROJECT_NAV = [
  { segment: '', label: 'Overview', icon: DatabaseZapIcon, end: true },
  { segment: '/documents', label: 'Documents', icon: FilesIcon, end: false },
  { segment: '/search', label: 'Search', icon: SearchIcon, end: false },
  { segment: '/history', label: 'Sync history', icon: ClockIcon, end: false },
  { segment: '/mcp', label: 'MCP setup', icon: PlugZapIcon, end: false },
]

function navClasses({ isActive }: { isActive: boolean }): string {
  return cn(
    'group relative flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-200',
    isActive
      ? 'bg-sidebar-accent text-sidebar-accent-foreground'
      : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground hover:translate-x-0.5',
  )
}

function ActiveBar({ show }: { show: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        'absolute top-1/2 left-0 h-5 w-0.5 -translate-x-2 -translate-y-1/2 rounded-full bg-brand transition-all duration-200',
        show ? 'opacity-100' : 'opacity-0',
      )}
    />
  )
}

export function Sidebar({
  projects,
  open,
  onClose,
}: {
  projects: Project[]
  open: boolean
  onClose: () => void
}) {
  const { id } = useParams<{ id: string }>()
  const activeProject = projects.find((p) => p.id === id)

  return (
    <>
      <div
        onClick={onClose}
        className={cn(
          'fixed inset-0 z-30 bg-background/70 backdrop-blur-sm transition-opacity lg:hidden',
          open ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
      />
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-sidebar-border bg-sidebar transition-transform duration-300 ease-out lg:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="grid-bg relative flex items-center gap-2.5 px-4 py-4">
          <div className="flex size-9 items-center justify-center rounded-xl bg-linear-to-br from-brand to-accent-cyan text-white shadow-sm">
            <DatabaseZapIcon className="size-4.5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-heading text-sm font-semibold">project-rag</p>
            <p className="truncate text-xs text-muted-foreground">Multi-project knowledge base</p>
          </div>
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={onClose} aria-label="Close menu">
            <XIcon className="size-4" />
          </Button>
        </div>

        <Separator />

        <nav className="flex-1 overflow-y-auto p-3">
          <p className="px-3 pb-1.5 text-[11px] font-semibold tracking-wider text-muted-foreground/70 uppercase">
            Workspace
          </p>
          <div className="flex flex-col gap-0.5">
            {MAIN_NAV.map((item) => (
              <NavLink key={item.to} to={item.to} end={item.end} className={navClasses} onClick={onClose}>
                {({ isActive }) => (
                  <>
                    <ActiveBar show={isActive} />
                    <item.icon className="size-4 shrink-0" />
                    {item.label}
                  </>
                )}
              </NavLink>
            ))}
          </div>

          {activeProject && (
            <div className="mt-5 animate-fade-up">
              <p className="px-3 pb-1.5 text-[11px] font-semibold tracking-wider text-muted-foreground/70 uppercase">
                Current project
              </p>
              <div className="mb-1.5 rounded-lg bg-brand-soft/60 px-3 py-2">
                <p className="truncate text-sm font-medium">{activeProject.name}</p>
                <div className="mt-1 flex flex-wrap items-center gap-1">
                  <Badge variant="secondary" className="font-mono">
                    {activeProject.indexedFileCount} docs
                  </Badge>
                  {activeProject.hookInstalled && (
                    <Badge variant="outline" className="gap-1">
                      <GitBranchIcon /> auto
                    </Badge>
                  )}
                </div>
              </div>
              <div className="flex flex-col gap-0.5">
                {PROJECT_NAV.map((item) => (
                  <NavLink
                    key={item.segment}
                    to={`/projects/${activeProject.id}${item.segment}`}
                    end={item.end}
                    className={navClasses}
                    onClick={onClose}
                  >
                    {({ isActive }) => (
                      <>
                        <ActiveBar show={isActive} />
                        <item.icon className="size-4 shrink-0" />
                        {item.label}
                      </>
                    )}
                  </NavLink>
                ))}
              </div>
            </div>
          )}

          {projects.length > 0 && (
            <div className="mt-5">
              <p className="px-3 pb-1.5 text-[11px] font-semibold tracking-wider text-muted-foreground/70 uppercase">
                All projects
              </p>
              <div className="flex flex-col gap-0.5">
                {projects.map((project) => (
                  <NavLink
                    key={project.id}
                    to={`/projects/${project.id}`}
                    end
                    className={navClasses}
                    onClick={onClose}
                  >
                    {({ isActive }) => (
                      <>
                        <ActiveBar show={isActive} />
                        <span
                          className={cn(
                            'size-1.5 shrink-0 rounded-full',
                            project.indexedFileCount > 0 ? 'bg-success' : 'bg-muted-foreground/40',
                          )}
                        />
                        <span className="truncate">{project.name}</span>
                      </>
                    )}
                  </NavLink>
                ))}
              </div>
            </div>
          )}
        </nav>
      </aside>
    </>
  )
}
