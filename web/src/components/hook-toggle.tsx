import { useState } from 'react'
import { toast } from 'sonner'
import { GitCommitVerticalIcon } from 'lucide-react'
import { Switch } from '@/components/ui/switch'
import { installHook, uninstallHook } from '@/lib/api-client'

export function HookToggle({
  projectId,
  installed,
  onChange,
}: {
  projectId: string
  installed: boolean
  onChange: (installed: boolean) => void
}) {
  const [busy, setBusy] = useState(false)

  async function handleToggle(next: boolean) {
    setBusy(true)
    try {
      if (next) {
        await installHook(projectId)
        toast.success('Auto-sync Git hook installed.')
      } else {
        await uninstallHook(projectId)
        toast.success('Auto-sync Git hook removed.')
      }
      onChange(next)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex items-center justify-between gap-4 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <div className="flex min-w-0 items-start gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand">
          <GitCommitVerticalIcon className="size-4.5" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium">Auto-sync on commit</p>
          <p className="text-xs text-muted-foreground">
            Installs a <code className="font-mono">post-commit</code> hook that re-syncs changed docs. Never blocks a
            commit.
          </p>
        </div>
      </div>
      <Switch checked={installed} disabled={busy} onCheckedChange={handleToggle} aria-label="Auto-sync on commit" />
    </div>
  )
}
