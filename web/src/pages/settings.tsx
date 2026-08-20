import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Trash2Icon, KeyRoundIcon } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { CopyButton } from '@/components/copy-button'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
import { CredentialsManager } from '@/components/credentials-manager'
import { setStoredApiKey } from '@/lib/api-key'
import {
  getRuntimeConfig,
  getCredentials,
  getQdrantInfo,
  dropQdrantCollection,
  getApiKeyStatus,
  generateApiKey,
  removeApiKey,
  type RuntimeConfig,
  type CredentialsList,
  type QdrantCollectionInfo,
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

function QdrantDangerZone({ initial }: { initial: QdrantCollectionInfo }) {
  const [info, setInfo] = useState(initial)
  const [confirmText, setConfirmText] = useState('')
  const [dropping, setDropping] = useState(false)

  async function handleDrop() {
    setDropping(true)
    try {
      const result = await dropQdrantCollection()
      setInfo((i) => ({ ...i, exists: false, vectorSize: undefined, pointsCount: undefined }))
      toast.success(
        `Dropped "${info.collection}". Re-ingest ${result.affectedProjectIds.length} project(s) to rebuild it.`,
      )
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setDropping(false)
      setConfirmText('')
    }
  }

  const canConfirm = confirmText === info.collection

  return (
    <section>
      <h2 className="mb-2 text-sm font-medium text-destructive">Danger zone</h2>
      <div className="flex flex-col gap-3 rounded-lg border border-destructive/30 p-4">
        <p className="text-sm text-muted-foreground">
          The Qdrant collection <code className="font-mono">{info.collection}</code> is shared across every
          registered project.{' '}
          {info.exists ? (
            <>
              Currently <strong className="text-foreground">{info.vectorSize ?? '?'}-dim</strong>,{' '}
              {info.pointsCount ?? 0} point(s) indexed.
            </>
          ) : (
            "It doesn't exist right now — it's created automatically on the next ingest, sync, or upload."
          )}{' '}
          Dropping it is required to switch to an embedding model with a different vector size, but it wipes every
          project's index at once and can't be undone.
        </p>

        <AlertDialog onOpenChange={(open) => !open && setConfirmText('')}>
          <AlertDialogTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="w-fit gap-1.5 text-destructive hover:bg-destructive/10"
              disabled={!info.exists}
            >
              <Trash2Icon className="size-3.5" />
              Drop collection
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Drop "{info.collection}"?</AlertDialogTitle>
              <AlertDialogDescription>
                This permanently deletes every indexed vector for {info.affectedProjectIds.length} project
                {info.affectedProjectIds.length === 1 ? '' : 's'}
                {info.affectedProjectIds.length > 0 ? `: ${info.affectedProjectIds.join(', ')}` : ''}. Each one must
                be re-ingested afterward.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="qdrant-confirm-name">
                Type <span className="font-mono">{info.collection}</span> to confirm
              </Label>
              <Input
                id="qdrant-confirm-name"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder={info.collection}
                autoComplete="off"
              />
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                disabled={!canConfirm || dropping}
                onClick={handleDrop}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {dropping ? 'Dropping…' : 'Drop collection'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </section>
  )
}

function ApiAccessPanel({ initialConfigured }: { initialConfigured: boolean }) {
  const [configured, setConfigured] = useState(initialConfigured)
  const [revealedKey, setRevealedKey] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function handleGenerate() {
    setBusy(true)
    try {
      const { apiKey } = await generateApiKey()
      setStoredApiKey(apiKey)
      setRevealedKey(apiKey)
      setConfigured(true)
      toast.success('API key generated. Every /api request now requires it.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function handleRemove() {
    setBusy(true)
    try {
      await removeApiKey()
      setStoredApiKey(null)
      setRevealedKey(null)
      setConfigured(false)
      toast.success('API key removed. /api requests no longer require authentication.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section>
      <h2 className="mb-2 text-sm font-medium">API access</h2>
      <div className="flex flex-col gap-3 rounded-lg border p-4">
        <p className="text-sm text-muted-foreground">
          By default every <code className="font-mono">/api</code> endpoint is open to anything that can reach this
          server (local-only trust model). Generating a key requires it on every request — via{' '}
          <code className="font-mono">Authorization: Bearer</code> or <code className="font-mono">X-API-Key</code> —
          useful once you expose this instance to another web app or network. This dashboard stores the key in this
          browser's local storage and attaches it automatically, so it keeps working for you after generating one.
        </p>

        {revealedKey && (
          <div className="flex flex-col gap-1.5 rounded-lg border border-warning/40 bg-warning/10 p-3">
            <p className="text-xs font-medium text-warning">
              Copy this now — it won't be shown again. Anyone integrating externally needs this value.
            </p>
            <div className="flex items-center gap-1.5">
              <code className="min-w-0 flex-1 truncate rounded bg-background px-2 py-1 font-mono text-xs">
                {revealedKey}
              </code>
              <CopyButton value={revealedKey} />
            </div>
          </div>
        )}

        <div className="flex items-center gap-2">
          <span className="text-sm">
            Status:{' '}
            <span className={configured ? 'font-medium text-success' : 'text-muted-foreground'}>
              {configured ? 'Configured' : 'Not configured'}
            </span>
          </span>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={handleGenerate} disabled={busy} className="gap-1.5 w-fit">
            <KeyRoundIcon className="size-3.5" />
            {configured ? 'Rotate key' : 'Generate key'}
          </Button>

          {configured && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  className="w-fit gap-1.5 text-destructive hover:bg-destructive/10"
                >
                  <Trash2Icon className="size-3.5" />
                  Remove key
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Remove the API key?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Every /api request becomes unauthenticated again — anything that can reach this server can call
                    any endpoint. Only do this if you're reverting to a fully local/trusted setup.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={handleRemove}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    Remove key
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>

        {configured && !revealedKey && (
          <p className="text-xs text-muted-foreground">
            Locked out (different browser, cleared storage)? Delete{' '}
            <code className="font-mono">config/api-key.json</code> (or unset{' '}
            <code className="font-mono">RAGBUDDY_API_KEY</code>) and restart the server to reopen access, then
            generate a new key.
          </p>
        )}
      </div>
    </section>
  )
}

export function Settings() {
  const [config, setConfig] = useState<RuntimeConfig | null>(null)
  const [embeddingCredentials, setEmbeddingCredentials] = useState<CredentialsList | null>(null)
  const [chatCredentials, setChatCredentials] = useState<CredentialsList | null>(null)
  const [qdrantInfo, setQdrantInfo] = useState<QdrantCollectionInfo | null>(null)
  const [apiKeyConfigured, setApiKeyConfigured] = useState<boolean | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([getRuntimeConfig(), getCredentials('embedding'), getCredentials('chat'), getQdrantInfo(), getApiKeyStatus()])
      .then(([runtimeConfig, embedding, chat, qdrant, apiKey]) => {
        setConfig(runtimeConfig)
        setEmbeddingCredentials(embedding)
        setChatCredentials(chat)
        setQdrantInfo(qdrant)
        setApiKeyConfigured(apiKey.configured)
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
  }, [])

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Settings"
        description="API access, embedding, and chat provider credentials are editable below. Everything else is read-only — change it in RAGBuddy's .env and restart the server."
      />

      {error && <p className="text-sm text-destructive">{error}</p>}

      {!config || !embeddingCredentials || !chatCredentials || !qdrantInfo || apiKeyConfigured === null ? (
        <Skeleton className="h-96" />
      ) : (
        <div className="flex flex-col gap-6">
          <ApiAccessPanel initialConfigured={apiKeyConfigured} />

          <Group
            title="Vector store"
            rows={[
              ['Qdrant URL', config.qdrantUrl],
              ['Collection', config.qdrantCollection],
              ['Results per search (top-K)', String(config.ragTopK)],
            ]}
          />

          <CredentialsManager
            kind="embedding"
            title="Embedding credentials"
            description="Used for indexing and RAG retrieval. Switching the active model requires re-ingesting every project — vectors from different models aren't comparable."
            initial={embeddingCredentials}
            warnOnSwitch
          />

          <CredentialsManager
            kind="chat"
            title="Chat credentials"
            description="The model that answers in AI Chat — independent of the embedding provider above, since RAG retrieval and chat completion often come from different sources."
            initial={chatCredentials}
          />

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
            Credential changes apply immediately, no restart needed. API keys are write-only — never sent back to
            this dashboard, only whether one is configured. `.env`'s original values seed the first credential in
            each list on first run; add, edit, or activate as many more as you like.
          </p>

          {qdrantInfo && <QdrantDangerZone initial={qdrantInfo} />}
        </div>
      )}
    </div>
  )
}
