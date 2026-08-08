import { BrowserRouter, Routes, Route, Navigate } from 'react-router'
import { ThemeProvider } from 'next-themes'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { AppShell } from '@/components/layout/app-shell'
import { ProjectsProvider } from '@/lib/projects-context'
import { Dashboard } from '@/pages/dashboard'
import { Projects } from '@/pages/projects'
import { ProjectLayout } from '@/pages/project-layout'
import { ProjectOverview } from '@/pages/project-overview'
import { ProjectDocuments } from '@/pages/project-documents'
import { ProjectSearch } from '@/pages/project-search'
import { ProjectHistory } from '@/pages/project-history'
import { ProjectMcp } from '@/pages/project-mcp'
import { RagFlow } from '@/pages/rag-flow'
import { Settings } from '@/pages/settings'

function App() {
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem disableTransitionOnChange>
      <TooltipProvider>
        <BrowserRouter>
          <ProjectsProvider>
            <Toaster position="bottom-right" />
            <Routes>
              <Route element={<AppShell />}>
                <Route index element={<Dashboard />} />
                <Route path="projects" element={<Projects />} />
                <Route path="projects/:id" element={<ProjectLayout />}>
                  <Route index element={<ProjectOverview />} />
                  <Route path="documents" element={<ProjectDocuments />} />
                  <Route path="search" element={<ProjectSearch />} />
                  <Route path="history" element={<ProjectHistory />} />
                  <Route path="mcp" element={<ProjectMcp />} />
                </Route>
                <Route path="flow" element={<RagFlow />} />
                <Route path="settings" element={<Settings />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Route>
            </Routes>
          </ProjectsProvider>
        </BrowserRouter>
      </TooltipProvider>
    </ThemeProvider>
  )
}

export default App
