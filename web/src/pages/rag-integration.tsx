import { useEffect, useState } from 'react'
import { PageHeader } from '@/components/layout/page-header'
import { CodeBlock, CopyButton } from '@/components/copy-button'
import { Skeleton } from '@/components/ui/skeleton'
import { useProjects } from '@/lib/projects-context'
import { getApiKeyStatus, getDashboardAuthStatus } from '@/lib/api-client'

function StatusBadge({ ok, onLabel, offLabel }: { ok: boolean; onLabel: string; offLabel: string }) {
  return <span className={ok ? 'font-medium text-success' : 'text-muted-foreground'}>{ok ? onLabel : offLabel}</span>
}

export function RagIntegration() {
  const { projects } = useProjects()
  const [apiKeyConfigured, setApiKeyConfigured] = useState<boolean | null>(null)
  const [dashboardAuthEnabled, setDashboardAuthEnabled] = useState<boolean | null>(null)

  useEffect(() => {
    Promise.all([getApiKeyStatus(), getDashboardAuthStatus()])
      .then(([apiKey, dashboardAuth]) => {
        setApiKeyConfigured(apiKey.configured)
        setDashboardAuthEnabled(dashboardAuth.enabled)
      })
      .catch(() => {
        // Best-effort — the hardening status is a nice-to-have summary here, not required to read the page.
      })
  }, [])

  const baseUrl = window.location.origin
  const exampleProjectId = projects[0]?.id ?? 'YOUR_PROJECT_ID'

  const searchCurl = `curl -X POST ${baseUrl}/api/projects/${exampleProjectId}/search \\
  -H "Content-Type: application/json" \\
  -d '{"query":"How does incremental sync work?"}'`

  const searchJs = `async function getRagContext(query, history = []) {
  const res = await fetch('${baseUrl}/api/projects/${exampleProjectId}/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, history }),
  })
  const { results, error } = await res.json()
  if (error) console.warn('RAGBuddy retrieval error:', error)
  return results // feed these into your own chat/LLM prompt as context
}`

  const chatCurl = `curl -N -X POST ${baseUrl}/api/projects/${exampleProjectId}/chat \\
  -H "Content-Type: application/json" \\
  -d '{"messages":[{"role":"user","content":"How does incremental sync work?"}]}'`

  const chatJs = `const res = await fetch('${baseUrl}/api/projects/${exampleProjectId}/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ messages: [{ role: 'user', content: question }] }),
})
// res.body is a Server-Sent Events stream: "event: token" / "sources" / "done" / "error"`

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="RAG Integration"
        description="Call this dashboard's REST API directly from your own web app or backend — no vector database, embedding model, or retrieval pipeline of your own required."
      />

      <p className="mb-6 max-w-3xl text-sm text-muted-foreground">
        Once a project is registered and synced here, any other app can send a query and get back the most relevant
        chunks of that project's docs, ranked with the same hybrid vector + keyword search, query rewriting, and
        reranking pipeline this dashboard's own chat uses — or let RAGBuddy generate the whole answer via a
        RAG-grounded chat endpoint. Everything below runs on the base URL this dashboard is already open on.
      </p>

      <div className="flex flex-col gap-6">
        <section>
          <h2 className="mb-2 text-sm font-medium">Base URL &amp; project id</h2>
          <dl className="flex flex-col divide-y rounded-lg border">
            <div className="flex items-center justify-between gap-3 px-4 py-2.5">
              <dt className="shrink-0 text-sm text-muted-foreground">Base URL</dt>
              <dd className="flex min-w-0 items-center gap-1">
                <span className="truncate font-mono text-xs">{baseUrl}</span>
                <CopyButton value={baseUrl} />
              </dd>
            </div>
            {projects.length === 0 ? (
              <div className="px-4 py-2.5 text-sm text-muted-foreground">
                No projects registered yet — register one first, then its id shows up here.
              </div>
            ) : (
              projects.map((project) => (
                <div key={project.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <dt className="min-w-0 truncate text-sm text-muted-foreground">{project.name}</dt>
                  <dd className="flex min-w-0 items-center gap-1">
                    <span className="truncate font-mono text-xs">{project.id}</span>
                    <CopyButton value={project.id} />
                  </dd>
                </div>
              ))
            )}
          </dl>
        </section>

        <section>
          <h2 className="mb-2 text-sm font-medium">/search — retrieval only</h2>
          <p className="mb-3 text-sm text-muted-foreground">
            Use this if you already have your own chat/LLM and just need relevant context to feed into it.{' '}
            <code className="font-mono">POST /api/projects/:id/search</code> with <code className="font-mono">{'{ query, history? }'}</code> returns{' '}
            <code className="font-mono">{'{ results: [{ file, section, score, content }], error? }'}</code> — ranked
            best-first. An empty <code className="font-mono">results</code> array just means nothing relevant was
            found, not an error; <code className="font-mono">error</code> is only present if retrieval itself failed.
          </p>
          <div className="flex flex-col gap-2">
            <CodeBlock code={searchCurl} />
            <CodeBlock code={searchJs} />
          </div>
        </section>

        <section>
          <h2 className="mb-2 text-sm font-medium">/chat — full RAG-grounded chat (optional)</h2>
          <p className="mb-3 text-sm text-muted-foreground">
            If your app has no chat feature of its own yet, let RAGBuddy generate the answer too.{' '}
            <code className="font-mono">POST /api/projects/:id/chat</code> with{' '}
            <code className="font-mono">{'{ messages, useRag? }'}</code> streams back{' '}
            <code className="font-mono">text/event-stream</code> — <code className="font-mono">token</code> events
            for each chunk of the answer, a <code className="font-mono">sources</code> event with the chunks used,
            then <code className="font-mono">done</code> (or <code className="font-mono">error</code> if the request
            fails mid-stream). Stateless — you own the conversation history and send the full transcript each call.
          </p>
          <div className="flex flex-col gap-2">
            <CodeBlock code={chatCurl} />
            <CodeBlock code={chatJs} />
          </div>
        </section>

        <section>
          <h2 className="mb-2 text-sm font-medium">Hardening</h2>
          {apiKeyConfigured === null || dashboardAuthEnabled === null ? (
            <Skeleton className="h-24" />
          ) : (
            <div className="flex flex-col gap-3 rounded-lg border p-4">
              <p className="text-sm text-muted-foreground">
                By default every endpoint above is open to anything that can reach this server (local-only trust
                model) — fine for an internal tool on the same network. Two independent switches in{' '}
                <span className="font-medium text-foreground">Settings</span> hardens this for external exposure:
              </p>
              <dl className="flex flex-col divide-y rounded-lg border">
                <div className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <dt className="text-sm text-muted-foreground">API key</dt>
                  <dd className="text-sm">
                    <StatusBadge ok={apiKeyConfigured} onLabel="Configured" offLabel="Not configured" />
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <dt className="text-sm text-muted-foreground">Dashboard login</dt>
                  <dd className="text-sm">
                    <StatusBadge ok={dashboardAuthEnabled} onLabel="Enabled" offLabel="Not enabled" />
                  </dd>
                </div>
              </dl>
              <p className="text-sm text-muted-foreground">
                A valid API key (sent via <code className="font-mono">Authorization: Bearer</code> or{' '}
                <code className="font-mono">X-API-Key</code>) always satisfies both — it's the one credential meant
                for programmatic callers like your app. Dashboard login is a separate, session-cookie based gate for
                humans opening this dashboard in a browser.
              </p>
              <p className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-xs text-warning">
                If dashboard login is enabled <em>without</em> an API key configured, every request above — including
                yours — needs a valid dashboard session cookie, which a backend caller doesn't have. Configure an API
                key too if you want dashboard login on the browser <em>and</em> this integration to keep working.
              </p>
              <p className="text-xs text-muted-foreground">
                Calling from a browser on a different origin also needs that origin added to the CORS allowlist
                (<code className="font-mono">RAGBUDDY_ALLOWED_ORIGINS</code>, env-only for now) — calling from your
                own backend instead sidesteps CORS entirely, since it's a browser-only restriction.
              </p>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
