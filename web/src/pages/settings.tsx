import { useEffect, useState } from 'react'
import {
  CheckCircle2Icon,
  DatabaseIcon,
  FolderCogIcon,
  KeyRoundIcon,
  SettingsIcon,
  SparklesIcon,
  XCircleIcon,
} from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { CopyButton } from '@/components/copy-button'
import { Skeleton } from '@/components/ui/skeleton'
import { getRuntimeConfig, type RuntimeConfig } from '@/lib/api-client'
import type { LucideIcon } from 'lucide-react'

function Group({ icon: Icon, title, rows }: { icon: LucideIcon; title: string; rows: [string, string][] }) {
  return (
    <div className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
      <div className="flex items-center gap-2 border-b px-4 py-3 text-sm font-medium">
        <Icon className="size-4 text-brand" />
        {title}
      </div>
      {rows.map(([label, value]) => (
        <div key={label} className="flex items-center justify-between gap-3 border-b px-4 py-2.5 last:border-b-0">
          <span className="shrink-0 text-sm text-muted-foreground">{label}</span>
          <div className="flex min-w-0 items-center gap-1">
            <span className="truncate font-mono text-xs" title={value}>
              {value}
            </span>
            <CopyButton value={value} />
          </div>
        </div>
      ))}
    </div>
  )
}

export function Settings() {
  const [config, setConfig] = useState<RuntimeConfig | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    getRuntimeConfig()
      .then(setConfig)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
  }, [])

  return (
    <div>
      <PageHeader
        icon={SettingsIcon}
        title="Settings"
        description="Read-only view of the running configuration. Change these in project-rag's .env, then restart the server."
      />

      {error && <p className="text-sm text-destructive">{error}</p>}

      {!config ? (
        <div className="flex flex-col gap-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-40" />
          ))}
        </div>
      ) : (
        <div className="stagger flex flex-col gap-4">
          <Group
            icon={DatabaseIcon}
            title="Vector store"
            rows={[
              ['Qdrant URL', config.qdrantUrl],
              ['Collection', config.qdrantCollection],
              ['Results per search (top-K)', String(config.ragTopK)],
            ]}
          />
          <Group
            icon={SparklesIcon}
            title="Embeddings"
            rows={[
              ['Provider', config.embeddingProvider],
              ['Model', config.embeddingModel],
              ['Base URL', config.embeddingBaseUrl],
            ]}
          />
          <Group
            icon={FolderCogIcon}
            title="Paths"
            rows={[
              ['Project registry', config.projectRegistryPath],
              ['Data directory', config.dataDir],
              ['CLI entrypoint', config.cliEntrypoint],
              ['Node binary', config.nodePath],
            ]}
          />

          <div className="flex items-start gap-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
            <KeyRoundIcon className="mt-0.5 size-4 shrink-0 text-brand" />
            <div>
              <p className="flex items-center gap-1.5 text-sm font-medium">
                Embedding API key
                {config.embeddingApiKeyConfigured ? (
                  <span className="flex items-center gap-1 text-xs text-success">
                    <CheckCircle2Icon className="size-3" /> configured
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <XCircleIcon className="size-3" /> not set
                  </span>
                )}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                The key itself is never sent to this dashboard — only whether one is present. Local Ollama setups do not
                need one.
              </p>
            </div>
          </div>

          <div className="rounded-xl border border-dashed p-4">
            <p className="text-sm font-medium">Changing a setting</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Edit <code className="font-mono">.env</code> in project-rag's install directory, then restart{' '}
              <code className="font-mono">npm run web</code>. Configuration is read once at startup, so a running server
              keeps using the values it booted with. Switching the embedding model also requires a full re-ingest of
              every project — vectors from different models are not comparable.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
