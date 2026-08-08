import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { DownloadCloudIcon, RefreshCwIcon, TerminalIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { ingestProject, syncProject } from '@/lib/api-client'
import { cn } from '@/lib/utils'

type Mode = 'ingest' | 'sync'
interface Line {
  text: string
  tone: 'log' | 'ok' | 'error'
}

export function LogStream({ projectId, onFinished }: { projectId: string; onFinished: () => void }) {
  const [running, setRunning] = useState<Mode | null>(null)
  const [lines, setLines] = useState<Line[]>([])
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [lines])

  async function run(mode: Mode) {
    setRunning(mode)
    setLines([{ text: `$ project-rag ${mode} ${projectId}`, tone: 'log' }])
    const runner = mode === 'ingest' ? ingestProject : syncProject
    const label = mode === 'ingest' ? 'Ingest' : 'Sync'

    await runner(projectId, {
      onLog: (message) => setLines((prev) => [...prev, { text: message, tone: 'log' }]),
      onDone: () => {
        toast.success(`${label} finished.`)
        setLines((prev) => [...prev, { text: `${label} completed.`, tone: 'ok' }])
        setRunning(null)
        onFinished()
      },
      onError: (message) => {
        toast.error(message)
        setLines((prev) => [...prev, { text: `Error: ${message}`, tone: 'error' }])
        setRunning(null)
      },
    })
  }

  return (
    <div className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b p-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <TerminalIcon className="size-4 text-brand" />
          Indexing console
          {running && (
            <span className="flex items-center gap-1.5 text-xs font-normal text-muted-foreground">
              <span className="size-1.5 animate-pulse-glow rounded-full bg-brand" />
              running
            </span>
          )}
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" disabled={running !== null} onClick={() => run('ingest')} className="gap-1.5">
            <DownloadCloudIcon className="size-3.5" />
            {running === 'ingest' ? 'Ingesting...' : 'Full ingest'}
          </Button>
          <Button size="sm" disabled={running !== null} onClick={() => run('sync')} className="gap-1.5">
            <RefreshCwIcon className={cn('size-3.5', running === 'sync' && 'animate-spin')} />
            {running === 'sync' ? 'Syncing...' : 'Sync'}
          </Button>
        </div>
      </div>

      {lines.length === 0 ? (
        <p className="p-4 text-sm text-muted-foreground">
          <strong className="font-medium text-foreground">Sync</strong> only re-embeds changed files.{' '}
          <strong className="font-medium text-foreground">Full ingest</strong> rebuilds every repository document from
          scratch — uploaded documents are left untouched.
        </p>
      ) : (
        <ScrollArea className="h-56 bg-[oklch(0.16_0.012_285)] p-3 font-mono text-xs">
          {lines.map((line, i) => (
            <div
              key={i}
              className={cn(
                'animate-fade-in py-0.5 break-all',
                line.tone === 'error' && 'text-red-400',
                line.tone === 'ok' && 'text-emerald-400',
                line.tone === 'log' && 'text-emerald-200/80',
              )}
            >
              {line.text}
            </div>
          ))}
          {running && <span className="inline-block animate-blink text-emerald-400">▋</span>}
          <div ref={bottomRef} />
        </ScrollArea>
      )}
    </div>
  )
}
