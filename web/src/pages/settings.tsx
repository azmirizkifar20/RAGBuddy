import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { CheckCircle2Icon, XCircleIcon } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { CopyButton } from '@/components/copy-button'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import {
  getRuntimeConfig,
  getChatSettings,
  updateChatSettings,
  testChatConnection,
  type RuntimeConfig,
  type ChatSettings,
  type ChatProvider,
  type ChatConnectionTestResult,
} from '@/lib/api-client'

function Group({ title, rows }: { title: string; rows: [string, string][] }) {
  return (
    <section>
      <h2 className="mb-2 text-sm font-medium">{title}</h2>
      <dl className="flex flex-col divide-y rounded-lg border">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-center justify-between gap-3 px-4 py-2.5">
            <dt className="shrink-0 text-sm text-muted-foreground">{label}</dt>
            <dd className="flex min-w-0 items-center gap-1">
              <span className="truncate font-mono text-xs" title={value}>
                {value}
              </span>
              <CopyButton value={value} />
            </dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

interface ChatForm {
  provider: ChatProvider
  baseUrl: string
  model: string
  apiKey: string
}

function ChatSettingsForm({ initial }: { initial: ChatSettings }) {
  const [form, setForm] = useState<ChatForm>({
    provider: initial.provider,
    baseUrl: initial.baseUrl,
    model: initial.model,
    apiKey: '',
  })
  const [apiKeyConfigured, setApiKeyConfigured] = useState(initial.apiKeyConfigured)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<ChatConnectionTestResult | null>(null)

  async function handleSave() {
    setSaving(true)
    setTestResult(null)
    try {
      const saved = await updateChatSettings({
        provider: form.provider,
        baseUrl: form.baseUrl,
        model: form.model,
        apiKey: form.apiKey || undefined,
      })
      setApiKeyConfigured(saved.apiKeyConfigured)
      setForm((f) => ({ ...f, apiKey: '' }))
      toast.success('Chat settings saved.')
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
      const result = await testChatConnection({
        provider: form.provider,
        baseUrl: form.baseUrl,
        model: form.model,
        apiKey: form.apiKey || undefined,
      })
      setTestResult(result)
    } catch (err) {
      setTestResult({ ok: false, error: err instanceof Error ? err.message : String(err) })
    } finally {
      setTesting(false)
    }
  }

  const canSubmit = form.baseUrl.trim() !== '' && form.model.trim() !== ''

  return (
    <section>
      <h2 className="mb-2 text-sm font-medium">Chat</h2>
      <div className="flex flex-col gap-3 rounded-lg border p-4">
        <p className="text-sm text-muted-foreground">
          The model that answers in AI Chat — kept separate from the embedding provider above, since RAG retrieval and
          chat completion often come from different sources.
        </p>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="chat-provider">Provider</Label>
            <Select
              id="chat-provider"
              value={form.provider}
              onChange={(e) => setForm((f) => ({ ...f, provider: e.target.value as ChatProvider }))}
            >
              <option value="ollama">Ollama</option>
              <option value="openai">OpenAI-compatible</option>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="chat-model">Model</Label>
            <Input
              id="chat-model"
              value={form.model}
              onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))}
              placeholder="llama3"
            />
          </div>
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label htmlFor="chat-base-url">Base URL</Label>
            <Input
              id="chat-base-url"
              value={form.baseUrl}
              onChange={(e) => setForm((f) => ({ ...f, baseUrl: e.target.value }))}
              placeholder="http://localhost:11434"
            />
          </div>
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label htmlFor="chat-api-key">API key</Label>
            <Input
              id="chat-api-key"
              type="password"
              value={form.apiKey}
              onChange={(e) => setForm((f) => ({ ...f, apiKey: e.target.value }))}
              placeholder={apiKeyConfigured ? '•••••••• (unchanged)' : 'Not set — only needed for OpenAI-compatible'}
            />
          </div>
        </div>

        {testResult && (
          <p className={`flex items-center gap-1.5 text-sm ${testResult.ok ? 'text-success' : 'text-destructive'}`}>
            {testResult.ok ? (
              <>
                <CheckCircle2Icon className="size-4 shrink-0" />
                Connected in {testResult.latencyMs}ms.
              </>
            ) : (
              <>
                <XCircleIcon className="size-4 shrink-0" />
                {testResult.error}
              </>
            )}
          </p>
        )}

        <div className="flex items-center gap-2">
          <Button size="sm" onClick={handleSave} disabled={!canSubmit || saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
          <Button size="sm" variant="outline" onClick={handleTest} disabled={!canSubmit || testing}>
            {testing ? 'Testing…' : 'Test connection'}
          </Button>
        </div>
      </div>
    </section>
  )
}

export function Settings() {
  const [config, setConfig] = useState<RuntimeConfig | null>(null)
  const [chatSettings, setChatSettings] = useState<ChatSettings | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([getRuntimeConfig(), getChatSettings()])
      .then(([runtimeConfig, chat]) => {
        setConfig(runtimeConfig)
        setChatSettings(chat)
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
  }, [])

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Settings"
        description="Chat's provider/base URL/model/API key are editable below. Everything else is read-only — change it in RAGBuddy's .env and restart the server."
      />

      {error && <p className="text-sm text-destructive">{error}</p>}

      {!config || !chatSettings ? (
        <Skeleton className="h-96" />
      ) : (
        <div className="flex flex-col gap-6">
          <Group
            title="Vector store"
            rows={[
              ['Qdrant URL', config.qdrantUrl],
              ['Collection', config.qdrantCollection],
              ['Results per search (top-K)', String(config.ragTopK)],
            ]}
          />
          <Group
            title="Embeddings"
            rows={[
              ['Provider', config.embeddingProvider],
              ['Model', config.embeddingModel],
              ['Base URL', config.embeddingBaseUrl],
              ['API key', config.embeddingApiKeyConfigured ? 'configured' : 'not set'],
            ]}
          />

          <ChatSettingsForm initial={chatSettings} />

          <Group
            title="Paths"
            rows={[
              ['Project registry', config.projectRegistryPath],
              ['Data directory', config.dataDir],
              ['CLI entrypoint', config.cliEntrypoint],
              ['Node binary', config.nodePath],
            ]}
          />

          <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            Chat settings apply immediately, no restart needed — they're saved to{' '}
            <code className="font-mono">config/chat-settings.json</code> and take effect on the next message. The
            embedding API key is never sent to this dashboard — only whether one is present. Switching the embedding
            model still requires a full re-ingest of every project; vectors from different models are not comparable.
          </p>
        </div>
      )}
    </div>
  )
}
