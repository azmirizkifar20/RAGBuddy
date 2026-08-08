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
    <div className="flex items-center gap-2">
      <Switch checked={installed} disabled={busy} onCheckedChange={handleToggle} />
      <span className="text-sm text-muted-foreground">Auto-sync on commit</span>
    </div>
  )
}
