import { useState, type FormEvent, type ReactNode } from 'react'
import { toast } from 'sonner'
import { PlusIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { FolderPicker } from '@/components/folder-picker'
import { registerProject, type Project } from '@/lib/api-client'

function fieldForError(message: string): 'id' | 'repository' | 'paths' | 'general' {
  if (message.includes('already registered')) return 'id'
  if (message.includes('Repository path does not exist') || message.includes('Not a Git repository')) {
    return 'repository'
  }
  if (message.includes('path to index is required')) return 'paths'
  return 'general'
}

export function AddProjectModal({
  onRegistered,
  trigger,
}: {
  onRegistered: (project: Project) => void
  trigger?: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [repository, setRepository] = useState('')
  const [errors, setErrors] = useState<{ id?: string; repository?: string; paths?: string; general?: string }>({})

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    // `currentTarget` is nulled once the handler's synchronous part returns,
    // so the form element has to be captured before the first await.
    const formElement = event.currentTarget
    setErrors({})
    setSubmitting(true)

    const form = new FormData(formElement)
    const id = String(form.get('id') ?? '').trim()
    const name = String(form.get('name') ?? '').trim()
    const pathsRaw = String(form.get('paths') ?? '').trim()
    const paths = pathsRaw.split(',').map((p) => p.trim()).filter(Boolean)

    if (paths.length === 0) {
      setErrors({ paths: 'At least one path to index is required.' })
      setSubmitting(false)
      return
    }

    try {
      const project = await registerProject({
        id,
        repository: repository.trim(),
        name: name || undefined,
        paths,
      })
      toast.success(`Registered "${project.name}".`)
      onRegistered(project)
      setOpen(false)
      formElement.reset()
      setRepository('')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setErrors({ [fieldForError(message)]: message })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button className="gap-1.5">
            <PlusIcon className="size-4" /> Add project
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Register a project</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-4">
            <div className="grid gap-1.5">
              <Label htmlFor="id">Project ID</Label>
              <Input id="id" name="id" required placeholder="my-project" />
              <p className="text-xs text-muted-foreground">
                Used by agents and the CLI — lowercase, no spaces.
              </p>
              {errors.id && <p className="text-sm text-destructive">{errors.id}</p>}
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="repository">Repository path</Label>
              <div className="flex gap-1.5">
                <Input
                  id="repository"
                  name="repository"
                  required
                  placeholder="D:\projects\my-project"
                  value={repository}
                  onChange={(event) => setRepository(event.target.value)}
                  className="flex-1"
                />
                <FolderPicker initialPath={repository} onSelect={setRepository} />
              </div>
              <p className="text-xs text-muted-foreground">
                Absolute path to a Git repository on this machine.
              </p>
              {errors.repository && <p className="text-sm text-destructive">{errors.repository}</p>}
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="name">Display name (optional)</Label>
              <Input id="name" name="name" placeholder="My Project" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="paths">Paths to index</Label>
              <Input id="paths" name="paths" required placeholder="docs,notes" />
              <p className="text-xs text-muted-foreground">
                Comma-separated, relative to the repository root. At least one is required.
              </p>
              {errors.paths && <p className="text-sm text-destructive">{errors.paths}</p>}
            </div>
            {errors.general && <p className="text-sm text-destructive">{errors.general}</p>}
          </div>
          <DialogFooter>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Registering...' : 'Register'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
