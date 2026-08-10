import { useState } from 'react'
import { toast } from 'sonner'
import { CheckCircle2Icon, XCircleIcon, PlusIcon, Trash2Icon, PencilIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
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
import {
  getCredentials,
  addCredential,
  updateCredential,
  removeCredential,
  activateCredential,
  testCredentialConnection,
  type CredentialsList,
  type Credential,
  type CredentialProvider,
  type ConnectionTestResult,
} from '@/lib/api-client'

interface CredentialFormValue {
  name: string
  provider: CredentialProvider
  baseUrl: string
  apiKey: string
  modelsText: string
}

function toModelsArray(text: string): string[] {
  return text
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean)
}

function TestResultLine({ result }: { result: ConnectionTestResult | null }) {
  if (!result) return null
  return (
    <p className={`flex items-center gap-1.5 text-sm ${result.ok ? 'text-success' : 'text-destructive'}`}>
      {result.ok ? (
        <>
          <CheckCircle2Icon className="size-4 shrink-0" />
          Connected in {result.latencyMs}ms.
        </>
      ) : (
        <>
          <XCircleIcon className="size-4 shrink-0" />
          {result.error}
        </>
      )}
    </p>
  )
}

function CredentialForm({
  kind,
  initial,
  submitLabel,
  onCancel,
  onSubmit,
}: {
  kind: 'embedding' | 'chat'
  initial: CredentialFormValue
  submitLabel: string
  onCancel: () => void
  onSubmit: (input: { name: string; provider: CredentialProvider; baseUrl: string; apiKey?: string; models: string[] }) => Promise<void>
}) {
  const [form, setForm] = useState(initial)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null)

  const models = toModelsArray(form.modelsText)
  const canSubmit = form.name.trim() !== '' && form.baseUrl.trim() !== '' && models.length > 0

  async function handleSubmit() {
    setSaving(true)
    try {
      await onSubmit({
        name: form.name.trim(),
        provider: form.provider,
        baseUrl: form.baseUrl.trim(),
        apiKey: form.apiKey || undefined,
        models,
      })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  async function handleTest() {
    setTesting(true)
    setTestResult(null)
    try {
      const model = models[0]
      if (!model) {
        setTestResult({ ok: false, error: 'Add at least one model first.' })
        return
      }
      setTestResult(await testCredentialConnection(kind, { provider: form.provider, baseUrl: form.baseUrl.trim(), model, apiKey: form.apiKey || undefined }))
    } catch (err) {
      setTestResult({ ok: false, error: err instanceof Error ? err.message : String(err) })
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label>Name</Label>
          <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. Gemini proxy" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Provider</Label>
          <Select value={form.provider} onChange={(e) => setForm((f) => ({ ...f, provider: e.target.value as CredentialProvider }))}>
            <option value="ollama">Ollama</option>
            <option value="openai">OpenAI-compatible</option>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Label>Base URL</Label>
          <Input value={form.baseUrl} onChange={(e) => setForm((f) => ({ ...f, baseUrl: e.target.value }))} placeholder="http://localhost:11434" />
        </div>
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Label>API key</Label>
          <Input
            type="password"
            value={form.apiKey}
            onChange={(e) => setForm((f) => ({ ...f, apiKey: e.target.value }))}
            placeholder="Only needed for OpenAI-compatible"
          />
        </div>
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Label>Models (comma-separated)</Label>
          <Input
            value={form.modelsText}
            onChange={(e) => setForm((f) => ({ ...f, modelsText: e.target.value }))}
            placeholder="bge-m3, nomic-embed-text"
          />
        </div>
      </div>

      <TestResultLine result={testResult} />

      <div className="flex items-center gap-2">
        <Button size="sm" onClick={handleSubmit} disabled={!canSubmit || saving}>
          {saving ? 'Saving…' : submitLabel}
        </Button>
        <Button size="sm" variant="outline" onClick={handleTest} disabled={!form.baseUrl.trim() || testing}>
          {testing ? 'Testing…' : 'Test connection'}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

function ModelChip({
  model,
  isActive,
  warnOnSwitch,
  onActivate,
}: {
  model: string
  isActive: boolean
  warnOnSwitch?: boolean
  onActivate: () => Promise<void>
}) {
  const [activating, setActivating] = useState(false)

  async function activate() {
    setActivating(true)
    try {
      await onActivate()
    } finally {
      setActivating(false)
    }
  }

  const chip = (
    <button
      type="button"
      disabled={isActive || activating}
      onClick={warnOnSwitch ? undefined : activate}
      className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
        isActive
          ? 'border-brand bg-brand/10 text-brand font-medium'
          : 'text-muted-foreground hover:border-foreground/25 hover:text-foreground disabled:opacity-50'
      }`}
    >
      {model}
      {isActive ? ' (active)' : ''}
    </button>
  )

  if (isActive || !warnOnSwitch) return chip

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>{chip}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Switch embedding model to "{model}"?</AlertDialogTitle>
          <AlertDialogDescription>
            A different embedding model likely produces vectors of a different size than the ones already indexed.
            RAG search and chat context will look broken until every project is re-ingested (or the Qdrant
            collection is dropped and rebuilt). This does not happen automatically.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={activate}>Switch anyway</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function CredentialRow({
  kind,
  credential,
  isActive,
  activeModel,
  warnOnSwitch,
  onActivateModel,
  onSaved,
  onRemoved,
}: {
  kind: 'embedding' | 'chat'
  credential: Credential
  isActive: boolean
  activeModel: string | null
  warnOnSwitch?: boolean
  onActivateModel: (model: string) => Promise<void>
  onSaved: () => Promise<void>
  onRemoved: () => Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [removing, setRemoving] = useState(false)

  async function handleRemove() {
    setRemoving(true)
    try {
      await removeCredential(kind, credential.id)
      await onRemoved()
      toast.success(`Removed "${credential.name}".`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setRemoving(false)
    }
  }

  if (editing) {
    return (
      <CredentialForm
        kind={kind}
        submitLabel="Save"
        initial={{
          name: credential.name,
          provider: credential.provider,
          baseUrl: credential.baseUrl,
          apiKey: '',
          modelsText: credential.models.join(', '),
        }}
        onCancel={() => setEditing(false)}
        onSubmit={async (input) => {
          await updateCredential(kind, credential.id, input)
          setEditing(false)
          await onSaved()
          toast.success(`Saved "${input.name}".`)
        }}
      />
    )
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium">{credential.name}</span>
            {isActive && <span className="rounded-full bg-brand/10 px-2 py-0.5 text-xs font-medium text-brand">Active</span>}
          </div>
          <p className="truncate font-mono text-xs text-muted-foreground" title={credential.baseUrl}>
            {credential.provider} · {credential.baseUrl} · {credential.apiKeyConfigured ? 'key configured' : 'no key'}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button size="icon" variant="ghost" className="size-8" onClick={() => setEditing(true)} aria-label="Edit">
            <PencilIcon className="size-3.5" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="size-8 text-destructive hover:bg-destructive/10"
            onClick={handleRemove}
            disabled={removing}
            aria-label="Remove"
          >
            <Trash2Icon className="size-3.5" />
          </Button>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {credential.models.map((model) => (
          <ModelChip
            key={model}
            model={model}
            isActive={isActive && activeModel === model}
            warnOnSwitch={warnOnSwitch}
            onActivate={() => onActivateModel(model)}
          />
        ))}
      </div>
    </div>
  )
}

export function CredentialsManager({
  kind,
  title,
  description,
  initial,
  warnOnSwitch,
}: {
  kind: 'embedding' | 'chat'
  title: string
  description: string
  initial: CredentialsList
  /** Embedding-only: confirm before switching, since a mismatched vector size silently breaks RAG. */
  warnOnSwitch?: boolean
}) {
  const [list, setList] = useState(initial)
  const [adding, setAdding] = useState(false)

  async function refresh() {
    setList(await getCredentials(kind))
  }

  async function handleActivate(credentialId: string, model: string) {
    try {
      setList(await activateCredential(kind, credentialId, model))
      toast.success('Active credential updated.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-medium">{title}</h2>
        {!adding && (
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setAdding(true)}>
            <PlusIcon className="size-3.5" />
            Add credential
          </Button>
        )}
      </div>
      <p className="mb-3 text-sm text-muted-foreground">{description}</p>

      <div className="flex flex-col gap-3">
        {list.credentials.map((c) => (
          <CredentialRow
            key={c.id}
            kind={kind}
            credential={c}
            isActive={c.id === list.activeCredentialId}
            activeModel={list.activeModel}
            warnOnSwitch={warnOnSwitch}
            onActivateModel={(model) => handleActivate(c.id, model)}
            onSaved={refresh}
            onRemoved={refresh}
          />
        ))}
        {list.credentials.length === 0 && (
          <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">No credentials saved yet.</p>
        )}
        {adding && (
          <CredentialForm
            kind={kind}
            submitLabel="Add"
            initial={{ name: '', provider: 'ollama', baseUrl: '', apiKey: '', modelsText: '' }}
            onCancel={() => setAdding(false)}
            onSubmit={async (input) => {
              await addCredential(kind, input)
              setAdding(false)
              await refresh()
              toast.success(`Added "${input.name}".`)
            }}
          />
        )}
      </div>
    </section>
  )
}
