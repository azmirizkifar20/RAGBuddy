import { useRef, useState, type ChangeEvent, type DragEvent } from 'react'
import { toast } from 'sonner'
import { Trash2Icon, UploadCloudIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
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
import { removeUpload, uploadDocument, type UploadedDocument } from '@/lib/api-client'
import { formatBytes, timeAgo } from '@/lib/format'
import { cn } from '@/lib/utils'

const ACCEPTED = '.md,.mdx,.txt'
/** Mirrors the server's express.json limit, minus JSON-encoding headroom. */
const MAX_BYTES = 8 * 1024 * 1024

export function UploadPanel({
  projectId,
  uploads,
  onChanged,
}: {
  projectId: string
  uploads: UploadedDocument[]
  onChanged: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    const list = [...files]
    setBusy(true)
    setProgress({ done: 0, total: list.length })

    let succeeded = 0
    for (const [index, file] of list.entries()) {
      try {
        if (file.size > MAX_BYTES) throw new Error(`${file.name} is larger than ${formatBytes(MAX_BYTES)}`)
        // Only text documents are supported, so reading as text keeps the
        // wire format plain JSON — no multipart handling needed server-side.
        const content = await file.text()
        const result = await uploadDocument(projectId, file.name, content)
        succeeded += 1
        toast.success(
          `${result.replaced ? 'Replaced' : 'Indexed'} ${result.name} — ${result.chunksIndexed} chunk(s).`,
        )
      } catch (error) {
        toast.error(error instanceof Error ? error.message : String(error))
      } finally {
        setProgress({ done: index + 1, total: list.length })
      }
    }

    setBusy(false)
    setProgress(null)
    if (inputRef.current) inputRef.current.value = ''
    if (succeeded > 0) onChanged()
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setDragging(false)
    handleFiles(event.dataTransfer.files)
  }

  async function handleRemove(name: string) {
    try {
      await removeUpload(projectId, name)
      toast.success(`Removed ${name}.`)
      onChanged()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div
        onDragOver={(event) => {
          event.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        className={cn(
          'flex flex-col items-center justify-center rounded-lg border border-dashed px-6 py-10 text-center transition-colors',
          dragging ? 'border-brand bg-muted/50' : 'hover:border-foreground/25',
          busy && 'pointer-events-none opacity-60',
        )}
      >
        <UploadCloudIcon className="mb-2.5 size-5 text-muted-foreground" />
        <p className="font-medium">
          {busy ? `Indexing ${progress?.done ?? 0}/${progress?.total ?? 0}...` : 'Drop documents here'}
        </p>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">
          Markdown or plain text ({ACCEPTED}). Files are stored by project-rag and embedded immediately — nothing is
          written into your Git repository, and a sync never removes them.
        </p>
        <Button variant="outline" size="sm" className="mt-4" onClick={() => inputRef.current?.click()}>
          Choose files
        </Button>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPTED}
          className="hidden"
          onChange={(event: ChangeEvent<HTMLInputElement>) => handleFiles(event.target.files)}
        />
      </div>

      {uploads.length > 0 && (
        <ul className="flex flex-col divide-y rounded-lg border">
          {uploads.map((upload) => (
            <li key={upload.file} className="flex items-center justify-between gap-3 px-4 py-2.5">
              <div className="min-w-0">
                <p className="truncate font-mono text-sm">{upload.name}</p>
                <p className="text-xs text-muted-foreground">
                  {formatBytes(upload.sizeBytes)} · uploaded {timeAgo(upload.uploadedAt)}
                </p>
              </div>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="ghost" size="icon" aria-label={`Remove ${upload.name}`}>
                    <Trash2Icon className="size-4 text-muted-foreground" />
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Remove "{upload.name}"?</AlertDialogTitle>
                    <AlertDialogDescription>
                      The file and its vectors are deleted permanently. This cannot be undone — re-upload the file to
                      restore it.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={() => handleRemove(upload.name)}>Remove</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
