import { useEffect, useState } from 'react'
import {
  BookOpenIcon,
  CheckCircle2Icon,
  FileSearchIcon,
  ListTreeIcon,
  PlugZapIcon,
  SearchCodeIcon,
  TerminalIcon,
  TriangleAlertIcon,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
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
    icon: SearchCodeIcon,
    name: 'search_project_docs',
    description: 'Semantic search across this project’s indexed docs. The tool an agent reaches for first.',
  },
  {
    icon: FileSearchIcon,
    name: 'get_project_document',
    description: 'Read one document in full, by path. Path-traversal-safe and scoped to the configured paths.',
  },
  {
    icon: ListTreeIcon,
    name: 'list_project_knowledge',
    description: 'List every document currently indexed — useful when the agent needs to orient itself.',
  },
]

function Step({ index, title, children }: { index: number; title: string; children: React.ReactNode }) {
  return (
    <div className="relative flex gap-3 pb-5 last:pb-0">
      <div className="flex flex-col items-center">
        <span className="z-10 flex size-7 shrink-0 items-center justify-center rounded-full bg-brand text-xs font-semibold text-brand-foreground">
          {index}
        </span>
        <span className="w-px flex-1 bg-border" />
      </div>
      <div className="min-w-0 flex-1 pt-0.5">
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
  const claudeCli = `claude mcp add project-rag -- node "${config.cliEntrypoint}" mcp`

  const claudeJson = `{
  "mcpServers": {
    "project-rag": {
      "command": "node",
      "args": ["${entry}", "mcp"]
    }
  }
}`

  const opencodeJson = `{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "project-rag": {
      "type": "local",
      "command": ["node", "${entry}", "mcp"],
      "enabled": true
    }
  }
}`

  const codexToml = `[mcp_servers.project-rag]
command = "node"
args = ["${entry}", "mcp"]`

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start gap-3 rounded-xl bg-brand-soft/50 p-4 ring-1 ring-brand/15">
        <PlugZapIcon className="mt-0.5 size-4 shrink-0 text-brand" />
        <div className="text-sm text-muted-foreground">
          One MCP server serves every project — you register it <strong className="text-foreground">once per agent</strong>,
          not once per project. When your agent runs inside{' '}
          <code className="font-mono text-foreground break-all">{project.repository}</code>, project-rag resolves{' '}
          <Badge variant="secondary" className="font-mono">
            {project.id}
          </Badge>{' '}
          automatically from the working directory.
        </div>
      </div>

      <div>
        <h2 className="mb-3 font-heading text-sm font-semibold tracking-wide uppercase">Setup</h2>
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
              <p className="mb-2 text-sm text-muted-foreground">
                Run <code className="font-mono">/mcp</code> inside Claude Code — <code className="font-mono">project-rag</code>{' '}
                should be listed with three tools.
              </p>
            </Step>
          </TabsContent>

          <TabsContent value="opencode">
            <Step index={1} title="Add it to opencode.json">
              <CodeBlock code={opencodeJson} />
            </Step>
            <Step index={2} title="Restart OpenCode">
              <p className="text-sm text-muted-foreground">
                The three tools become available under the <code className="font-mono">project-rag</code> server.
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
      </div>

      <div>
        <h2 className="mb-3 font-heading text-sm font-semibold tracking-wide uppercase">Tools your agent gets</h2>
        <div className="stagger grid gap-2.5 sm:grid-cols-3">
          {TOOLS.map((tool, i) => (
            <div
              key={tool.name}
              style={{ '--stagger-index': i } as React.CSSProperties}
              className="surface-glow rounded-xl bg-card p-4 ring-1 ring-foreground/10 transition-transform duration-300 hover:-translate-y-0.5"
            >
              <div className="mb-2 flex size-8 items-center justify-center rounded-lg bg-brand-soft text-brand">
                <tool.icon className="size-4" />
              </div>
              <p className="font-mono text-sm break-all">{tool.name}</p>
              <p className="mt-1 text-xs text-muted-foreground">{tool.description}</p>
            </div>
          ))}
        </div>
      </div>

      <div>
        <h2 className="mb-3 font-heading text-sm font-semibold tracking-wide uppercase">Resolved paths</h2>
        <div className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
          {[
            { label: 'CLI entrypoint', value: config.cliEntrypoint },
            { label: 'Node binary', value: config.nodePath },
            { label: 'Project registry', value: config.projectRegistryPath },
            { label: 'Repository', value: project.repository },
          ].map((row) => (
            <div key={row.label} className="flex items-center justify-between gap-3 border-b px-3 py-2.5 last:border-b-0">
              <span className="shrink-0 text-xs text-muted-foreground">{row.label}</span>
              <div className="flex min-w-0 items-center gap-1">
                <span className="truncate font-mono text-xs" title={row.value}>
                  {row.value}
                </span>
                <CopyButton value={row.value} label={undefined} />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2.5 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
        <p className="flex items-center gap-2 text-sm font-medium">
          <BookOpenIcon className="size-4 text-brand" /> Good to know
        </p>
        <p className="flex items-start gap-2 text-sm text-muted-foreground">
          <CheckCircle2Icon className="mt-0.5 size-3.5 shrink-0 text-success" />
          No <code className="font-mono">env</code> block is needed above — the server reads{' '}
          <code className="font-mono">.env</code> from its own install directory, not from the agent's working
          directory.
        </p>
        <p className="flex items-start gap-2 text-sm text-muted-foreground">
          <CheckCircle2Icon className="mt-0.5 size-3.5 shrink-0 text-success" />
          To query a different project than the one you're standing in, pass{' '}
          <code className="font-mono">project: "{project.id}"</code> explicitly to any tool.
        </p>
        <p className="flex items-start gap-2 text-sm text-muted-foreground">
          <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0 text-warning" />
          Run <code className="font-mono">npm run build</code> after pulling changes — the MCP config points at{' '}
          <code className="font-mono">dist/</code>, not the TypeScript sources.
        </p>
        <p className="flex items-start gap-2 text-sm text-muted-foreground">
          <TerminalIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
          Embedding model in use: <code className="font-mono text-foreground">{config.embeddingModel}</code> via{' '}
          <code className="font-mono text-foreground">{config.embeddingProvider}</code>. The agent's answers are only as
          fresh as the last sync.
        </p>
      </div>
    </div>
  )
}
