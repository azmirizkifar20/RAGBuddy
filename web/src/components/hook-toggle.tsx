import { useState } from 'react'
import { toast } from 'sonner'
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
    <div className="flex items-start justify-between gap-4 rounded-lg border p-4">
      <div className="min-w-0">
        <p className="text-sm font-medium">Auto-sync on commit / pull / checkout</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Installs <code className="font-mono">post-commit</code>, <code className="font-mono">post-merge</code>, and{' '}
          <code className="font-mono">post-checkout</code> hooks that re-sync changed docs. Never blocks the
          underlying Git operation.
        </p>
      </div>
      <Switch
        checked={installed}
        disabled={busy}
        onCheckedChange={handleToggle}
        aria-label="Auto-sync on commit, pull, and checkout"
      />
    </div>
  )
}
