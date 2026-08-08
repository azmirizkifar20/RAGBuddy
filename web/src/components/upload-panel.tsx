import { useRef, useState, type ChangeEvent, type DragEvent } from 'react'
import { toast } from 'sonner'
import { FileUpIcon, Loader2Icon, Trash2Icon, UploadCloudIcon } from 'lucide-react'
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
          'relative flex flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-10 text-center transition-all duration-300',
          dragging ? 'scale-[1.01] border-brand bg-brand-soft/40' : 'border-border hover:border-brand/50',
          busy && 'pointer-events-none opacity-70',
        )}
      >
        <div
          className={cn(
            'mb-3 flex size-12 items-center justify-center rounded-2xl bg-brand-soft text-brand transition-transform duration-300',
            dragging ? 'scale-110' : 'animate-float',
          )}
        >
          {busy ? <Loader2Icon className="size-6 animate-spin" /> : <UploadCloudIcon className="size-6" />}
        </div>
        <p className="font-heading font-medium">
          {busy ? `Indexing ${progress?.done ?? 0}/${progress?.total ?? 0}...` : 'Drop documents here'}
        </p>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">
          Markdown or plain text ({ACCEPTED}). Files are stored by project-rag and embedded immediately — nothing is
          written into your Git repository, and a sync never removes them.
        </p>
        <Button variant="outline" size="sm" className="mt-4 gap-1.5" onClick={() => inputRef.current?.click()}>
          <FileUpIcon className="size-3.5" />
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
        <div className="stagger flex flex-col gap-2">
          {uploads.map((upload, i) => (
            <div
              key={upload.file}
              style={{ '--stagger-index': i } as React.CSSProperties}
              className="flex items-center justify-between gap-3 rounded-lg bg-card px-3 py-2.5 ring-1 ring-foreground/10"
            >
              <div className="flex min-w-0 items-center gap-2.5">
                <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand">
                  <FileUpIcon className="size-4" />
                </div>
                <div className="min-w-0">
                  <p className="truncate font-mono text-sm">{upload.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatBytes(upload.sizeBytes)} · uploaded {timeAgo(upload.uploadedAt)}
                  </p>
                </div>
              </div>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="ghost" size="icon" aria-label={`Remove ${upload.name}`}>
                    <Trash2Icon className="size-4 text-destructive" />
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
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
