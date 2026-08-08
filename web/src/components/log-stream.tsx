import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { ingestProject, syncProject } from '@/lib/api-client'

export function LogStream({ projectId, onFinished }: { projectId: string; onFinished: () => void }) {
  const [running, setRunning] = useState<'ingest' | 'sync' | null>(null)
  const [lines, setLines] = useState<string[]>([])
  const [visible, setVisible] = useState(false)

  async function run(mode: 'ingest' | 'sync') {
    setRunning(mode)
    setLines([])
    setVisible(true)
    const runner = mode === 'ingest' ? ingestProject : syncProject
    await runner(projectId, {
      onLog: (message) => setLines((prev) => [...prev, message]),
      onDone: () => {
        toast.success(`${mode === 'ingest' ? 'Ingest' : 'Sync'} finished.`)
        setLines((prev) => [...prev, `${mode === 'ingest' ? 'Ingest' : 'Sync'} completed.`])
        setRunning(null)
        onFinished()
      },
      onError: (message) => {
        toast.error(message)
        setLines((prev) => [...prev, `Error: ${message}`])
        setRunning(null)
      },
    })
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2">
        <Button variant="outline" disabled={running !== null} onClick={() => run('ingest')}>
          {running === 'ingest' ? 'Ingesting...' : 'Ingest'}
        </Button>
        <Button variant="outline" disabled={running !== null} onClick={() => run('sync')}>
          {running === 'sync' ? 'Syncing...' : 'Sync'}
        </Button>
      </div>
      {visible && (
        <ScrollArea className="h-48 animate-in fade-in slide-in-from-top-1 rounded-lg border bg-black p-3 font-mono text-xs text-green-400 duration-150">
          {lines.map((line, i) => (
            <div key={i}>{line}</div>
          ))}
        </ScrollArea>
      )}
    </div>
  )
}
