# Web Backend: CLI Project Subcommands + REST API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the backend half of `docs/superpowers/specs/2026-08-08-web-frontend-design.md` — the `project-rag project register/list/remove` CLI subcommands (`init.md` §18, never built) and a small Express REST API (`src/server/`) that the web frontend (a separate follow-up plan) will consume. Every route is a thin wrapper over existing, unmodified functions (`ProjectRegistry`, `indexProject`, `syncProject`, `searchProject`, `installHook`/`uninstallHook`) — nothing in `src/ingestion/`, `src/qdrant/`, `src/embedding/`, `src/retrieval/`, `src/mcp/`, or the existing CLI commands changes.

**Architecture:** A tiny shared `src/cli/project-command.ts` (register/list/remove logic, delegating to `ProjectRegistry`) used by BOTH the new CLI `project` subcommand and the new `POST/GET/DELETE /api/projects` routes — no duplicated logic between the two callers. A new `src/git/hook-installer.ts` export, `isHookInstalled`, answers "is the hook currently installed" by reading the real hook file (no cached/optimistic state). The API itself is one Express app (`src/server/app.ts`) assembling six small route-registration functions plus a tiny SSE helper for the two streaming endpoints (`ingest`/`sync`), started by a new `project-rag web [--port 4300]` CLI command — this plan wires the command and the app, but the actual frontend it will serve is a separate plan.

**Dependency verification (done before writing this plan, not guessed):** `express` (v5.2.1), `supertest`/`@types/supertest` were installed and smoke-tested directly (`express.Router()` sub-mounting, `:id` params, `express.json()` body parsing, and — critically — Express 5's wildcard-route syntax change, which is why the SPA-fallback handler in this plan uses a path-less `app.use((req, res) => {...})` instead of the no-longer-valid bare `'*'` pattern). `express`/`@types/express`/`supertest`/`@types/supertest` are already installed and present in `package.json` (express as a `dependencies` entry, the rest as `devDependencies`) as of this plan being written.

**Tech Stack:** Node.js 24, TypeScript, Vitest, Express 5.2.1, `supertest` for route tests — no other new dependencies.

## Global Constraints

- **No changes to existing, already-shipped modules.** `src/ingestion/*`, `src/qdrant/*` (except one new export), `src/embedding/*`, `src/retrieval/*`, `src/mcp/*`, and every existing CLI command's behavior stay exactly as they are. This plan only adds new callers on top of them.
- **No duplicated logic between the CLI and the API.** `project register/list/remove` logic lives once, in `src/cli/project-command.ts`; both the CLI's `project` subcommand and the API's `/api/projects` routes call it. Every other route calls the existing `indexProject`/`syncProject`/`searchProject`/`installHook`/`uninstallHook`/`getIndexedFileHashes` directly, the same way the CLI's own `*-command.ts` files already do.
- **Solo-user, localhost only.** No authentication, no session handling, no CORS configuration beyond what's needed for `localhost` (none, since the frontend will be served by this same server, same-origin).
- **Mock `ProjectRegistry`/Qdrant client/embedding provider in tests** — no live Qdrant/embedding server required, matching every prior phase's testing convention.
- **SSE endpoints reuse the existing `onLog` callback** already present on `indexProject`/`syncProject` since Phase 2/3 — no changes to those functions' signatures or internals.
- **Express 5's catch-all/wildcard route syntax changed from bare `'*'`** — any path-less fallback middleware must use `app.use((req, res) => {...})` with no path argument at all (verified working directly, see above), never `app.get('*', ...)`.

---

### Task 1: `isHookInstalled` — Real Hook-Status Check

**Files:**
- Modify: `src/git/hook-installer.ts` (add one function; existing `installHook`/`uninstallHook`/constants untouched)
- Modify: `tests/git/hook-installer.test.ts` (add tests; existing tests untouched)

**Interfaces:**
- Consumes: nothing new (reuses this file's own `MARKER_START` constant)
- Produces: `function isHookInstalled(repositoryPath: string): boolean` — consumed by Task 6's `GET /api/projects` and `GET /api/projects/:id` routes.

- [ ] **Step 1: Write the failing test**

Add to `tests/git/hook-installer.test.ts` (append a new `describe` block after the existing ones — do not modify any existing test):

```typescript
describe('isHookInstalled', () => {
  let dir: string;
  let repo: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'project-rag-hook-status-'));
    repo = path.join(dir, 'repo');
    mkdirSync(path.join(repo, '.git', 'hooks'), { recursive: true });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns false when no hook file exists', () => {
    expect(isHookInstalled(repo)).toBe(false);
  });

  it('returns false when a hook file exists but is not ours', () => {
    writeFileSync(path.join(repo, '.git', 'hooks', 'post-commit'), '#!/bin/sh\necho "custom user hook"\n');
    expect(isHookInstalled(repo)).toBe(false);
  });

  it('returns true after installHook has run', () => {
    installHook(repo, 'sample', { nodePath: 'node', cliEntrypoint: '/x/index.js' });
    expect(isHookInstalled(repo)).toBe(true);
  });

  it('returns false after uninstallHook has run', () => {
    installHook(repo, 'sample', { nodePath: 'node', cliEntrypoint: '/x/index.js' });
    uninstallHook(repo);
    expect(isHookInstalled(repo)).toBe(false);
  });
});
```

Also update the import line at the top of the test file to include `isHookInstalled`:

```typescript
import { installHook, uninstallHook, isHookInstalled } from '../../src/git/hook-installer';
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/git/hook-installer.test.ts`
Expected: FAIL — `isHookInstalled` is not exported yet.

- [ ] **Step 3: Add the implementation**

Add to `src/git/hook-installer.ts` (append after the existing `uninstallHook` function — do not modify anything above it):

```typescript
export function isHookInstalled(repositoryPath: string): boolean {
  const hookPath = path.join(repositoryPath, '.git', 'hooks', 'post-commit');
  if (!existsSync(hookPath)) return false;
  return readFileSync(hookPath, 'utf8').includes(MARKER_START);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/git/hook-installer.test.ts`
Expected: PASS (11 tests: 7 existing + 4 new).

- [ ] **Step 5: Run the full suite and typecheck for real**

Run: `npm run typecheck && npm test`
Expected: clean typecheck, all tests passing. Actually run these and paste the real output.

- [ ] **Step 6: Commit**

```bash
git add src/git/hook-installer.ts tests/git/hook-installer.test.ts
git commit -m "feat: add isHookInstalled real hook-status check"
```

---

### Task 2: Shared `project-command.ts` (register/list/remove)

**Files:**
- Create: `src/cli/project-command.ts`
- Test: `tests/cli/project-command.test.ts`

**Interfaces:**
- Consumes: `ProjectRegistry`/`ProjectConfig` (Phase 1 `src/projects/project-registry.ts`, `src/projects/project-types.ts`)
- Produces: `interface RunProjectRegisterInput { id: string; repository: string; name?: string; paths?: string[] }`, `function runProjectRegister(registry: ProjectRegistry, input: RunProjectRegisterInput): ProjectConfig`, `function runProjectList(registry: ProjectRegistry): ProjectConfig[]`, and `function runProjectRemove(registry: ProjectRegistry, id: string): void` — consumed by Task 4's CLI wiring AND Task 6's `/api/projects` routes (this is the one place this logic exists).

- [ ] **Step 1: Write the failing test**

`tests/cli/project-command.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { runProjectRegister, runProjectList, runProjectRemove } from '../../src/cli/project-command';

describe('runProjectRegister', () => {
  it('delegates to registry.register with the given input', () => {
    const registry = {
      register: vi.fn().mockReturnValue({ id: 'sample', name: 'Sample', repository: '/r', paths: ['docs'] }),
    } as any;

    const result = runProjectRegister(registry, { id: 'sample', repository: '/r', name: 'Sample', paths: ['docs'] });

    expect(registry.register).toHaveBeenCalledWith('sample', '/r', { name: 'Sample', paths: ['docs'] });
    expect(result).toEqual({ id: 'sample', name: 'Sample', repository: '/r', paths: ['docs'] });
  });

  it('passes undefined name/paths through when not provided', () => {
    const registry = { register: vi.fn().mockReturnValue({ id: 'sample', name: 'sample', repository: '/r', paths: ['docs'] }) } as any;

    runProjectRegister(registry, { id: 'sample', repository: '/r' });

    expect(registry.register).toHaveBeenCalledWith('sample', '/r', { name: undefined, paths: undefined });
  });
});

describe('runProjectList', () => {
  it('delegates to registry.list', () => {
    const registry = { list: vi.fn().mockReturnValue([{ id: 'a', name: 'A', repository: '/a', paths: ['docs'] }]) } as any;

    expect(runProjectList(registry)).toEqual([{ id: 'a', name: 'A', repository: '/a', paths: ['docs'] }]);
    expect(registry.list).toHaveBeenCalled();
  });
});

describe('runProjectRemove', () => {
  it('delegates to registry.remove', () => {
    const registry = { remove: vi.fn() } as any;

    runProjectRemove(registry, 'sample');

    expect(registry.remove).toHaveBeenCalledWith('sample');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/cli/project-command.test.ts`
Expected: FAIL with "Cannot find module '../../src/cli/project-command'".

- [ ] **Step 3: Write minimal implementation**

`src/cli/project-command.ts`:

```typescript
import type { ProjectRegistry } from '../projects/project-registry';
import type { ProjectConfig } from '../projects/project-types';

export interface RunProjectRegisterInput {
  id: string;
  repository: string;
  name?: string;
  paths?: string[];
}

export function runProjectRegister(registry: ProjectRegistry, input: RunProjectRegisterInput): ProjectConfig {
  return registry.register(input.id, input.repository, { name: input.name, paths: input.paths });
}

export function runProjectList(registry: ProjectRegistry): ProjectConfig[] {
  return registry.list();
}

export function runProjectRemove(registry: ProjectRegistry, id: string): void {
  registry.remove(id);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/cli/project-command.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Run the full suite and typecheck for real**

Run: `npm run typecheck && npm test`
Expected: clean typecheck, all tests passing. Paste the real output.

- [ ] **Step 6: Commit**

```bash
git add src/cli/project-command.ts tests/cli/project-command.test.ts
git commit -m "feat: add shared project register/list/remove command logic"
```

---

### Task 3: CLI Args — `project` and `web` Commands

**Files:**
- Modify: `src/cli/args.ts` (add `project register|list|remove` and `web [--port N]`)
- Modify: `tests/cli/args.test.ts` (add cases; existing 15 cases untouched)

**Interfaces:**
- Consumes: nothing new
- Produces: updated `ParsedArgs` union including `{ command: 'project'; action: 'list' }`, `{ command: 'project'; action: 'remove'; id: string }`, `{ command: 'project'; action: 'register'; id: string; repository: string; name?: string; paths?: string[] }`, and `{ command: 'web'; port?: number }` — consumed by Task 4 (`project`) and a later task in the frontend plan (`web`, once `src/server/app.ts` exists).

- [ ] **Step 1: Write the failing tests**

Read the current `tests/cli/args.test.ts` first, then add these cases inside the existing `describe('parseArgs', ...)` block (do not remove the existing 15 cases):

```typescript
  it('parses project list', () => {
    expect(parseArgs(['project', 'list'])).toEqual({ command: 'project', action: 'list' });
  });

  it('parses project remove with an id', () => {
    expect(parseArgs(['project', 'remove', 'bidubadu'])).toEqual({
      command: 'project',
      action: 'remove',
      id: 'bidubadu',
    });
  });

  it('parses project register with id and repository, no flags', () => {
    expect(parseArgs(['project', 'register', 'bidubadu', '/repo'])).toEqual({
      command: 'project',
      action: 'register',
      id: 'bidubadu',
      repository: '/repo',
      name: undefined,
      paths: undefined,
    });
  });

  it('parses project register with --name and --paths flags', () => {
    expect(
      parseArgs(['project', 'register', 'bidubadu', '/repo', '--name', 'Bidubadu', '--paths', 'docs,notes']),
    ).toEqual({
      command: 'project',
      action: 'register',
      id: 'bidubadu',
      repository: '/repo',
      name: 'Bidubadu',
      paths: ['docs', 'notes'],
    });
  });

  it('returns unknown for project register missing a repository', () => {
    expect(parseArgs(['project', 'register', 'bidubadu'])).toEqual({ command: 'unknown' });
  });

  it('returns unknown for an unrecognized project action', () => {
    expect(parseArgs(['project', 'bogus'])).toEqual({ command: 'unknown' });
  });

  it('parses the web command with no port', () => {
    expect(parseArgs(['web'])).toEqual({ command: 'web', port: undefined });
  });

  it('parses the web command with an explicit port', () => {
    expect(parseArgs(['web', '--port', '5000'])).toEqual({ command: 'web', port: 5000 });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/cli/args.test.ts`
Expected: FAIL — `parseArgs` doesn't recognize `'project'`/`'web'` yet.

- [ ] **Step 3: Update `src/cli/args.ts`**

Read the current file first, then replace its entire contents with:

```typescript
export type ParsedArgs =
  | { command: 'ingest'; projectId: string }
  | { command: 'sync'; projectId: string }
  | { command: 'search'; projectId: string; query: string }
  | { command: 'mcp' }
  | { command: 'hook'; action: 'install' | 'uninstall'; projectId: string }
  | { command: 'project'; action: 'list' }
  | { command: 'project'; action: 'remove'; id: string }
  | { command: 'project'; action: 'register'; id: string; repository: string; name?: string; paths?: string[] }
  | { command: 'web'; port?: number }
  | { command: 'unknown' };

export function parseArgs(argv: string[]): ParsedArgs {
  const [command, ...restArgs] = argv;

  if (command === 'mcp') {
    return { command: 'mcp' };
  }

  if (command === 'web') {
    const portIndex = restArgs.indexOf('--port');
    const port = portIndex !== -1 && restArgs[portIndex + 1] ? Number(restArgs[portIndex + 1]) : undefined;
    return { command: 'web', port };
  }

  if (command === 'hook') {
    const [action, projectId] = restArgs;
    if ((action === 'install' || action === 'uninstall') && projectId) {
      return { command: 'hook', action, projectId };
    }
    return { command: 'unknown' };
  }

  if (command === 'project') {
    const [action, ...projectArgs] = restArgs;
    if (action === 'list') {
      return { command: 'project', action: 'list' };
    }
    if (action === 'remove' && projectArgs[0]) {
      return { command: 'project', action: 'remove', id: projectArgs[0] };
    }
    if (action === 'register' && projectArgs[0] && projectArgs[1]) {
      const [id, repository, ...flags] = projectArgs;
      const { name, paths } = parseProjectFlags(flags);
      return { command: 'project', action: 'register', id, repository, name, paths };
    }
    return { command: 'unknown' };
  }

  if ((command === 'ingest' || command === 'sync') && restArgs[0]) {
    return { command, projectId: restArgs[0] };
  }

  if (command === 'search' && restArgs[0] && restArgs.length > 1) {
    return { command: 'search', projectId: restArgs[0], query: restArgs.slice(1).join(' ') };
  }

  return { command: 'unknown' };
}

function parseProjectFlags(flags: string[]): { name?: string; paths?: string[] } {
  let name: string | undefined;
  let paths: string[] | undefined;
  for (let i = 0; i < flags.length; i++) {
    if (flags[i] === '--name' && flags[i + 1]) {
      name = flags[i + 1];
      i++;
    } else if (flags[i] === '--paths' && flags[i + 1]) {
      paths = flags[i + 1]
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean);
      i++;
    }
  }
  return { name, paths };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/cli/args.test.ts`
Expected: PASS (23 tests: 15 existing + 8 new). All 15 pre-existing cases must still pass unchanged.

- [ ] **Step 5: Run the full suite and typecheck for real**

Run: `npm run typecheck && npm test`
Expected: clean typecheck — note `src/cli/index.ts` does NOT yet handle `'project'`/`'web'` in this task, so this step only typechecks/tests `args.ts` in isolation being correct; the next task wires `'project'` into `index.ts`. If `npm run typecheck` fails because `index.ts`'s final fallthrough code now can't prove `parsed` is narrowed to `'search'` only, that's expected and gets fixed in Task 4 — do not attempt to fix `index.ts` in this task, only confirm `args.test.ts` passes standalone (`npx vitest run tests/cli/args.test.ts`) and move on.

- [ ] **Step 6: Commit**

```bash
git add src/cli/args.ts tests/cli/args.test.ts
git commit -m "feat: add project and web commands to CLI argument parsing"
```

---

### Task 4: CLI `project` Command Wiring

**Files:**
- Modify: `src/cli/index.ts` (add the `project` branch; `web` is NOT wired yet — that's a later task, once `src/server/app.ts` exists)

**Interfaces:**
- Consumes: `runProjectRegister`/`runProjectList`/`runProjectRemove` (Task 2), `ParsedArgs`'s `project`/`web` variants (Task 3)
- Produces: nothing new — this task only wires existing pieces together in `index.ts`.

- [ ] **Step 1: Read the current `src/cli/index.ts` and add the `project` branch**

Add a new import line after the existing `import { runHookCommand } from './hook-command';` line:

```typescript
import { runProjectRegister, runProjectList, runProjectRemove } from './project-command';
```

Add a new branch immediately after the `hook` branch's closing `}` (before the `if (parsed.command === 'ingest')` branch):

```typescript
  if (parsed.command === 'project') {
    if (parsed.action === 'list') {
      const projects = runProjectList(registry);
      if (projects.length === 0) {
        console.log('No projects registered.');
      } else {
        for (const p of projects) {
          console.log(`${p.id}\t${p.name}\t${p.repository}\t[${p.paths.join(', ')}]`);
        }
      }
      return;
    }
    if (parsed.action === 'remove') {
      runProjectRemove(registry, parsed.id);
      console.log(`[project-rag] Removed project "${parsed.id}" from the registry.`);
      return;
    }
    const project = runProjectRegister(registry, {
      id: parsed.id,
      repository: parsed.repository,
      name: parsed.name,
      paths: parsed.paths,
    });
    console.log(`[project-rag] Registered project "${project.id}" (${project.repository}).`);
    return;
  }
```

**Important — the `'web'` variant of `ParsedArgs` still exists but is unhandled here.** Since every branch before the final search-handling code returns, and `'web'` doesn't match any `if` yet, TypeScript will correctly complain that the final fallthrough code (which assumes `parsed.command === 'search'`) can't prove that when `parsed.command` could still be `'web'`. Fix this narrowing gap by adding a temporary guard immediately before the final `const result = await runSearchCommand(...)` line:

```typescript
  if (parsed.command === 'web') {
    console.error('The "web" command is not available yet in this build.');
    process.exitCode = 1;
    return;
  }
```

This is a real, working behavior (a clear, correct error message for a command that genuinely isn't wired up yet) — not a stub to silently remove later; it will be replaced by the real implementation in the follow-up plan's task that adds `src/server/app.ts`, at which point this whole `if` block is deleted and replaced with the real dispatch (see that plan's own instructions).

- [ ] **Step 2: Build and manually verify the full `project register/list/remove` flow**

```bash
npm run build
SCRATCH=$(mktemp -d)
git init -b main "$SCRATCH/demo-repo" -q
mkdir -p "$SCRATCH/demo-repo/docs"
echo '{"projects":[]}' > "$SCRATCH/projects.json"

QDRANT_URL=http://localhost:6333 EMBEDDING_PROVIDER=ollama EMBEDDING_MODEL=bge-m3 PROJECT_REGISTRY_PATH="$SCRATCH/projects.json" node "$(pwd)/dist/cli/index.js" project register demo "$SCRATCH/demo-repo" --name Demo --paths docs

echo "--- after register ---"
cat "$SCRATCH/projects.json"

QDRANT_URL=http://localhost:6333 EMBEDDING_PROVIDER=ollama EMBEDDING_MODEL=bge-m3 PROJECT_REGISTRY_PATH="$SCRATCH/projects.json" node "$(pwd)/dist/cli/index.js" project list

QDRANT_URL=http://localhost:6333 EMBEDDING_PROVIDER=ollama EMBEDDING_MODEL=bge-m3 PROJECT_REGISTRY_PATH="$SCRATCH/projects.json" node "$(pwd)/dist/cli/index.js" project remove demo

echo "--- after remove ---"
cat "$SCRATCH/projects.json"

rm -rf "$SCRATCH"
```

Expected: after register, `projects.json` contains the `demo` entry with `name: "Demo"`, `paths: ["docs"]`; `project list` prints a line for it; after remove, `projects.json`'s `projects` array is empty again. Also re-run one existing command (e.g. `ingest`/`sync` against a nonexistent project id) to confirm no regression from the `index.ts` edit.

- [ ] **Step 3: Run the full suite and typecheck for real**

Run: `npm run typecheck && npm test`
Expected: all tests passing, clean typecheck. Paste the real output.

- [ ] **Step 4: Commit**

```bash
git add src/cli/index.ts
git commit -m "feat: wire CLI project register/list/remove command"
```

---

### Task 5: SSE Helper

**Files:**
- Create: `src/server/sse.ts`
- Test: `tests/server/sse.test.ts`

**Interfaces:**
- Consumes: `Response` type from `express`
- Produces: `function startSse(res: Response): void` and `function sendSseEvent(res: Response, event: string, data: unknown): void` — consumed by Task 8's `ingest`/`sync` routes.

Note: `express`, `@types/express`, `supertest`, `@types/supertest` are already installed (verified directly against the real Express 5.2.1 API before this plan was written — see the plan's header). This task's commit should include the already-updated `package.json`/`package-lock.json` alongside its own new files.

- [ ] **Step 1: Write the failing test**

`tests/server/sse.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { startSse, sendSseEvent } from '../../src/server/sse';

describe('startSse', () => {
  it('sets SSE headers and flushes them', () => {
    const res = { setHeader: vi.fn(), flushHeaders: vi.fn() } as any;

    startSse(res);

    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/event-stream');
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-cache');
    expect(res.setHeader).toHaveBeenCalledWith('Connection', 'keep-alive');
    expect(res.flushHeaders).toHaveBeenCalled();
  });
});

describe('sendSseEvent', () => {
  it('writes an event/data pair in SSE wire format', () => {
    const res = { write: vi.fn() } as any;

    sendSseEvent(res, 'log', 'hello world');

    expect(res.write).toHaveBeenCalledWith('event: log\n');
    expect(res.write).toHaveBeenCalledWith('data: "hello world"\n\n');
  });

  it('JSON-serializes object payloads', () => {
    const res = { write: vi.fn() } as any;

    sendSseEvent(res, 'done', { added: ['a.md'] });

    expect(res.write).toHaveBeenCalledWith('data: {"added":["a.md"]}\n\n');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/sse.test.ts`
Expected: FAIL with "Cannot find module '../../src/server/sse'".

- [ ] **Step 3: Write minimal implementation**

`src/server/sse.ts`:

```typescript
import type { Response } from 'express';

export function startSse(res: Response): void {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
}

export function sendSseEvent(res: Response, event: string, data: unknown): void {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/server/sse.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Run the full suite and typecheck for real**

Run: `npm run typecheck && npm test`
Expected: clean typecheck, all tests passing. Paste the real output.

- [ ] **Step 6: Commit**

```bash
git add src/server/sse.ts tests/server/sse.test.ts package.json package-lock.json
git commit -m "feat: add SSE helper and Express/supertest dependencies"
```

---

### Task 6: API Routes — Projects & Knowledge

**Files:**
- Create: `src/server/app.ts` (created now with only these two route groups wired; Tasks 7-8 add the rest to the SAME file)
- Create: `src/server/routes/projects.ts`
- Create: `src/server/routes/knowledge.ts`
- Test: `tests/server/routes/projects.test.ts`
- Test: `tests/server/routes/knowledge.test.ts`

**Interfaces:**
- Consumes: `ProjectRegistry`/`ProjectConfig` (Phase 1), `getIndexedFileHashes` (Phase 3 `src/qdrant/qdrant-repository.ts`), `isHookInstalled` (Task 1), `runProjectRegister`/`runProjectList`/`runProjectRemove` (Task 2)
- Produces: `interface AppDeps { registry: ProjectRegistry; qdrantClient: QdrantClient; qdrantUrl: string; qdrantCollection: string; embeddingProvider: EmbeddingProvider; ragTopK: number; staticDir: string }`, `function createApp(deps: AppDeps): express.Express`, `function registerProjectsRoutes(router: express.Router, deps: AppDeps): void`, `function registerKnowledgeRoutes(router: express.Router, deps: AppDeps): void` — `createApp` is extended by Tasks 7-8, and consumed by a later task in the frontend plan (the `web` CLI command).

- [ ] **Step 1: Write the failing tests**

`tests/server/routes/projects.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../../../src/server/app';

function baseDeps(overrides: any = {}) {
  return {
    registry: { list: vi.fn().mockReturnValue([]), find: vi.fn(), register: vi.fn(), remove: vi.fn() },
    qdrantClient: {},
    qdrantUrl: 'http://localhost:6333',
    qdrantCollection: 'project_rag_documents',
    embeddingProvider: { embedQuery: vi.fn(), embedDocuments: vi.fn() },
    ragTopK: 5,
    staticDir: '/tmp/does-not-matter',
    ...overrides,
  };
}

describe('GET /api/projects', () => {
  it('returns each project with indexed file count and hook status', async () => {
    const registry = {
      list: vi.fn().mockReturnValue([{ id: 'sample', name: 'Sample', repository: '/r', paths: ['docs'] }]),
      find: vi.fn(),
    };
    const deps = baseDeps({ registry });
    const app = createApp(deps);

    const res = await request(app).get('/api/projects');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      {
        id: 'sample',
        name: 'Sample',
        repository: '/r',
        paths: ['docs'],
        indexedFileCount: expect.any(Number),
        hookInstalled: false,
      },
    ]);
  });
});

describe('GET /api/projects/:id', () => {
  it('returns 404 for an unregistered project', async () => {
    const app = createApp(baseDeps());

    const res = await request(app).get('/api/projects/missing');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Project "missing" is not registered' });
  });
});

describe('POST /api/projects', () => {
  it('registers a project and returns 201', async () => {
    const registry = {
      list: vi.fn(),
      find: vi.fn(),
      register: vi.fn().mockReturnValue({ id: 'sample', name: 'Sample', repository: '/r', paths: ['docs'] }),
    };
    const app = createApp(baseDeps({ registry }));

    const res = await request(app).post('/api/projects').send({ id: 'sample', repository: '/r', name: 'Sample' });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id: 'sample', name: 'Sample', repository: '/r', paths: ['docs'] });
    expect(registry.register).toHaveBeenCalledWith('sample', '/r', { name: 'Sample', paths: undefined });
  });

  it('returns 400 when id or repository is missing', async () => {
    const app = createApp(baseDeps());

    const res = await request(app).post('/api/projects').send({ id: 'sample' });

    expect(res.status).toBe(400);
  });

  it('returns 400 when the registry rejects the input', async () => {
    const registry = {
      list: vi.fn(),
      find: vi.fn(),
      register: vi.fn().mockImplementation(() => {
        throw new Error('Repository path does not exist: /r');
      }),
    };
    const app = createApp(baseDeps({ registry }));

    const res = await request(app).post('/api/projects').send({ id: 'sample', repository: '/r' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Repository path does not exist: /r' });
  });
});

describe('DELETE /api/projects/:id', () => {
  it('removes a project and returns 204', async () => {
    const registry = { list: vi.fn(), find: vi.fn(), remove: vi.fn() };
    const app = createApp(baseDeps({ registry }));

    const res = await request(app).delete('/api/projects/sample');

    expect(res.status).toBe(204);
    expect(registry.remove).toHaveBeenCalledWith('sample');
  });

  it('returns 404 when the project is not registered', async () => {
    const registry = {
      list: vi.fn(),
      find: vi.fn(),
      remove: vi.fn().mockImplementation(() => {
        throw new Error('Project "sample" is not registered');
      }),
    };
    const app = createApp(baseDeps({ registry }));

    const res = await request(app).delete('/api/projects/sample');

    expect(res.status).toBe(404);
  });
});
```

`tests/server/routes/knowledge.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../../../src/server/app';

function baseDeps(overrides: any = {}) {
  return {
    registry: { list: vi.fn().mockReturnValue([]), find: vi.fn() },
    qdrantClient: {},
    qdrantUrl: 'http://localhost:6333',
    qdrantCollection: 'project_rag_documents',
    embeddingProvider: { embedQuery: vi.fn(), embedDocuments: vi.fn() },
    ragTopK: 5,
    staticDir: '/tmp/does-not-matter',
    ...overrides,
  };
}

describe('GET /api/projects/:id/knowledge', () => {
  it('returns 404 for an unregistered project', async () => {
    const app = createApp(baseDeps());

    const res = await request(app).get('/api/projects/missing/knowledge');

    expect(res.status).toBe(404);
  });

  it('returns the sorted list of indexed files for a registered project', async () => {
    const registry = {
      list: vi.fn(),
      find: vi.fn().mockReturnValue({ id: 'sample', name: 'Sample', repository: '/r', paths: ['docs'] }),
    };
    const qdrantClient = {
      scroll: vi.fn().mockResolvedValue({
        points: [
          { id: '1', payload: { file: 'docs/b.md', content_hash: 'h2' } },
          { id: '2', payload: { file: 'docs/a.md', content_hash: 'h1' } },
        ],
        next_page_offset: null,
      }),
    };
    const app = createApp(baseDeps({ registry, qdrantClient }));

    const res = await request(app).get('/api/projects/sample/knowledge');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ files: ['docs/a.md', 'docs/b.md'] });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/server/routes/projects.test.ts tests/server/routes/knowledge.test.ts`
Expected: FAIL with "Cannot find module '../../../src/server/app'".

- [ ] **Step 3: Write minimal implementation**

`src/server/routes/projects.ts`:

```typescript
import type { Router } from 'express';
import type { AppDeps } from '../app';
import { getIndexedFileHashes } from '../../qdrant/qdrant-repository';
import { isHookInstalled } from '../../git/hook-installer';
import { runProjectRegister, runProjectList, runProjectRemove } from '../../cli/project-command';

export function registerProjectsRoutes(router: Router, deps: AppDeps): void {
  router.get('/', async (_req, res) => {
    const projects = runProjectList(deps.registry);
    const result = await Promise.all(
      projects.map(async (p) => ({
        id: p.id,
        name: p.name,
        repository: p.repository,
        paths: p.paths,
        indexedFileCount: (await getIndexedFileHashes(deps.qdrantClient, deps.qdrantCollection, p.id)).size,
        hookInstalled: isHookInstalled(p.repository),
      })),
    );
    res.json(result);
  });

  router.get('/:id', async (req, res) => {
    const project = deps.registry.find(req.params.id);
    if (!project) {
      res.status(404).json({ error: `Project "${req.params.id}" is not registered` });
      return;
    }
    const hashes = await getIndexedFileHashes(deps.qdrantClient, deps.qdrantCollection, project.id);
    res.json({
      id: project.id,
      name: project.name,
      repository: project.repository,
      paths: project.paths,
      indexedFileCount: hashes.size,
      hookInstalled: isHookInstalled(project.repository),
    });
  });

  router.post('/', (req, res) => {
    const { id, repository, name, paths } = req.body ?? {};
    if (!id || !repository) {
      res.status(400).json({ error: 'id and repository are required' });
      return;
    }
    try {
      const project = runProjectRegister(deps.registry, { id, repository, name, paths });
      res.status(201).json(project);
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  router.delete('/:id', (req, res) => {
    try {
      runProjectRemove(deps.registry, req.params.id);
      res.status(204).end();
    } catch (error) {
      res.status(404).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });
}
```

`src/server/routes/knowledge.ts`:

```typescript
import type { Router } from 'express';
import type { AppDeps } from '../app';
import { getIndexedFileHashes } from '../../qdrant/qdrant-repository';

export function registerKnowledgeRoutes(router: Router, deps: AppDeps): void {
  router.get('/:id/knowledge', async (req, res) => {
    const project = deps.registry.find(req.params.id);
    if (!project) {
      res.status(404).json({ error: `Project "${req.params.id}" is not registered` });
      return;
    }
    const hashes = await getIndexedFileHashes(deps.qdrantClient, deps.qdrantCollection, project.id);
    res.json({ files: [...hashes.keys()].sort() });
  });
}
```

`src/server/app.ts`:

```typescript
import express, { type Express } from 'express';
import path from 'node:path';
import type { QdrantClient } from '@qdrant/js-client-rest';
import type { ProjectRegistry } from '../projects/project-registry';
import type { EmbeddingProvider } from '../embedding/embedding-provider';
import { registerProjectsRoutes } from './routes/projects';
import { registerKnowledgeRoutes } from './routes/knowledge';

export interface AppDeps {
  registry: ProjectRegistry;
  qdrantClient: QdrantClient;
  qdrantUrl: string;
  qdrantCollection: string;
  embeddingProvider: EmbeddingProvider;
  ragTopK: number;
  staticDir: string;
}

export function createApp(deps: AppDeps): Express {
  const app = express();
  app.use(express.json());

  const apiRouter = express.Router();
  registerProjectsRoutes(apiRouter, deps);
  registerKnowledgeRoutes(apiRouter, deps);
  app.use('/api/projects', apiRouter);

  app.use(express.static(deps.staticDir));
  // Express 5 no longer accepts a bare '*' route pattern for a catch-all —
  // a path-less middleware matches everything and sidesteps that entirely.
  app.use((_req, res) => {
    res.sendFile(path.join(deps.staticDir, 'index.html'));
  });

  return app;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/server/routes/projects.test.ts tests/server/routes/knowledge.test.ts`
Expected: PASS (8 tests: 6 in projects.test.ts + 2 in knowledge.test.ts).

- [ ] **Step 5: Run the full suite and typecheck for real**

Run: `npm run typecheck && npm test`
Expected: clean typecheck, all tests passing. Paste the real output.

- [ ] **Step 6: Commit**

```bash
git add src/server/app.ts src/server/routes/projects.ts src/server/routes/knowledge.ts tests/server/routes/projects.test.ts tests/server/routes/knowledge.test.ts
git commit -m "feat: add projects and knowledge API routes"
```

---

### Task 7: API Routes — Search & Hook

**Files:**
- Create: `src/server/routes/search.ts`
- Create: `src/server/routes/hook.ts`
- Modify: `src/server/app.ts` (register the two new route groups)
- Test: `tests/server/routes/search.test.ts`
- Test: `tests/server/routes/hook.test.ts`

**Interfaces:**
- Consumes: `searchProject` (Phase 4 `src/retrieval/search.ts`), `installHook`/`uninstallHook` (Phase 6 `src/git/hook-installer.ts`)
- Produces: `function registerSearchRoutes(router: Router, deps: AppDeps): void`, `function registerHookRoutes(router: Router, deps: AppDeps): void`.

- [ ] **Step 1: Write the failing tests**

`tests/server/routes/search.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../../../src/server/app';

function baseDeps(overrides: any = {}) {
  return {
    registry: { list: vi.fn(), find: vi.fn() },
    qdrantClient: {},
    qdrantUrl: 'http://localhost:6333',
    qdrantCollection: 'project_rag_documents',
    embeddingProvider: { embedQuery: vi.fn().mockResolvedValue([0.1]), embedDocuments: vi.fn() },
    ragTopK: 5,
    staticDir: '/tmp/does-not-matter',
    ...overrides,
  };
}

describe('POST /api/projects/:id/search', () => {
  it('returns 404 for an unregistered project', async () => {
    const app = createApp(baseDeps());

    const res = await request(app).post('/api/projects/missing/search').send({ query: 'hello' });

    expect(res.status).toBe(404);
  });

  it('returns 400 when query is missing', async () => {
    const registry = { list: vi.fn(), find: vi.fn().mockReturnValue({ id: 'sample', name: 'Sample', repository: '/r', paths: ['docs'] }) };
    const app = createApp(baseDeps({ registry }));

    const res = await request(app).post('/api/projects/sample/search').send({});

    expect(res.status).toBe(400);
  });

  it('returns search results for a registered project', async () => {
    const registry = { list: vi.fn(), find: vi.fn().mockReturnValue({ id: 'sample', name: 'Sample', repository: '/r', paths: ['docs'] }) };
    const qdrantClient = {
      query: vi.fn().mockResolvedValue({
        points: [{ id: '1', score: 0.9, payload: { file: 'docs/a.md', section: 'Intro', content: 'hi' } }],
      }),
    };
    const app = createApp(baseDeps({ registry, qdrantClient }));

    const res = await request(app).post('/api/projects/sample/search').send({ query: 'hello' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ results: [{ file: 'docs/a.md', section: 'Intro', score: 0.9, content: 'hi' }] });
  });
});
```

`tests/server/routes/hook.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { createApp } from '../../../src/server/app';

function baseDeps(overrides: any = {}) {
  return {
    registry: { list: vi.fn(), find: vi.fn() },
    qdrantClient: {},
    qdrantUrl: 'http://localhost:6333',
    qdrantCollection: 'project_rag_documents',
    embeddingProvider: { embedQuery: vi.fn(), embedDocuments: vi.fn() },
    ragTopK: 5,
    staticDir: '/tmp/does-not-matter',
    ...overrides,
  };
}

describe('hook routes', () => {
  let dir: string;
  let repo: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'project-rag-hook-route-'));
    repo = path.join(dir, 'repo');
    mkdirSync(path.join(repo, '.git', 'hooks'), { recursive: true });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('POST installs the hook for a registered project', async () => {
    const registry = { list: vi.fn(), find: vi.fn().mockReturnValue({ id: 'sample', name: 'Sample', repository: repo, paths: ['docs'] }) };
    const app = createApp(baseDeps({ registry }));

    const res = await request(app).post('/api/projects/sample/hook');

    expect(res.status).toBe(204);
  });

  it('DELETE uninstalls the hook for a registered project', async () => {
    const registry = { list: vi.fn(), find: vi.fn().mockReturnValue({ id: 'sample', name: 'Sample', repository: repo, paths: ['docs'] }) };
    const app = createApp(baseDeps({ registry }));
    await request(app).post('/api/projects/sample/hook');

    const res = await request(app).delete('/api/projects/sample/hook');

    expect(res.status).toBe(204);
  });

  it('returns 404 for an unregistered project on install', async () => {
    const app = createApp(baseDeps());

    const res = await request(app).post('/api/projects/missing/hook');

    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/server/routes/search.test.ts tests/server/routes/hook.test.ts`
Expected: FAIL — `registerSearchRoutes`/`registerHookRoutes` don't exist yet and aren't wired into `createApp`.

- [ ] **Step 3: Write minimal implementation**

`src/server/routes/search.ts`:

```typescript
import type { Router } from 'express';
import type { AppDeps } from '../app';
import { searchProject } from '../../retrieval/search';

export function registerSearchRoutes(router: Router, deps: AppDeps): void {
  router.post('/:id/search', async (req, res) => {
    const project = deps.registry.find(req.params.id);
    if (!project) {
      res.status(404).json({ error: `Project "${req.params.id}" is not registered` });
      return;
    }
    const query = req.body?.query;
    if (!query) {
      res.status(400).json({ error: 'query is required' });
      return;
    }
    try {
      const results = await searchProject(project.id, query, {
        qdrantClient: deps.qdrantClient,
        qdrantCollection: deps.qdrantCollection,
        embeddingProvider: deps.embeddingProvider,
        topK: deps.ragTopK,
      });
      res.json({ results });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });
}
```

`src/server/routes/hook.ts`:

```typescript
import type { Router } from 'express';
import type { AppDeps } from '../app';
import { installHook, uninstallHook } from '../../git/hook-installer';

export function registerHookRoutes(router: Router, deps: AppDeps): void {
  router.post('/:id/hook', (req, res) => {
    const project = deps.registry.find(req.params.id);
    if (!project) {
      res.status(404).json({ error: `Project "${req.params.id}" is not registered` });
      return;
    }
    try {
      installHook(project.repository, project.id);
      res.status(204).end();
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  router.delete('/:id/hook', (req, res) => {
    const project = deps.registry.find(req.params.id);
    if (!project) {
      res.status(404).json({ error: `Project "${req.params.id}" is not registered` });
      return;
    }
    uninstallHook(project.repository);
    res.status(204).end();
  });
}
```

Update `src/server/app.ts`: add two import lines and two registration calls. Read the current file first, then apply:

```typescript
import { registerSearchRoutes } from './routes/search';
import { registerHookRoutes } from './routes/hook';
```

and inside `createApp`, right after `registerKnowledgeRoutes(apiRouter, deps);`:

```typescript
  registerSearchRoutes(apiRouter, deps);
  registerHookRoutes(apiRouter, deps);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/server/routes/search.test.ts tests/server/routes/hook.test.ts`
Expected: PASS (6 tests: 3 search + 3 hook).

- [ ] **Step 5: Run the full suite and typecheck for real**

Run: `npm run typecheck && npm test`
Expected: clean typecheck, all tests passing (including Task 6's route tests, unaffected). Paste the real output.

- [ ] **Step 6: Commit**

```bash
git add src/server/routes/search.ts src/server/routes/hook.ts src/server/app.ts tests/server/routes/search.test.ts tests/server/routes/hook.test.ts
git commit -m "feat: add search and hook API routes"
```

---

### Task 8: API Routes — Ingest & Sync (SSE)

**Files:**
- Create: `src/server/routes/ingest.ts`
- Create: `src/server/routes/sync.ts`
- Modify: `src/server/app.ts` (register the two new route groups)
- Test: `tests/server/routes/ingest.test.ts`
- Test: `tests/server/routes/sync.test.ts`

**Interfaces:**
- Consumes: `indexProject` (Phase 2 `src/ingestion/indexer.ts`), `syncProject` (Phase 3 `src/ingestion/sync.ts`), `startSse`/`sendSseEvent` (Task 5)
- Produces: `function registerIngestRoutes(router: Router, deps: AppDeps): void`, `function registerSyncRoutes(router: Router, deps: AppDeps): void`.

- [ ] **Step 1: Write the failing tests**

`tests/server/routes/ingest.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../../../src/server/app';

function baseDeps(overrides: any = {}) {
  return {
    registry: { list: vi.fn(), find: vi.fn() },
    qdrantClient: {},
    qdrantUrl: 'http://localhost:6333',
    qdrantCollection: 'project_rag_documents',
    embeddingProvider: { embedQuery: vi.fn(), embedDocuments: vi.fn() },
    ragTopK: 5,
    staticDir: '/tmp/does-not-matter',
    ...overrides,
  };
}

describe('POST /api/projects/:id/ingest', () => {
  it('returns 404 for an unregistered project', async () => {
    const app = createApp(baseDeps());

    const res = await request(app).post('/api/projects/missing/ingest');

    expect(res.status).toBe(404);
  });
});
```

`tests/server/routes/sync.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../../../src/server/app';

function baseDeps(overrides: any = {}) {
  return {
    registry: { list: vi.fn(), find: vi.fn() },
    qdrantClient: {},
    qdrantUrl: 'http://localhost:6333',
    qdrantCollection: 'project_rag_documents',
    embeddingProvider: { embedQuery: vi.fn(), embedDocuments: vi.fn() },
    ragTopK: 5,
    staticDir: '/tmp/does-not-matter',
    ...overrides,
  };
}

describe('POST /api/projects/:id/sync', () => {
  it('returns 404 for an unregistered project', async () => {
    const app = createApp(baseDeps());

    const res = await request(app).post('/api/projects/missing/sync');

    expect(res.status).toBe(404);
  });
});
```

Note: these two tests only cover the pre-flight 404 case, which is a plain HTTP response before any SSE headers are sent — the simplest, most reliable thing to assert with `supertest` against a streaming endpoint. The full SSE event sequence (`log*` → `done`/`error`) for a REGISTERED project is intentionally not unit-tested here (both `indexProject`/`syncProject` are already fully tested in Phase 2/3, and a real end-to-end SSE check happens in Task 9's manual `curl` verification against a real project) — do not attempt to add a mid-stream-events test in this task, it adds real complexity for a case the manual verification already covers.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/server/routes/ingest.test.ts tests/server/routes/sync.test.ts`
Expected: FAIL — the routes don't exist yet.

- [ ] **Step 3: Write minimal implementation**

`src/server/routes/ingest.ts`:

```typescript
import type { Router } from 'express';
import type { AppDeps } from '../app';
import { indexProject } from '../../ingestion/indexer';
import { startSse, sendSseEvent } from '../sse';

export function registerIngestRoutes(router: Router, deps: AppDeps): void {
  router.post('/:id/ingest', async (req, res) => {
    const project = deps.registry.find(req.params.id);
    if (!project) {
      res.status(404).json({ error: `Project "${req.params.id}" is not registered` });
      return;
    }
    startSse(res);
    try {
      const result = await indexProject(project, {
        qdrantClient: deps.qdrantClient,
        qdrantUrl: deps.qdrantUrl,
        qdrantCollection: deps.qdrantCollection,
        embeddingProvider: deps.embeddingProvider,
        onLog: (message) => sendSseEvent(res, 'log', message),
      });
      sendSseEvent(res, 'done', result);
    } catch (error) {
      sendSseEvent(res, 'error', { message: error instanceof Error ? error.message : String(error) });
    }
    res.end();
  });
}
```

`src/server/routes/sync.ts`:

```typescript
import type { Router } from 'express';
import type { AppDeps } from '../app';
import { syncProject } from '../../ingestion/sync';
import { startSse, sendSseEvent } from '../sse';

export function registerSyncRoutes(router: Router, deps: AppDeps): void {
  router.post('/:id/sync', async (req, res) => {
    const project = deps.registry.find(req.params.id);
    if (!project) {
      res.status(404).json({ error: `Project "${req.params.id}" is not registered` });
      return;
    }
    startSse(res);
    try {
      const result = await syncProject(project, {
        qdrantClient: deps.qdrantClient,
        qdrantUrl: deps.qdrantUrl,
        qdrantCollection: deps.qdrantCollection,
        embeddingProvider: deps.embeddingProvider,
        onLog: (message) => sendSseEvent(res, 'log', message),
      });
      sendSseEvent(res, 'done', result);
    } catch (error) {
      sendSseEvent(res, 'error', { message: error instanceof Error ? error.message : String(error) });
    }
    res.end();
  });
}
```

Update `src/server/app.ts`: read the current file first, add two import lines and two registration calls, same pattern as Task 7:

```typescript
import { registerIngestRoutes } from './routes/ingest';
import { registerSyncRoutes } from './routes/sync';
```

and inside `createApp`, after `registerHookRoutes(apiRouter, deps);`:

```typescript
  registerIngestRoutes(apiRouter, deps);
  registerSyncRoutes(apiRouter, deps);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/server/routes/ingest.test.ts tests/server/routes/sync.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Run the full suite and typecheck for real**

Run: `npm run typecheck && npm test`
Expected: clean typecheck, all tests passing. Paste the real output.

- [ ] **Step 6: Commit**

```bash
git add src/server/routes/ingest.ts src/server/routes/sync.ts src/server/app.ts tests/server/routes/ingest.test.ts tests/server/routes/sync.test.ts
git commit -m "feat: add ingest and sync SSE API routes"
```

---

### Task 9: CLI `web` Command — Serve the API (Frontend Static Files Come From the Next Plan)

**Files:**
- Modify: `src/cli/index.ts` (replace Task 4's temporary `'web'` error stub with the real dispatch)

**Interfaces:**
- Consumes: `createApp` (Task 6)
- Produces: nothing new — wires `createApp` into the CLI's `web` command.

- [ ] **Step 1: Read the current `src/cli/index.ts` and replace the temporary `web` stub**

Add a new import line after the existing `import { runProjectRegister, runProjectList, runProjectRemove } from './project-command';` line:

```typescript
import path from 'node:path';
import { createApp } from '../server/app';
```

Replace the temporary block added in Task 4:

```typescript
  if (parsed.command === 'web') {
    console.error('The "web" command is not available yet in this build.');
    process.exitCode = 1;
    return;
  }
```

with the real implementation:

```typescript
  if (parsed.command === 'web') {
    const app = createApp({
      registry,
      qdrantClient,
      qdrantUrl: config.qdrantUrl,
      qdrantCollection: config.qdrantCollection,
      embeddingProvider,
      ragTopK: config.ragTopK,
      staticDir: path.resolve(__dirname, '../../web/dist'),
    });
    const port = parsed.port ?? 4300;
    app.listen(port, () => {
      console.log(`[project-rag] Web UI running at http://localhost:${port}`);
    });
    return;
  }
```

Note: `web/dist` (the built frontend) does not exist yet — that's the follow-up plan. Requests to `/` will 404 from `express.static`/`sendFile` until that plan lands, but every `/api/*` route already works. This is expected and correct for this task's scope; do not create a placeholder `web/dist/index.html` here.

- [ ] **Step 2: Build and manually verify the API end-to-end (including a live SSE stream) against a real scratch project**

This requires Qdrant and an embedding provider actually running (unlike every prior manual check in this project, which only exercised the pre-flight "project not registered" error path). If you don't have Qdrant/Ollama running locally, skip the ingest/sync portions of this check and only verify the steps up through `curl -N .../sync` printing a **connection refused / fetch failed** error event over SSE (still proves the route, streaming, and error path all work end-to-end) — note in your report which parts you were able to run live.

```bash
npm run build
SCRATCH=$(mktemp -d)
git init -b main "$SCRATCH/demo-repo" -q
git -C "$SCRATCH/demo-repo" config user.email test@test.com
git -C "$SCRATCH/demo-repo" config user.name Test
mkdir -p "$SCRATCH/demo-repo/docs"
echo "# Demo" > "$SCRATCH/demo-repo/docs/readme.md"
git -C "$SCRATCH/demo-repo" add . && git -C "$SCRATCH/demo-repo" commit -q -m init
echo '{"projects":[]}' > "$SCRATCH/projects.json"

QDRANT_URL=http://localhost:6333 EMBEDDING_PROVIDER=ollama EMBEDDING_MODEL=bge-m3 PROJECT_REGISTRY_PATH="$SCRATCH/projects.json" node "$(pwd)/dist/cli/index.js" web --port 4300 &
WEB_PID=$!
sleep 1

curl -s -X POST http://localhost:4300/api/projects -H "Content-Type: application/json" -d "{\"id\":\"demo\",\"repository\":\"$SCRATCH/demo-repo\"}"
echo ""
curl -s http://localhost:4300/api/projects
echo ""
curl -s http://localhost:4300/api/projects/demo/knowledge
echo ""
curl -N -s -X POST http://localhost:4300/api/projects/demo/sync &
CURL_PID=$!
sleep 3
kill $CURL_PID 2>/dev/null

kill $WEB_PID
rm -rf "$SCRATCH"
```

Expected: `POST /api/projects` returns the created project JSON with status 201 (verify the printed body); `GET /api/projects` lists it with `indexedFileCount: 0`, `hookInstalled: false`; `GET /api/projects/demo/knowledge` returns `{"files":[]}`; the `curl -N` sync call prints raw SSE lines (`event: log` / `data: ...`) as they arrive, ending in either a `done` or `error` event depending on whether Qdrant/Ollama are actually reachable in your environment.

- [ ] **Step 3: Run the full suite and typecheck for real**

Run: `npm run typecheck && npm test`
Expected: all tests passing, clean typecheck. Paste the real output.

- [ ] **Step 4: Commit**

```bash
git add src/cli/index.ts
git commit -m "feat: wire CLI web command to serve the REST API"
```
