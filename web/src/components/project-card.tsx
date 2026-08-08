import { useState, type MouseEvent } from 'react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { syncProject, type Project } from '@/lib/api-client'

export function ProjectCard({ project }: { project: Project }) {
  const [syncing, setSyncing] = useState(false)

  async function handleSync(event: MouseEvent) {
    event.preventDefault()
    setSyncing(true)
    try {
      await syncProject(project.id, {
        onLog: () => {},
        onDone: () => toast.success(`Sync finished for "${project.name}".`),
        onError: (message) => toast.error(message),
      })
    } finally {
      setSyncing(false)
    }
  }

  return (
    <Link to={`/projects/${project.id}`}>
      <Card className="transition-colors hover:bg-muted/50">
        <CardHeader>
          <CardTitle>{project.name}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="truncate text-sm text-muted-foreground">{project.repository}</p>
          <div className="flex items-center gap-2">
            <Badge variant="secondary">{project.indexedFileCount} files indexed</Badge>
            <Badge variant={project.hookInstalled ? 'default' : 'outline'}>
              {project.hookInstalled ? 'Auto-sync on' : 'Auto-sync off'}
            </Badge>
          </div>
        </CardContent>
        <CardFooter>
          <Button size="sm" variant="outline" disabled={syncing} onClick={handleSync}>
            {syncing ? 'Syncing...' : 'Sync'}
          </Button>
        </CardFooter>
      </Card>
    </Link>
  )
}
