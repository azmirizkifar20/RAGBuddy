import { useEffect, useState } from 'react'
import { PageHeader } from '@/components/layout/page-header'
import { CopyButton } from '@/components/copy-button'
import { Skeleton } from '@/components/ui/skeleton'
import { getRuntimeConfig, type RuntimeConfig } from '@/lib/api-client'

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

export function Settings() {
  const [config, setConfig] = useState<RuntimeConfig | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    getRuntimeConfig()
      .then(setConfig)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
  }, [])

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Settings"
        description="Read-only view of the running configuration. Change these in project-rag's .env, then restart the server."
      />

      {error && <p className="text-sm text-destructive">{error}</p>}

      {!config ? (
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
            The embedding API key itself is never sent to this dashboard — only whether one is present. To change any
            setting, edit <code className="font-mono">.env</code> in project-rag's install directory and restart{' '}
            <code className="font-mono">npm run web</code>: configuration is read once at startup, so a running server
            keeps using the values it booted with. Switching the embedding model also requires a full re-ingest of every
            project — vectors from different models are not comparable.
          </p>
        </div>
      )}
    </div>
  )
}
