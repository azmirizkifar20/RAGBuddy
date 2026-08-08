import { NavLink } from 'react-router'
import { BoxesIcon, LayoutDashboardIcon, SettingsIcon, WorkflowIcon, XIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { Project } from '@/lib/api-client'

const MAIN_NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboardIcon, end: true },
  { to: '/projects', label: 'Projects', icon: BoxesIcon, end: true },
  { to: '/flow', label: 'How RAG works', icon: WorkflowIcon, end: false },
  { to: '/settings', label: 'Settings', icon: SettingsIcon, end: false },
]

function navClasses({ isActive }: { isActive: boolean }): string {
  return cn(
    'flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors',
    isActive
      ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
      : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground',
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
  return (
    <>
      <div
        onClick={onClose}
        className={cn(
          'fixed inset-0 z-30 bg-background/70 transition-opacity lg:hidden',
          open ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
      />
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex w-60 flex-col border-r border-sidebar-border bg-sidebar transition-transform duration-200 ease-out lg:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="flex h-14 items-center gap-2 border-b border-sidebar-border px-4">
          <span className="size-2 rounded-full bg-brand" />
          <p className="flex-1 font-heading text-sm font-semibold">project-rag</p>
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={onClose} aria-label="Close menu">
            <XIcon className="size-4" />
          </Button>
        </div>

        <nav className="flex-1 overflow-y-auto p-3">
          <div className="flex flex-col gap-0.5">
            {MAIN_NAV.map((item) => (
              <NavLink key={item.to} to={item.to} end={item.end} className={navClasses} onClick={onClose}>
                <item.icon className="size-4 shrink-0" />
                {item.label}
              </NavLink>
            ))}
          </div>

          {projects.length > 0 && (
            <div className="mt-6">
              <p className="px-2.5 pb-1.5 text-xs text-muted-foreground">Projects</p>
              <div className="flex flex-col gap-0.5">
                {projects.map((project) => (
                  <NavLink
                    key={project.id}
                    to={`/projects/${project.id}`}
                    className={navClasses}
                    onClick={onClose}
                  >
                    <span
                      className={cn(
                        'size-1.5 shrink-0 rounded-full',
                        project.indexedFileCount > 0 ? 'bg-success' : 'bg-muted-foreground/40',
                      )}
                    />
                    <span className="truncate">{project.name}</span>
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
