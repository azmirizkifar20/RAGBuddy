import { useState } from 'react'
import { Link, Outlet, useLocation } from 'react-router'
import { MenuIcon, PlusIcon } from 'lucide-react'
import { Sidebar } from '@/components/layout/sidebar'
import { ThemeToggle } from '@/components/layout/theme-toggle'
import { AddProjectModal } from '@/components/add-project-modal'
import { Button } from '@/components/ui/button'
import { useProjects } from '@/lib/projects-context'

/** Human label for the current route, shown in the topbar breadcrumb. */
function useCrumbs(): { label: string; to?: string }[] {
  const { pathname } = useLocation()
  const { projects } = useProjects()
  const parts = pathname.split('/').filter(Boolean)

  if (parts.length === 0) return [{ label: 'Dashboard' }]
  if (parts[0] === 'flow') return [{ label: 'How RAG works' }]
  if (parts[0] === 'settings') return [{ label: 'Settings' }]
  if (parts[0] !== 'projects') return [{ label: parts[0] }]

  const crumbs: { label: string; to?: string }[] = [{ label: 'Projects', to: '/projects' }]
  if (parts[1]) {
    const project = projects.find((p) => p.id === parts[1])
    crumbs.push({ label: project?.name ?? parts[1], to: `/projects/${parts[1]}` })
  }
  const tail: Record<string, string> = {
    documents: 'Documents',
    search: 'Search',
    history: 'Sync history',
    mcp: 'MCP setup',
  }
  if (parts[2] && tail[parts[2]]) crumbs.push({ label: tail[parts[2]] })
  return crumbs
}

export function AppShell() {
  const [menuOpen, setMenuOpen] = useState(false)
  const { projects, refresh } = useProjects()
  const crumbs = useCrumbs()

  return (
    <div className="min-h-svh bg-background">
      <Sidebar projects={projects} open={menuOpen} onClose={() => setMenuOpen(false)} />

      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b bg-background/80 px-4 backdrop-blur-md">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            onClick={() => setMenuOpen(true)}
            aria-label="Open menu"
          >
            <MenuIcon className="size-4" />
          </Button>

          <nav className="flex min-w-0 flex-1 items-center gap-1.5 text-sm">
            {crumbs.map((crumb, i) => (
              <span key={`${crumb.label}-${i}`} className="flex min-w-0 items-center gap-1.5">
                {i > 0 && <span className="text-muted-foreground/50">/</span>}
                {crumb.to && i < crumbs.length - 1 ? (
                  <Link to={crumb.to} className="truncate text-muted-foreground transition-colors hover:text-foreground">
                    {crumb.label}
                  </Link>
                ) : (
                  <span className="truncate font-medium">{crumb.label}</span>
                )}
              </span>
            ))}
          </nav>

          <ThemeToggle />
          <AddProjectModal
            onRegistered={() => refresh()}
            trigger={
              <Button size="sm" className="gap-1.5">
                <PlusIcon className="size-4" />
                <span className="hidden sm:inline">Add project</span>
              </Button>
            }
          />
        </header>

        <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
