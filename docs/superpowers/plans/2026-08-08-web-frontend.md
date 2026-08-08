# Web Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `web/` frontend from `docs/superpowers/specs/2026-08-08-web-frontend-design.md` — a Vite + React + TypeScript SPA (Dashboard + Project Detail pages) styled with Tailwind CSS v4 and shadcn/ui, consuming the REST API already implemented in `docs/superpowers/plans/2026-08-08-web-backend-api.md`. This is the second and final plan for the web frontend feature; the backend (CLI `project` subcommands + Express API) is already complete.

**Architecture:** A separate Vite project at `web/` (its own `package.json`/toolchain, per the spec, so React/JSX tooling never mixes into the backend's `tsconfig.build.json`). `npm run build` in `web/` produces `web/dist`, which `src/server/app.ts` (already built in the backend plan) serves as static files via `project-rag web`. During development, Vite's dev server proxies `/api/*` to `http://localhost:4300` (the backend), so `npm run dev` in `web/` works against a locally running `project-rag web` without a CORS layer.

**Tech Stack:** Vite 8, React 19, TypeScript ~6.0, Tailwind CSS v4 (`@tailwindcss/vite` plugin, no separate config file), shadcn/ui (Radix base, Nova preset — chosen for a modern, polished look per the "interactive, tidy layout" requirement), `react-router` v8 (the unified package — `react-router-dom` is being removed in v8 per its own migration docs, so the correct install is `react-router` alone, imported as `from 'react-router'`), `sonner` for toast notifications (installed automatically by `shadcn init`).

**A note on SSE:** the backend's `POST /api/projects/:id/ingest` and `/sync` endpoints are SSE streams triggered by POST. The browser's native `EventSource` only supports GET with no body, so it cannot consume these. `api-client.ts`'s `streamRun` instead reads the `fetch` response body as a stream and manually parses the `event: `/`data: ` wire format — a standard, spec-compliant way to consume SSE-shaped output over POST, verified empirically (see Task 2).

## Global Constraints

- **No changes to any backend file** (`src/**`, `tests/**`) — this plan is additive, `web/` only.
- **No automated frontend test suite in v1** (explicit YAGNI per spec) — verification per task is `npm run build` (TypeScript project build via `tsc -b` + Vite bundling) and, where noted, a live manual check against the real backend. This mirrors the spec's own Testing section: "verified manually via `npm run dev` ... the same 'run and look at it' verification pattern used throughout this project's CLI phases."
- **Path alias `@/*` → `web/src/*`** is configured in both `vite.config.ts` and `tsconfig.app.json` — use it in all imports (`@/components/...`, `@/lib/...`, `@/pages/...`), matching what `shadcn init` already wired up.
- **Every component is a thin consumer of `src/lib/api-client.ts`** — no component calls `fetch` directly; this keeps the SSE-parsing and error-shape logic in one place.
- **Client-side validation is required-fields-only** — `ProjectRegistry.register()` (backend) remains the actual source of truth for validity, per spec.

---

### Task 1: Scaffold `web/` — Vite + React + TypeScript + Tailwind v4 + shadcn/ui + react-router

**Files:**
- Create: `web/` (entire Vite project — `package.json`, `package-lock.json`, `vite.config.ts`, `tsconfig*.json`, `index.html`, `components.json`, `src/main.tsx`, `src/App.tsx`, `src/index.css`, `src/lib/utils.ts`, `src/components/ui/{button,card,badge,input,label,switch,sonner,scroll-area,dialog,alert-dialog}.tsx`, `public/favicon.svg`)

**Interfaces:**
- Consumes: nothing (this is the project root for the whole frontend)
- Produces: the `web/` Vite project itself, plus the `@` → `web/src` path alias and the 10 shadcn/ui primitives under `src/components/ui/`, consumed by every later task.

- [x] **Step 1: Scaffold the Vite React-TS project**

```bash
cd /path/to/project-rag
npm create vite@latest web -- --template react-ts
```

This generates `web/package.json` (React 19, Vite 8, TypeScript ~6.0), `web/vite.config.ts`, `web/tsconfig.json` (references `tsconfig.app.json`/`tsconfig.node.json`), `web/index.html`, `web/src/{main.tsx,App.tsx,index.css,App.css}`, `web/src/assets/{react.svg,vite.svg,hero.png}`, `web/public/{favicon.svg,icons.svg}`.

- [x] **Step 2: Remove the Vite demo boilerplate**

```bash
cd web
rm -f src/App.css src/assets/react.svg src/assets/vite.svg src/assets/hero.png public/icons.svg
rmdir src/assets
```

Set `<title>project-rag</title>` in `index.html` (was `<title>web</title>`).

- [x] **Step 3: Install and configure Tailwind CSS v4**

```bash
npm install tailwindcss @tailwindcss/vite
```

Replace `src/index.css`'s entire contents with:

```css
@import "tailwindcss";
```

(shadcn's init in Step 4 appends the real theme tokens on top of this.)

- [x] **Step 4: Add the `@` path alias and `ignoreDeprecations` (required by TS ~6.0's `baseUrl` deprecation) to `tsconfig.json` and `tsconfig.app.json`**

`tsconfig.json` gains:

```json
{
  "files": [],
  "references": [
    { "path": "./tsconfig.app.json" },
    { "path": "./tsconfig.node.json" }
  ],
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]
    }
  }
}
```

`tsconfig.app.json`'s `compilerOptions` gains (right after `tsBuildInfoFile`):

```json
    "ignoreDeprecations": "6.0",
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]
    },
```

Replace `vite.config.ts` with:

```typescript
import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  server: {
    proxy: {
      '/api': 'http://localhost:4300',
    },
  },
})
```

(`import.meta.dirname`, not `__dirname` — Vite 8's native config loader warns on `__dirname`.)

- [x] **Step 5: Run `shadcn init` and add the components this design needs**

```bash
npx shadcn@latest init -y -b radix -p nova
npx shadcn@latest add button card dialog alert-dialog badge input label switch sonner scroll-area -y
```

`-b radix` selects the Radix-based component library (per the spec's "shadcn/ui (Radix-based)" choice); `-p nova` selects the Nova preset (Lucide icons + Geist font). This writes `components.json`, appends full light/dark theme tokens to `src/index.css`, creates `src/lib/utils.ts` (the `cn()` helper), and installs `class-variance-authority`, `clsx`, `tailwind-merge`, `radix-ui`, `lucide-react`, `next-themes`, `@fontsource-variable/geist`, `tw-animate-css` as dependencies. The `add` command writes the 10 files listed above under `src/components/ui/`.

- [x] **Step 6: Install `react-router`**

```bash
npm install react-router
```

Install `react-router` (not `react-router-dom` — v8 removes it; `react-router` itself now includes the DOM bindings, imported as `from 'react-router'`).

- [x] **Step 7: Verify with a real build**

Run: `npm run build` (runs `tsc -b && vite build`)
Expected: clean build, `web/dist/index.html` + `web/dist/assets/*.{js,css}` produced. Confirmed clean in this session — 0 TypeScript errors, Vite build succeeds.

- [x] **Step 8: Commit**

```bash
git add web/
git commit -m "feat: scaffold web frontend (Vite + React + Tailwind v4 + shadcn/ui + react-router)"
```

---

### Task 2: `src/lib/api-client.ts` — REST + SSE Client

**Files:**
- Create: `web/src/lib/api-client.ts`

**Interfaces:**
- Consumes: nothing (talks to the backend's `/api/*` routes directly via `fetch`, proxied in dev by `vite.config.ts`)
- Produces: `interface Project { id, name, repository, paths, indexedFileCount, hookInstalled }`, `interface SearchResult { file, section, score, content }`, `interface RegisterProjectInput { id, repository, name?, paths? }`, `interface StreamHandlers { onLog, onDone, onError }`, and functions `listProjects()`, `getProject(id)`, `registerProject(input)`, `removeProject(id)`, `getKnowledge(id)`, `searchProject(id, query)`, `installHook(id)`, `uninstallHook(id)`, `ingestProject(id, handlers)`, `syncProject(id, handlers)` — consumed by every component/page in Tasks 3-8.

- [x] **Step 1: Write `src/lib/api-client.ts`**

```typescript
export interface Project {
  id: string
  name: string
  repository: string
  paths: string[]
  indexedFileCount: number
  hookInstalled: boolean
}

export interface SearchResult {
  file: string
  section: string
  score: number
  content: string
}

async function parseJsonResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(body.error ?? res.statusText)
  }
  return res.json() as Promise<T>
}

export function listProjects(): Promise<Project[]> {
  return fetch('/api/projects').then(parseJsonResponse<Project[]>)
}

export function getProject(id: string): Promise<Project> {
  return fetch(`/api/projects/${id}`).then(parseJsonResponse<Project>)
}

export interface RegisterProjectInput {
  id: string
  repository: string
  name?: string
  paths?: string[]
}

export function registerProject(input: RegisterProjectInput): Promise<Project> {
  return fetch('/api/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  }).then(parseJsonResponse<Project>)
}

export async function removeProject(id: string): Promise<void> {
  const res = await fetch(`/api/projects/${id}`, { method: 'DELETE' })
  if (!res.ok) await parseJsonResponse(res)
}

export function getKnowledge(id: string): Promise<{ files: string[] }> {
  return fetch(`/api/projects/${id}/knowledge`).then(parseJsonResponse<{ files: string[] }>)
}

export function searchProject(id: string, query: string): Promise<{ results: SearchResult[] }> {
  return fetch(`/api/projects/${id}/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  }).then(parseJsonResponse<{ results: SearchResult[] }>)
}

export async function installHook(id: string): Promise<void> {
  const res = await fetch(`/api/projects/${id}/hook`, { method: 'POST' })
  if (!res.ok) await parseJsonResponse(res)
}

export async function uninstallHook(id: string): Promise<void> {
  const res = await fetch(`/api/projects/${id}/hook`, { method: 'DELETE' })
  if (!res.ok) await parseJsonResponse(res)
}

export interface StreamHandlers {
  onLog: (message: string) => void
  onDone: (result: unknown) => void
  onError: (message: string) => void
}

/**
 * The ingest/sync endpoints are SSE streams triggered by POST, so the native
 * `EventSource` (GET-only, no body) can't consume them — this parses the
 * `event:`/`data:` wire format directly off a streamed `fetch` response body.
 */
async function streamRun(path: string, handlers: StreamHandlers): Promise<void> {
  const res = await fetch(path, { method: 'POST' })
  if (!res.ok || !res.body) {
    const body = await res.json().catch(() => ({ error: res.statusText }))
    handlers.onError(body.error ?? res.statusText)
    return
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    const frames = buffer.split('\n\n')
    buffer = frames.pop() ?? ''

    for (const frame of frames) {
      const lines = frame.split('\n')
      const eventLine = lines.find((line) => line.startsWith('event: '))
      const dataLine = lines.find((line) => line.startsWith('data: '))
      if (!eventLine || !dataLine) continue

      const event = eventLine.slice('event: '.length)
      const data = JSON.parse(dataLine.slice('data: '.length))

      if (event === 'log') handlers.onLog(data)
      else if (event === 'done') handlers.onDone(data)
      else if (event === 'error') handlers.onError(data.message)
    }
  }
}

export function ingestProject(id: string, handlers: StreamHandlers): Promise<void> {
  return streamRun(`/api/projects/${id}/ingest`, handlers)
}

export function syncProject(id: string, handlers: StreamHandlers): Promise<void> {
  return streamRun(`/api/projects/${id}/sync`, handlers)
}
```

- [x] **Step 2: Verify with a real build**

Run: `npm run build`
Expected: clean build. Confirmed clean in this session.

- [x] **Step 3: Commit**

```bash
git add web/src/lib/api-client.ts
git commit -m "feat: add REST + SSE API client for the web frontend"
```

---

### Task 3: Shared Components — `ProjectCard`, `HookToggle`, `DeleteConfirmModal`

**Files:**
- Create: `web/src/components/project-card.tsx`
- Create: `web/src/components/hook-toggle.tsx`
- Create: `web/src/components/delete-confirm-modal.tsx`

**Interfaces:**
- Consumes: `Project`, `syncProject`, `installHook`, `uninstallHook`, `removeProject` (Task 2); shadcn `Card`/`Badge`/`Button`/`Switch`/`AlertDialog*` (Task 1)
- Produces: `<ProjectCard project={Project} />`, `<HookToggle projectId installed onChange />`, `<DeleteConfirmModal projectId projectName onRemoved />` — consumed by Tasks 7-8 (Dashboard, Project Detail pages).

- [x] **Step 1: Write `src/components/project-card.tsx`**

```tsx
import { useState, type MouseEvent } from 'react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { syncProject, type Project } from '@/lib/api-client'

export function ProjectCard({ project }: { project: Project }) {
  const [syncing, setSyncing] = useState(false)

  async function handleSync(event: MouseEvent) {
    event.preventDefault()
    setSyncing(true)
    try {
      await syncProject(project.id, {
        onLog: () => {},
        onDone: () => toast.success(`Sync finished for "${project.name}".`),
        onError: (message) => toast.error(message),
      })
    } finally {
      setSyncing(false)
    }
  }

  return (
    <Link to={`/projects/${project.id}`}>
      <Card className="transition-colors hover:bg-muted/50">
        <CardHeader>
          <CardTitle>{project.name}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="truncate text-sm text-muted-foreground">{project.repository}</p>
          <div className="flex items-center gap-2">
            <Badge variant="secondary">{project.indexedFileCount} files indexed</Badge>
            <Badge variant={project.hookInstalled ? 'default' : 'outline'}>
              {project.hookInstalled ? 'Auto-sync on' : 'Auto-sync off'}
            </Badge>
          </div>
        </CardContent>
        <CardFooter>
          <Button size="sm" variant="outline" disabled={syncing} onClick={handleSync}>
            {syncing ? 'Syncing...' : 'Sync'}
          </Button>
        </CardFooter>
      </Card>
    </Link>
  )
}
```

- [x] **Step 2: Write `src/components/hook-toggle.tsx`**

```tsx
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
```

- [x] **Step 3: Write `src/components/delete-confirm-modal.tsx`**

```tsx
import { useState } from 'react'
import { toast } from 'sonner'
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
import { Button } from '@/components/ui/button'
import { removeProject } from '@/lib/api-client'

export function DeleteConfirmModal({
  projectId,
  projectName,
  onRemoved,
}: {
  projectId: string
  projectName: string
  onRemoved: () => void
}) {
  const [removing, setRemoving] = useState(false)

  async function handleConfirm() {
    setRemoving(true)
    try {
      await removeProject(projectId)
      toast.success(`Removed "${projectName}" from the registry.`)
      onRemoved()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setRemoving(false)
    }
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="outline" size="sm">
          Remove project
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove "{projectName}"?</AlertDialogTitle>
          <AlertDialogDescription>
            This only unregisters the project from project-rag. It does not delete any Qdrant vectors or the Git
            repository itself.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction disabled={removing} onClick={handleConfirm}>
            {removing ? 'Removing...' : 'Remove'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
```

- [x] **Step 4: Verify with a real build**

Run: `npm run build`
Expected: clean build (these components aren't imported anywhere yet, but `tsc -b` typechecks all files under `src/` regardless).

- [x] **Step 5: Commit**

```bash
git add web/src/components/project-card.tsx web/src/components/hook-toggle.tsx web/src/components/delete-confirm-modal.tsx
git commit -m "feat: add ProjectCard, HookToggle, DeleteConfirmModal components"
```

---

### Task 4: `AddProjectModal`

**Files:**
- Create: `web/src/components/add-project-modal.tsx`

**Interfaces:**
- Consumes: `registerProject`, `Project` (Task 2); shadcn `Dialog*`/`Input`/`Label`/`Button` (Task 1)
- Produces: `<AddProjectModal onRegistered={(project: Project) => void} />` — consumed by Task 7 (Dashboard page).

- [x] **Step 1: Write `src/components/add-project-modal.tsx`**

```tsx
import { useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { registerProject, type Project } from '@/lib/api-client'

function fieldForError(message: string): 'id' | 'repository' | 'general' {
  if (message.includes('already registered')) return 'id'
  if (message.includes('Repository path does not exist') || message.includes('Not a Git repository')) {
    return 'repository'
  }
  return 'general'
}

export function AddProjectModal({ onRegistered }: { onRegistered: (project: Project) => void }) {
  const [open, setOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [errors, setErrors] = useState<{ id?: string; repository?: string; general?: string }>({})

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setErrors({})
    setSubmitting(true)

    const form = new FormData(event.currentTarget)
    const id = String(form.get('id') ?? '').trim()
    const repository = String(form.get('repository') ?? '').trim()
    const name = String(form.get('name') ?? '').trim()
    const pathsRaw = String(form.get('paths') ?? '').trim()

    try {
      const project = await registerProject({
        id,
        repository,
        name: name || undefined,
        paths: pathsRaw ? pathsRaw.split(',').map((p) => p.trim()).filter(Boolean) : undefined,
      })
      toast.success(`Registered "${project.name}".`)
      onRegistered(project)
      setOpen(false)
      event.currentTarget.reset()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setErrors({ [fieldForError(message)]: message })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>+ Add Project</Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Register a project</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-4">
            <div className="grid gap-1.5">
              <Label htmlFor="id">Project ID</Label>
              <Input id="id" name="id" required placeholder="my-project" />
              {errors.id && <p className="text-sm text-destructive">{errors.id}</p>}
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="repository">Repository path</Label>
              <Input id="repository" name="repository" required placeholder="/path/to/repo" />
              {errors.repository && <p className="text-sm text-destructive">{errors.repository}</p>}
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="name">Display name (optional)</Label>
              <Input id="name" name="name" placeholder="My Project" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="paths">Paths to index (optional, comma-separated)</Label>
              <Input id="paths" name="paths" placeholder="docs,notes" />
            </div>
            {errors.general && <p className="text-sm text-destructive">{errors.general}</p>}
          </div>
          <DialogFooter>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Registering...' : 'Register'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
```

`fieldForError` maps the backend's plain-string `ProjectRegistry.register()` errors ("Repository path does not exist: X", "Not a Git repository: X", "Project \"id\" is already registered") to the field they concern, per the spec's "surfaces the API's error message next to the relevant field" requirement.

- [x] **Step 2: Verify with a real build**

Run: `npm run build`
Expected: clean build.

- [x] **Step 3: Commit**

```bash
git add web/src/components/add-project-modal.tsx
git commit -m "feat: add AddProjectModal component"
```

---

### Task 5: `SearchPanel`

**Files:**
- Create: `web/src/components/search-panel.tsx`

**Interfaces:**
- Consumes: `searchProject`, `SearchResult` (Task 2); shadcn `Input`/`Button`/`ScrollArea` (Task 1)
- Produces: `<SearchPanel projectId={string} />` — consumed by Task 8 (Project Detail page).

- [x] **Step 1: Write `src/components/search-panel.tsx`**

```tsx
import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { searchProject, type SearchResult } from '@/lib/api-client'

export function SearchPanel({ projectId }: { projectId: string }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [searched, setSearched] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!query.trim()) return
    setLoading(true)
    setError(null)
    try {
      const { results } = await searchProject(projectId, query)
      setResults(results)
      setSearched(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <form onSubmit={handleSubmit} className="flex gap-2">
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search this project's docs..."
        />
        <Button type="submit" disabled={loading}>
          {loading ? 'Searching...' : 'Search'}
        </Button>
      </form>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {searched && !error && results.length === 0 && (
        <p className="text-sm text-muted-foreground">No results found.</p>
      )}
      {results.length > 0 && (
        <ScrollArea className="h-64 rounded-lg border">
          <div className="flex flex-col divide-y">
            {results.map((result, i) => (
              <div key={`${result.file}-${i}`} className="p-3">
                <div className="flex items-center justify-between text-sm font-medium">
                  <span>
                    {result.file} — {result.section}
                  </span>
                  <span className="text-muted-foreground">{result.score.toFixed(4)}</span>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{result.content}</p>
              </div>
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  )
}
```

- [x] **Step 2: Verify with a real build**

Run: `npm run build`
Expected: clean build.

- [x] **Step 3: Commit**

```bash
git add web/src/components/search-panel.tsx
git commit -m "feat: add SearchPanel component"
```

---

### Task 6: `LogStream`

**Files:**
- Create: `web/src/components/log-stream.tsx`

**Interfaces:**
- Consumes: `ingestProject`, `syncProject` (Task 2); shadcn `Button`/`ScrollArea` (Task 1)
- Produces: `<LogStream projectId={string} onFinished={() => void} />` — consumed by Task 8 (Project Detail page).

- [x] **Step 1: Write `src/components/log-stream.tsx`**

```tsx
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { ingestProject, syncProject } from '@/lib/api-client'

export function LogStream({ projectId, onFinished }: { projectId: string; onFinished: () => void }) {
  const [running, setRunning] = useState<'ingest' | 'sync' | null>(null)
  const [lines, setLines] = useState<string[]>([])
  const [visible, setVisible] = useState(false)

  async function run(mode: 'ingest' | 'sync') {
    setRunning(mode)
    setLines([])
    setVisible(true)
    const runner = mode === 'ingest' ? ingestProject : syncProject
    await runner(projectId, {
      onLog: (message) => setLines((prev) => [...prev, message]),
      onDone: () => {
        toast.success(`${mode === 'ingest' ? 'Ingest' : 'Sync'} finished.`)
        setLines((prev) => [...prev, `${mode === 'ingest' ? 'Ingest' : 'Sync'} completed.`])
        setRunning(null)
        onFinished()
      },
      onError: (message) => {
        toast.error(message)
        setLines((prev) => [...prev, `Error: ${message}`])
        setRunning(null)
      },
    })
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2">
        <Button variant="outline" disabled={running !== null} onClick={() => run('ingest')}>
          {running === 'ingest' ? 'Ingesting...' : 'Ingest'}
        </Button>
        <Button variant="outline" disabled={running !== null} onClick={() => run('sync')}>
          {running === 'sync' ? 'Syncing...' : 'Sync'}
        </Button>
      </div>
      {visible && (
        <ScrollArea className="h-48 animate-in fade-in slide-in-from-top-1 rounded-lg border bg-black p-3 font-mono text-xs text-green-400 duration-150">
          {lines.map((line, i) => (
            <div key={i}>{line}</div>
          ))}
        </ScrollArea>
      )}
    </div>
  )
}
```

The `animate-in fade-in slide-in-from-top-1` classes (from `tw-animate-css`, installed by `shadcn init`) give the log panel a smooth appearance transition rather than an abrupt show/hide, per the spec's interaction/polish requirement.

- [x] **Step 2: Verify with a real build**

Run: `npm run build`
Expected: clean build.

- [x] **Step 3: Commit**

```bash
git add web/src/components/log-stream.tsx
git commit -m "feat: add LogStream component"
```

---

### Task 7: Dashboard Page

**Files:**
- Create: `web/src/pages/dashboard.tsx`

**Interfaces:**
- Consumes: `listProjects`, `Project` (Task 2); `ProjectCard` (Task 3); `AddProjectModal` (Task 4)
- Produces: `<Dashboard />` — consumed by Task 9 (`App.tsx` routing).

- [x] **Step 1: Write `src/pages/dashboard.tsx`**

```tsx
import { useEffect, useState } from 'react'
import { AddProjectModal } from '@/components/add-project-modal'
import { ProjectCard } from '@/components/project-card'
import { listProjects, type Project } from '@/lib/api-client'

export function Dashboard() {
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  async function refresh() {
    setLoading(true)
    try {
      setProjects(await listProjects())
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
  }, [])

  return (
    <div className="mx-auto max-w-5xl p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-medium">project-rag</h1>
        <AddProjectModal onRegistered={() => refresh()} />
      </div>
      {loading && <p className="text-sm text-muted-foreground">Loading...</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}
      {!loading && !error && projects.length === 0 && (
        <p className="text-sm text-muted-foreground">No projects registered yet.</p>
      )}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {projects.map((project) => (
          <ProjectCard key={project.id} project={project} />
        ))}
      </div>
    </div>
  )
}
```

- [x] **Step 2: Verify with a real build**

Run: `npm run build`
Expected: clean build.

- [x] **Step 3: Commit**

```bash
git add web/src/pages/dashboard.tsx
git commit -m "feat: add Dashboard page"
```

---

### Task 8: Project Detail Page

**Files:**
- Create: `web/src/pages/project-detail.tsx`

**Interfaces:**
- Consumes: `getProject`, `getKnowledge`, `Project` (Task 2); `DeleteConfirmModal` (Task 3); `HookToggle` (Task 3); `SearchPanel` (Task 5); `LogStream` (Task 6)
- Produces: `<ProjectDetail />` — consumed by Task 9 (`App.tsx` routing).

- [x] **Step 1: Write `src/pages/project-detail.tsx`**

```tsx
import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { DeleteConfirmModal } from '@/components/delete-confirm-modal'
import { HookToggle } from '@/components/hook-toggle'
import { LogStream } from '@/components/log-stream'
import { SearchPanel } from '@/components/search-panel'
import { ScrollArea } from '@/components/ui/scroll-area'
import { getKnowledge, getProject, type Project } from '@/lib/api-client'

export function ProjectDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [project, setProject] = useState<Project | null>(null)
  const [files, setFiles] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!id) return
    try {
      const [projectData, knowledge] = await Promise.all([getProject(id), getKnowledge(id)])
      setProject(projectData)
      setFiles(knowledge.files)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [id])

  useEffect(() => {
    refresh()
  }, [refresh])

  if (!id) return null
  if (error) return <p className="p-6 text-sm text-destructive">{error}</p>
  if (!project) return <p className="p-6 text-sm text-muted-foreground">Loading...</p>

  return (
    <div className="mx-auto max-w-5xl p-6">
      <Link to="/" className="text-sm text-muted-foreground hover:underline">
        &larr; Back to dashboard
      </Link>

      <div className="mt-2 mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-medium">{project.name}</h1>
          <p className="text-sm text-muted-foreground">{project.repository}</p>
        </div>
        <DeleteConfirmModal projectId={project.id} projectName={project.name} onRemoved={() => navigate('/')} />
      </div>

      <div className="mb-6">
        <HookToggle
          projectId={project.id}
          installed={project.hookInstalled}
          onChange={(installed) => setProject({ ...project, hookInstalled: installed })}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <div>
          <h2 className="mb-2 text-sm font-medium">Indexed files ({files.length})</h2>
          <ScrollArea className="h-64 rounded-lg border">
            <div className="flex flex-col divide-y">
              {files.map((file) => (
                <div key={file} className="p-2 font-mono text-xs">
                  {file}
                </div>
              ))}
            </div>
          </ScrollArea>
        </div>
        <div>
          <h2 className="mb-2 text-sm font-medium">Search</h2>
          <SearchPanel projectId={project.id} />
        </div>
      </div>

      <div className="mt-6">
        <h2 className="mb-2 text-sm font-medium">Ingest / Sync</h2>
        <LogStream projectId={project.id} onFinished={() => refresh()} />
      </div>
    </div>
  )
}
```

- [x] **Step 2: Verify with a real build**

Run: `npm run build`
Expected: clean build.

- [x] **Step 3: Commit**

```bash
git add web/src/pages/project-detail.tsx
git commit -m "feat: add Project Detail page"
```

---

### Task 9: Wire Routing (`App.tsx`), Verify End-to-End, Update Docs

**Files:**
- Modify: `web/src/App.tsx`
- Modify: `docs/features/README.md`
- Create: `docs/features/07-web-frontend-and-project-cli.md`

**Interfaces:**
- Consumes: `Dashboard` (Task 7), `ProjectDetail` (Task 8), shadcn `Toaster` (Task 1)
- Produces: the fully wired SPA — no further consumers within this plan.

- [x] **Step 1: Replace `src/App.tsx`**

```tsx
import { BrowserRouter, Routes, Route } from 'react-router'
import { Toaster } from '@/components/ui/sonner'
import { Dashboard } from '@/pages/dashboard'
import { ProjectDetail } from '@/pages/project-detail'

function App() {
  return (
    <BrowserRouter>
      <Toaster />
      <Routes>
        <Route index element={<Dashboard />} />
        <Route path="projects/:id" element={<ProjectDetail />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
```

`main.tsx` is untouched — the Vite scaffold's default already renders `<App />` inside `<StrictMode>`.

- [x] **Step 2: Verify with a real build and lint**

Run: `npm run build && npx oxlint src`
Expected: clean build; lint clean except the two pre-existing shadcn-generated `react(only-export-components)` warnings in `src/components/ui/{button,card}.tsx` (shadcn's own boilerplate, not modified by this plan).

- [x] **Step 3: Full-stack manual verification**

Build the backend, start `project-rag web`, and confirm it serves the built SPA, its JS bundle, the SPA client-route fallback, and the API together:

```bash
cd /path/to/project-rag
npm run build   # backend
cd web && npm run build && cd ..
QDRANT_URL=http://localhost:6333 EMBEDDING_PROVIDER=ollama EMBEDDING_MODEL=bge-m3 PROJECT_REGISTRY_PATH=/path/to/scratch/projects.json node dist/cli/index.js web --port 4300
```

Then, from another shell: `GET /` returns the built `index.html` referencing the real hashed JS/CSS asset filenames; `GET /assets/<hash>.js` returns the bundle with `Content-Type: text/javascript`; `GET /projects/demo` (a client-only route) still returns the SPA's `index.html` via the catch-all (status 200); `GET /api/projects` returns `[]`. All four confirmed working in this session.

Note: a real interactive click-through in an actual browser (register a project, sync it, watch the log stream, search, toggle the hook, remove the project) was **not** performed in this session — no browser automation tool was available. This is the one gap between this plan's verification and the spec's "run and look at it" testing note; flag this to your human partner so they can do a quick manual click-through against `npm run dev` (proxying to a running `project-rag web`) before considering the feature fully done.

- [x] **Step 4: Update `docs/features/README.md` and add the new feature doc**

Add `docs/features/07-web-frontend-and-project-cli.md` documenting: the `project-rag project register/list/remove` CLI subcommands, the `project-rag web` command, every `/api/*` route, and the Dashboard/Project Detail pages — following the structure of the existing `docs/features/*.md` files, marked **Status: Implemented**, with real file paths (`src/cli/project-command.ts`, `src/server/app.ts`, `src/server/routes/*.ts`, `web/src/pages/*.tsx`, `web/src/components/*.tsx`, `web/src/lib/api-client.ts`). Replace `docs/features/README.md`'s `**Recent**:` line with this feature's completion (do not append), and add this doc to the index.

- [ ] **Step 5: Commit**

```bash
git add web/src/App.tsx docs/features/README.md docs/features/07-web-frontend-and-project-cli.md
git commit -m "feat: wire frontend routing and document the web frontend feature"
```
