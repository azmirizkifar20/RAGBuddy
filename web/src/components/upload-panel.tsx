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
import { removeUpload, streamUploadDocument, type UploadedDocument, type UploadResult } from '@/lib/api-client'
import { formatBytes, timeAgo } from '@/lib/format'
import { cn } from '@/lib/utils'

const ACCEPTED = '.pdf,.docx,.xlsx,.xlsm,.md,.mdx,.markdown,.txt,.text,.log,.rst,.adoc,.csv,.tsv,.json,.yaml,.yml'
/**
 * The server's express.json limit is 32MB and base64 inflates a file by ~33%,
 * so 20MB of real bytes is the most that can fit through.
 */
const MAX_BYTES = 20 * 1024 * 1024

/**
 * FileReader is used rather than btoa(String.fromCharCode(...bytes)) because
 * spreading a multi-megabyte byte array blows the call stack.
 */
function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error(`Could not read ${file.name}`))
    reader.onload = () => {
      const result = String(reader.result)
      const comma = result.indexOf(',')
      resolve(comma === -1 ? '' : result.slice(comma + 1))
    }
    reader.readAsDataURL(file)
  })
}

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
  const [queue, setQueue] = useState<{ index: number; total: number } | null>(null)
  const [stage, setStage] = useState<string | null>(null)
  const [chunkProgress, setChunkProgress] = useState<{ done: number; total: number } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  function uploadOne(file: File, base64: string): Promise<UploadResult> {
    return new Promise((resolve, reject) => {
      streamUploadDocument(projectId, file.name, base64, {
        onLog: setStage,
        onProgress: (done, total) => setChunkProgress({ done, total }),
        onDone: resolve,
        onError: (message) => reject(new Error(message)),
      })
    })
  }

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    const list = [...files]
    setBusy(true)

    let succeeded = 0
    for (const [index, file] of list.entries()) {
      setQueue({ index, total: list.length })
      setStage('Reading file...')
      setChunkProgress(null)
      try {
        if (file.size > MAX_BYTES) throw new Error(`${file.name} is larger than ${formatBytes(MAX_BYTES)}`)
        const result = await uploadOne(file, await readAsBase64(file))
        succeeded += 1
        toast.success(
          `${result.replaced ? 'Replaced' : 'Indexed'} ${result.name} — ${result.chunksIndexed} chunk(s).`,
          result.truncated
            ? { description: 'The document was very long and was truncated before indexing.' }
            : undefined,
        )
      } catch (error) {
        toast.error(error instanceof Error ? error.message : String(error))
      }
    }

    setBusy(false)
    setQueue(null)
    setStage(null)
    setChunkProgress(null)
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
        onClick={() => inputRef.current?.click()}
        className={cn(
          'flex cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed px-6 py-10 text-center transition-colors',
          dragging ? 'border-brand bg-muted/50' : 'hover:border-foreground/25',
          busy && 'pointer-events-none opacity-60',
        )}
      >
        <UploadCloudIcon className="mb-2.5 size-5 text-muted-foreground" />
        <p className="font-medium">
          {busy
            ? `${queue && queue.total > 1 ? `File ${queue.index + 1}/${queue.total} — ` : ''}${stage ?? 'Starting...'}`
            : 'Drop documents here'}
        </p>
        {busy && (
          <div className="mt-3 h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-muted" role="progressbar">
            {chunkProgress ? (
              <div
                className="h-full rounded-full bg-brand transition-[width] duration-300 ease-out"
                style={{ width: `${Math.round((chunkProgress.done / chunkProgress.total) * 100)}%` }}
              />
            ) : (
              <div className="progress-bar-indeterminate h-full rounded-full bg-brand" />
            )}
          </div>
        )}
        {!busy && (
          <p className="mt-1 max-w-md text-sm text-muted-foreground">
            PDF, Word (.docx), Excel (.xlsx), Markdown, CSV and plain text. Text is extracted server-side and
            embedded immediately — the original file is kept, nothing is written into your Git repository, and a
            sync never removes them.
          </p>
        )}
        {/* No handler of its own — the click bubbles to the drop zone, which is
            the single place that opens the picker. */}
        {!busy && (
          <Button variant="outline" size="sm" type="button" className="mt-4">
            Choose files
          </Button>
        )}
      </div>

      {/*
        Deliberately a sibling of the drop zone, not a child: inputRef.click()
        dispatches a real click event, and from inside the zone that event
        would bubble straight back into the zone's own onClick.
      */}
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPTED}
        className="hidden"
        onChange={(event: ChangeEvent<HTMLInputElement>) => handleFiles(event.target.files)}
      />

      {uploads.length > 0 && (
        <ul className="flex flex-col divide-y rounded-lg border">
          {uploads.map((upload) => (
            <li key={upload.file} className="flex items-center justify-between gap-3 px-4 py-2.5">
              <div className="min-w-0">
                <p className="truncate font-mono text-sm">{upload.name}</p>
                <p className="text-xs text-muted-foreground">
                  {upload.documentType} · {formatBytes(upload.sizeBytes)} · uploaded {timeAgo(upload.uploadedAt)}
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
