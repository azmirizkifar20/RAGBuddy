import { useState } from 'react'
import { toast } from 'sonner'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { removeProject } from '@/lib/api-client'

export function DeleteConfirmModal({
  projectId,
  projectName,
  onRemoved,
}: {
  projectId: string
  projectName: string
  onRemoved: () => void
}) {
  const [removing, setRemoving] = useState(false)

  async function handleConfirm() {
    setRemoving(true)
    try {
      await removeProject(projectId)
      toast.success(`Removed "${projectName}" from the registry.`)
      onRemoved()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setRemoving(false)
    }
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="outline" size="sm">
          Remove project
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove "{projectName}"?</AlertDialogTitle>
          <AlertDialogDescription>
            This only unregisters the project from project-rag. It does not delete any Qdrant vectors or the Git
            repository itself.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction disabled={removing} onClick={handleConfirm}>
            {removing ? 'Removing...' : 'Remove'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
