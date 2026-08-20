import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { login } from '@/lib/api-client'

export function LoginScreen({ onSuccess }: { onSuccess: () => void }) {
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await login(code)
      onSuccess()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-svh items-center justify-center bg-background px-4">
      <form onSubmit={handleSubmit} className="flex w-full max-w-sm flex-col gap-4 rounded-lg border p-6">
        <div>
          <h1 className="font-heading text-lg font-semibold">RAGBuddy</h1>
          <p className="text-sm text-muted-foreground">Enter the access code to continue.</p>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="access-code">Access code</Label>
          <Input
            id="access-code"
            type="password"
            autoFocus
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="submit" disabled={busy || !code}>
          {busy ? 'Checking…' : 'Continue'}
        </Button>
      </form>
    </div>
  )
}
