import { useEffect, useState } from 'react'
import { Link, Outlet, useLocation } from 'react-router'
import { MenuIcon } from 'lucide-react'
import { Sidebar } from '@/components/layout/sidebar'
import { WindowControls } from '@/components/layout/window-controls'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useProjects } from '@/lib/projects-context'

const SIDEBAR_COLLAPSED_KEY = 'code-context-rag:sidebar-collapsed'

/** Human label for the current route, shown in the topbar breadcrumb. */
function useCrumbs(): { label: string; to?: string }[] {
  const { pathname } = useLocation()
  const { projects } = useProjects()
  const parts = pathname.split('/').filter(Boolean)

  if (parts.length === 0) return [{ label: 'Dashboard' }]
  if (parts[0] === 'flow') return [{ label: 'How RAG works' }]
  if (parts[0] === 'settings') return [{ label: 'Settings' }]
  if (parts[0] === 'chat') {
    const crumbs: { label: string; to?: string }[] = [{ label: 'AI Chat', to: '/chat' }]
    if (parts[1]) {
      const project = projects.find((p) => p.id === parts[1])
      crumbs.push({ label: project?.name ?? parts[1] })
    }
    return crumbs
  }
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
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1')
  const { projects } = useProjects()
  const crumbs = useCrumbs()
  // The chat page wants to fill the available width edge-to-edge (per
  // reference design) instead of sitting inside the 6xl-capped column every
  // other page uses.
  const isChatRoute = useLocation().pathname.startsWith('/chat')

  useEffect(() => {
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? '1' : '0')
  }, [collapsed])

  // The chat page must never scroll as a document — it manages its own panes,
  // and a page-level scroll would drag the topbar out of view with it. Height
  // classes alone proved fragile here, so the lock is stated on the document
  // itself and undone when leaving the route.
  useEffect(() => {
    if (!isChatRoute) return
    const { style } = document.documentElement
    const previous = style.overflow
    style.overflow = 'hidden'
    return () => {
      style.overflow = previous
    }
  }, [isChatRoute])

  return (
    <div className={cn('bg-background', isChatRoute ? 'h-svh overflow-hidden' : 'min-h-svh')}>
      <Sidebar
        projects={projects}
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        collapsed={collapsed}
        onToggleCollapsed={() => setCollapsed((c) => !c)}
      />

      {/* On the chat route the column is pinned to the viewport and the chat
          pane takes whatever is left, so no page-level scrollbar can appear
          next to the chat's own. Every other route scrolls normally. */}
      <div
        className={cn(
          'lg:pl-60',
          collapsed && 'lg:pl-16',
          isChatRoute && 'flex h-svh flex-col overflow-hidden',
        )}
      >
        <header
          className={cn(
            'app-drag-region sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-sidebar-border bg-sidebar/80 px-4 backdrop-blur-md',
            isChatRoute && 'shrink-0',
          )}
        >
          <Button
            variant="ghost"
            size="icon"
            className="app-no-drag-region lg:hidden"
            onClick={() => setMenuOpen(true)}
            aria-label="Open menu"
          >
            <MenuIcon className="size-4" />
          </Button>

          <nav className="app-no-drag-region flex min-w-0 flex-1 items-center gap-1.5 text-sm">
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

          <WindowControls />
        </header>

        {/* The chat page owns its full viewport rectangle (its own scrolling
            panes, its own edge-to-edge chrome), so it opts out of the shared
            centred column and its padding entirely. */}
        <main
          className={
            isChatRoute
              ? 'min-h-0 w-full flex-1 overflow-y-auto'
              : 'mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-8'
          }
        >
          <Outlet />
        </main>
      </div>
    </div>
  )
}
