import { BrowserRouter, Routes, Route } from 'react-router'
import { Toaster } from '@/components/ui/sonner'
import { Dashboard } from '@/pages/dashboard'
import { ProjectDetail } from '@/pages/project-detail'

function App() {
  return (
    <BrowserRouter>
      <Toaster />
      <Routes>
        <Route index element={<Dashboard />} />
        <Route path="projects/:id" element={<ProjectDetail />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
