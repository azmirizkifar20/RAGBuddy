import { useEffect, useState } from 'react'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { CodeBlock, CopyButton } from '@/components/copy-button'
import { useProjectContext } from '@/pages/project-layout'
import { getRuntimeConfig, type RuntimeConfig } from '@/lib/api-client'

/** JSON/TOML both need the Windows backslashes escaped in string literals. */
function jsonPath(value: string): string {
  return value.replace(/\\/g, '\\\\')
}

const TOOLS = [
  {
    name: 'get_project_context',
    description:
      'Compact orientation overview — identity, Git status, tech-stack/architecture summaries, and a documentation inventory. Meant to run before deeper exploration.',
  },
  {
    name: 'search_project_docs',
    description: 'Semantic search across this project’s indexed docs. The tool an agent reaches for first.',
  },
  {
    name: 'get_project_document',
    description: 'Read one document in full, by path. Path-traversal-safe and scoped to the configured paths.',
  },
  {
    name: 'list_project_knowledge',
    description: 'List every document currently indexed — useful when the agent needs to orient itself.',
  },
]

function Step({ index, title, children }: { index: number; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 pb-5 last:pb-0">
      <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border text-xs tabular-nums">
        {index}
      </span>
      <div className="min-w-0 flex-1">
        <p className="mb-2 text-sm font-medium">{title}</p>
        {children}
      </div>
    </div>
  )
}

export function ProjectMcp() {
  const { project } = useProjectContext()
  const [config, setConfig] = useState<RuntimeConfig | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    getRuntimeConfig()
      .then(setConfig)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
  }, [])

  if (error) return <p className="text-sm text-destructive">{error}</p>
  if (!config) return <Skeleton className="h-96" />

  const entry = jsonPath(config.cliEntrypoint)
  const claudeCli = `claude mcp add ragbuddy -- node "${config.cliEntrypoint}" mcp`

  const claudeJson = `{
  "mcpServers": {
    "ragbuddy": {
      "command": "node",
      "args": ["${entry}", "mcp"]
    }
  }
}`

  const opencodeJson = `{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "ragbuddy": {
      "type": "local",
      "command": ["node", "${entry}", "mcp"],
      "enabled": true
    }
  }
}`

  const codexToml = `[mcp_servers.ragbuddy]
command = "node"
args = ["${entry}", "mcp"]`

  return (
    <div className="flex flex-col gap-8">
      <p className="text-sm text-muted-foreground">
        One MCP server serves every project — you register it <strong className="text-foreground">once per agent</strong>,
        not once per project. When your agent runs inside{' '}
        <code className="font-mono break-all text-foreground">{project.repository}</code>, RAGBuddy resolves{' '}
        <code className="font-mono text-foreground">{project.id}</code> automatically from the working directory.
      </p>

      <section>
        <h2 className="mb-3 text-sm font-medium">Setup</h2>
        <Tabs defaultValue="claude">
          <TabsList>
            <TabsTrigger value="claude">Claude Code</TabsTrigger>
            <TabsTrigger value="opencode">OpenCode</TabsTrigger>
            <TabsTrigger value="codex">Codex</TabsTrigger>
          </TabsList>

          <TabsContent value="claude">
            <Step index={1} title="Add the server (one command)">
              <CodeBlock code={claudeCli} />
            </Step>
            <Step index={2} title="…or write it into your MCP config by hand">
              <CodeBlock code={claudeJson} />
            </Step>
            <Step index={3} title="Verify it connected">
              <p className="text-sm text-muted-foreground">
                Run <code className="font-mono">/mcp</code> inside Claude Code —{' '}
                <code className="font-mono">ragbuddy</code> should be listed with four tools.
              </p>
            </Step>
          </TabsContent>

          <TabsContent value="opencode">
            <Step index={1} title="Add it to opencode.json">
              <CodeBlock code={opencodeJson} />
            </Step>
            <Step index={2} title="Restart OpenCode">
              <p className="text-sm text-muted-foreground">
                The four tools become available under the <code className="font-mono">ragbuddy</code> server.
              </p>
            </Step>
          </TabsContent>

          <TabsContent value="codex">
            <Step index={1} title="Add it to ~/.codex/config.toml">
              <CodeBlock code={codexToml} />
            </Step>
            <Step index={2} title="Restart Codex">
              <p className="text-sm text-muted-foreground">
                Codex reads MCP servers at startup — the tools appear on the next session.
              </p>
            </Step>
          </TabsContent>
        </Tabs>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-medium">Tools your agent gets</h2>
        <dl className="flex flex-col divide-y rounded-lg border">
          {TOOLS.map((tool) => (
            <div key={tool.name} className="px-4 py-3">
              <dt className="font-mono text-sm break-all">{tool.name}</dt>
              <dd className="mt-0.5 text-sm text-muted-foreground">{tool.description}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-medium">Resolved paths</h2>
        <dl className="flex flex-col divide-y rounded-lg border">
          {[
            { label: 'CLI entrypoint', value: config.cliEntrypoint },
            { label: 'Node binary', value: config.nodePath },
            { label: 'Project registry', value: config.projectRegistryPath },
            { label: 'Repository', value: project.repository },
          ].map((row) => (
            <div key={row.label} className="flex items-center justify-between gap-3 px-4 py-2.5">
              <dt className="shrink-0 text-sm text-muted-foreground">{row.label}</dt>
              <dd className="flex min-w-0 items-center gap-1">
                <span className="truncate font-mono text-xs" title={row.value}>
                  {row.value}
                </span>
                <CopyButton value={row.value} />
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-medium">Good to know</h2>
        <ul className="flex list-disc flex-col gap-2 pl-5 text-sm text-muted-foreground marker:text-muted-foreground/50">
          <li>
            No <code className="font-mono">env</code> block is needed above — the server reads{' '}
            <code className="font-mono">.env</code> from its own install directory, not from the agent's working
            directory.
          </li>
          <li>
            To query a different project than the one you're standing in, pass{' '}
            <code className="font-mono">project: "{project.id}"</code> explicitly to any tool.
          </li>
          <li>
            Run <code className="font-mono">npm run build</code> after pulling changes — the MCP config points at{' '}
            <code className="font-mono">dist/</code>, not the TypeScript sources.
          </li>
          <li>
            Embedding model in use: <code className="font-mono text-foreground">{config.embeddingModel}</code> via{' '}
            <code className="font-mono text-foreground">{config.embeddingProvider}</code>. The agent's answers are only
            as fresh as the last sync.
          </li>
        </ul>
      </section>
    </div>
  )
}
