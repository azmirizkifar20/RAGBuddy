# Phase 6 — Git Hook Auto Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement `project-rag hook install <project>` / `hook uninstall <project>` per `init.md` §12–§13 and §26 Phase 6 — the final phase. A `post-commit` Git hook that calls `project-rag sync <project>` after every commit, chains safely with any pre-existing hook, and must NEVER block the commit even if Qdrant/the embedding provider/project-rag itself is unavailable.

**Architecture:** A pure-file-I/O hook installer (`src/git/hook-installer.ts`) that generates a marker-delimited shell block, appends it to (or creates) `.git/hooks/post-commit`, and can cleanly remove just that block on uninstall without touching anything else in the file. The generated hook bakes in an absolute path to the CURRENT `project-rag` installation's `dist/cli/index.js` (via `process.execPath` + a path resolved relative to the installer module) rather than assuming `project-rag` is on `PATH` — this is a local dev tool, not a globally published package, so PATH cannot be assumed. A CLI `hook` command (with an `install`/`uninstall` sub-action) wires it into the registry, mirroring `ingest`/`sync`/`search`'s command-file pattern.

**Tech Stack:** Node.js 24, TypeScript, Vitest — no new dependencies (this phase is pure `node:fs`/`node:child_process` plumbing plus reuse of Phase 1's `ProjectRegistry`).

## Global Constraints

- **The commit must never be blocked by a sync failure** — the generated hook script always exits 0 regardless of whether `project-rag sync` succeeds; a failure prints `[project-rag] Warning: RAG sync failed. Git commit remains successful.` rather than propagating a non-zero exit code (`init.md` §12).
- **No recursive Git operations** — the sync command itself never creates a commit (already true across every phase built so far; this phase doesn't change that, just triggers the existing `sync` command from a hook) (`init.md` §12).
- **Preserve, never destroy, an existing user `post-commit` hook** — if one exists, chain by appending a clearly marked block; `hook uninstall` must remove ONLY that marked block, leaving the rest of the file (and its exit-blocking behavior, if any) intact (`init.md` §13).
- **Validate the Git repository before installing** (`init.md` §13 step 1) — reuse the same "is this actually a Git repo" check pattern already established in `ProjectRegistry.register()` and `indexProject`/`syncProject`'s liveness guards.
- **Clearly document how the hook works** (`init.md` §13 step 4) — the generated hook script itself carries an explanatory comment, and `docs/features/06-git-hook-auto-sync.md` fully describes the mechanism (no more "Planned"/Phase 6 hedging once this lands).
- **No new runtime dependencies** (`init.md` §3, §27) — pure `node:fs`/`node:child_process`/`node:path`.

---

### Task 1: Hook Installer

**Files:**
- Create: `src/git/hook-installer.ts`
- Test: `tests/git/hook-installer.test.ts`

**Interfaces:**
- Consumes: nothing new (pure `node:fs`/`node:path`)
- Produces: `interface InstallHookOptions { nodePath?: string; cliEntrypoint?: string }`, `function installHook(repositoryPath: string, projectId: string, options?: InstallHookOptions): void`, and `function uninstallHook(repositoryPath: string): void` — consumed by Task 2's CLI `hook` command.

- [ ] **Step 1: Write the failing test**

`tests/git/hook-installer.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { installHook, uninstallHook } from '../../src/git/hook-installer';

describe('installHook', () => {
  let dir: string;
  let repo: string;
  let hookPath: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'project-rag-hook-'));
    repo = path.join(dir, 'repo');
    mkdirSync(path.join(repo, '.git', 'hooks'), { recursive: true });
    hookPath = path.join(repo, '.git', 'hooks', 'post-commit');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('creates a fresh post-commit hook when none exists', () => {
    installHook(repo, 'bidubadu', { nodePath: '/usr/bin/node', cliEntrypoint: '/opt/project-rag/dist/cli/index.js' });

    expect(existsSync(hookPath)).toBe(true);
    const content = readFileSync(hookPath, 'utf8');
    expect(content).toContain('project-rag hook start');
    expect(content).toContain('sync bidubadu');
    expect(content).toContain('/usr/bin/node');
    expect(content).toContain('/opt/project-rag/dist/cli/index.js');
    expect(content).toContain('Git commit remains successful');
  });

  it('rejects a repository that is not a git repo', () => {
    const notGit = path.join(dir, 'not-git');
    mkdirSync(notGit, { recursive: true });
    expect(() => installHook(notGit, 'bidubadu')).toThrow('Not a Git repository');
  });

  it('preserves an existing user hook by appending the project-rag block after it', () => {
    writeFileSync(hookPath, '#!/bin/sh\necho "custom user hook"\n');

    installHook(repo, 'bidubadu', { nodePath: 'node', cliEntrypoint: '/x/index.js' });

    const content = readFileSync(hookPath, 'utf8');
    expect(content).toContain('custom user hook');
    expect(content).toContain('project-rag hook start');
    expect(content.indexOf('custom user hook')).toBeLessThan(content.indexOf('project-rag hook start'));
  });

  it('is idempotent — reinstalling replaces only the project-rag block, not the user content', () => {
    writeFileSync(hookPath, '#!/bin/sh\necho "custom user hook"\n');
    installHook(repo, 'old-project', { nodePath: 'node', cliEntrypoint: '/x/index.js' });
    installHook(repo, 'new-project', { nodePath: 'node', cliEntrypoint: '/x/index.js' });

    const content = readFileSync(hookPath, 'utf8');
    expect(content).toContain('custom user hook');
    expect(content).toContain('sync new-project');
    expect(content).not.toContain('sync old-project');
    expect(content.split('project-rag hook start').length - 1).toBe(1);
  });
});

describe('uninstallHook', () => {
  let dir: string;
  let repo: string;
  let hookPath: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'project-rag-hook-uninstall-'));
    repo = path.join(dir, 'repo');
    mkdirSync(path.join(repo, '.git', 'hooks'), { recursive: true });
    hookPath = path.join(repo, '.git', 'hooks', 'post-commit');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('removes the hook file entirely when it only contained the project-rag block', () => {
    installHook(repo, 'bidubadu', { nodePath: 'node', cliEntrypoint: '/x/index.js' });
    uninstallHook(repo);
    expect(existsSync(hookPath)).toBe(false);
  });

  it('preserves a pre-existing user hook and removes only the project-rag block', () => {
    writeFileSync(hookPath, '#!/bin/sh\necho "custom user hook"\n');
    installHook(repo, 'bidubadu', { nodePath: 'node', cliEntrypoint: '/x/index.js' });

    uninstallHook(repo);

    const content = readFileSync(hookPath, 'utf8');
    expect(content).toContain('custom user hook');
    expect(content).not.toContain('project-rag hook start');
  });

  it('does nothing when no hook is installed', () => {
    expect(() => uninstallHook(repo)).not.toThrow();
    expect(existsSync(hookPath)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/git/hook-installer.test.ts`
Expected: FAIL with "Cannot find module '../../src/git/hook-installer'".

- [ ] **Step 3: Write minimal implementation**

`src/git/hook-installer.ts`:

```typescript
import { existsSync, readFileSync, writeFileSync, unlinkSync, chmodSync } from 'node:fs';
import path from 'node:path';

const MARKER_START = '# >>> project-rag hook start (do not edit this block manually) >>>';
const MARKER_END = '# <<< project-rag hook end <<<';

export interface InstallHookOptions {
  nodePath?: string;
  cliEntrypoint?: string;
}

export function installHook(
  repositoryPath: string,
  projectId: string,
  options: InstallHookOptions = {},
): void {
  const gitDir = path.join(repositoryPath, '.git');
  if (!existsSync(gitDir)) {
    throw new Error(`Not a Git repository: ${repositoryPath}`);
  }

  const nodePath = options.nodePath ?? process.execPath;
  const cliEntrypoint = options.cliEntrypoint ?? path.resolve(__dirname, '../cli/index.js');
  const block = buildHookBlock(projectId, nodePath, cliEntrypoint);

  const hookPath = path.join(gitDir, 'hooks', 'post-commit');
  if (existsSync(hookPath)) {
    const existing = readFileSync(hookPath, 'utf8');
    const updated = existing.includes(MARKER_START)
      ? replaceBlock(existing, block)
      : `${existing.trimEnd()}\n\n${block}\n`;
    writeFileSync(hookPath, updated, 'utf8');
  } else {
    writeFileSync(hookPath, `#!/bin/sh\n\n${block}\n`, 'utf8');
  }
  chmodSync(hookPath, 0o755);
}

export function uninstallHook(repositoryPath: string): void {
  const hookPath = path.join(repositoryPath, '.git', 'hooks', 'post-commit');
  if (!existsSync(hookPath)) return;

  const existing = readFileSync(hookPath, 'utf8');
  if (!existing.includes(MARKER_START)) return;

  const startIdx = existing.indexOf(MARKER_START);
  const endIdx = existing.indexOf(MARKER_END);
  const before = existing.slice(0, startIdx).trimEnd();
  const after = existing.slice(endIdx + MARKER_END.length).trimStart();
  const remaining = [before, after].filter(Boolean).join('\n\n').trim();

  if (!remaining || remaining === '#!/bin/sh') {
    unlinkSync(hookPath);
  } else {
    writeFileSync(hookPath, remaining + '\n', 'utf8');
  }
}

function buildHookBlock(projectId: string, nodePath: string, cliEntrypoint: string): string {
  return [
    MARKER_START,
    '# Auto-sync installed by `project-rag hook install` — safe to remove via `project-rag hook uninstall`.',
    '# This never blocks the commit: any sync failure only prints a warning below.',
    'echo "[project-rag] Sync started..."',
    `"${nodePath}" "${cliEntrypoint}" sync ${projectId} || echo "[project-rag] Warning: RAG sync failed. Git commit remains successful."`,
    MARKER_END,
  ].join('\n');
}

function replaceBlock(existing: string, newBlock: string): string {
  const startIdx = existing.indexOf(MARKER_START);
  const endIdx = existing.indexOf(MARKER_END);
  const before = existing.slice(0, startIdx).trimEnd();
  const after = existing.slice(endIdx + MARKER_END.length).trimStart();
  const parts = [before, newBlock].filter(Boolean);
  if (after) parts.push(after);
  return parts.join('\n\n') + '\n';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/git/hook-installer.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Run the full suite and typecheck for real**

Run: `npm run typecheck && npm test`
Expected: clean typecheck, all tests passing. Actually run these and paste the real output.

- [ ] **Step 6: Commit**

```bash
git add src/git/hook-installer.ts tests/git/hook-installer.test.ts
git commit -m "feat: add git post-commit hook installer with safe chaining"
```

---

### Task 2: CLI `hook install`/`hook uninstall` Command

**Files:**
- Modify: `src/cli/args.ts` (add `hook install|uninstall <project>`; refactors the internal destructuring slightly — re-verify every existing case still passes)
- Modify: `tests/cli/args.test.ts` (add hook cases)
- Create: `src/cli/hook-command.ts`
- Test: `tests/cli/hook-command.test.ts`
- Modify: `src/cli/index.ts` (dispatch to `hook`)

**Interfaces:**
- Consumes: `installHook`/`uninstallHook` (Task 1), `ProjectRegistry`/`ProjectConfig` (Phase 1)
- Produces: updated `ParsedArgs` union including `{ command: 'hook'; action: 'install' | 'uninstall'; projectId: string }`, `interface RunHookDeps { registry: ProjectRegistry; install: (repositoryPath: string, projectId: string) => void; uninstall: (repositoryPath: string) => void }`, `interface RunHookResult { action: 'install' | 'uninstall'; projectName: string }`, and `function runHookCommand(action: 'install' | 'uninstall', projectId: string, deps: RunHookDeps): RunHookResult`.

- [ ] **Step 1: Write the failing tests for `args.ts`**

Read the current `tests/cli/args.test.ts` first, then add these four cases inside the existing `describe('parseArgs', ...)` block (do not remove the existing 11 cases):

```typescript
  it('parses a hook install command with a project id', () => {
    expect(parseArgs(['hook', 'install', 'bidubadu'])).toEqual({
      command: 'hook',
      action: 'install',
      projectId: 'bidubadu',
    });
  });

  it('parses a hook uninstall command with a project id', () => {
    expect(parseArgs(['hook', 'uninstall', 'bidubadu'])).toEqual({
      command: 'hook',
      action: 'uninstall',
      projectId: 'bidubadu',
    });
  });

  it('returns unknown for an unrecognized hook action', () => {
    expect(parseArgs(['hook', 'bogus', 'bidubadu'])).toEqual({ command: 'unknown' });
  });

  it('returns unknown when hook install is missing a project id', () => {
    expect(parseArgs(['hook', 'install'])).toEqual({ command: 'unknown' });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/cli/args.test.ts`
Expected: FAIL — `parseArgs` doesn't recognize `'hook'` yet.

- [ ] **Step 3: Update `src/cli/args.ts`**

Read the current file first, then replace its entire contents with:

```typescript
export type ParsedArgs =
  | { command: 'ingest'; projectId: string }
  | { command: 'sync'; projectId: string }
  | { command: 'search'; projectId: string; query: string }
  | { command: 'mcp' }
  | { command: 'hook'; action: 'install' | 'uninstall'; projectId: string }
  | { command: 'unknown' };

export function parseArgs(argv: string[]): ParsedArgs {
  const [command, ...restArgs] = argv;

  if (command === 'mcp') {
    return { command: 'mcp' };
  }

  if (command === 'hook') {
    const [action, projectId] = restArgs;
    if ((action === 'install' || action === 'uninstall') && projectId) {
      return { command: 'hook', action, projectId };
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
```

This is a refactor of the internal destructuring (`[command, ...restArgs]` instead of `[command, projectId, ...rest]`) to accommodate `hook`'s two-level sub-action — the observable behavior for every existing `ingest`/`sync`/`search`/`mcp` case is unchanged; re-verify this by running the full existing test suite in the next step, not just the new cases.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/cli/args.test.ts`
Expected: PASS (15 tests: 11 existing + 4 new). All 11 pre-existing cases must still pass unchanged — this proves the destructuring refactor didn't change `ingest`/`sync`/`search`/`mcp` behavior.

- [ ] **Step 5: Write the failing test for `hook-command.ts`**

`tests/cli/hook-command.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { runHookCommand } from '../../src/cli/hook-command';

describe('runHookCommand', () => {
  it('installs the hook for a registered project', () => {
    const registry = {
      find: vi.fn().mockReturnValue({ id: 'sample', name: 'Sample', repository: '/r', paths: ['docs'] }),
    } as any;
    const install = vi.fn();
    const uninstall = vi.fn();

    const result = runHookCommand('install', 'sample', { registry, install, uninstall });

    expect(result).toEqual({ action: 'install', projectName: 'Sample' });
    expect(install).toHaveBeenCalledWith('/r', 'sample');
    expect(uninstall).not.toHaveBeenCalled();
  });

  it('uninstalls the hook for a registered project', () => {
    const registry = {
      find: vi.fn().mockReturnValue({ id: 'sample', name: 'Sample', repository: '/r', paths: ['docs'] }),
    } as any;
    const install = vi.fn();
    const uninstall = vi.fn();

    const result = runHookCommand('uninstall', 'sample', { registry, install, uninstall });

    expect(result).toEqual({ action: 'uninstall', projectName: 'Sample' });
    expect(uninstall).toHaveBeenCalledWith('/r');
    expect(install).not.toHaveBeenCalled();
  });

  it('throws a clear error for an unregistered project', () => {
    const registry = { find: vi.fn().mockReturnValue(undefined) } as any;
    const install = vi.fn();
    const uninstall = vi.fn();

    expect(() => runHookCommand('install', 'missing', { registry, install, uninstall })).toThrow(
      'is not registered',
    );
    expect(install).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx vitest run tests/cli/hook-command.test.ts`
Expected: FAIL with "Cannot find module '../../src/cli/hook-command'".

- [ ] **Step 7: Write minimal implementation**

`src/cli/hook-command.ts`:

```typescript
import type { ProjectRegistry } from '../projects/project-registry';

export interface RunHookDeps {
  registry: ProjectRegistry;
  install: (repositoryPath: string, projectId: string) => void;
  uninstall: (repositoryPath: string) => void;
}

export interface RunHookResult {
  action: 'install' | 'uninstall';
  projectName: string;
}

export function runHookCommand(
  action: 'install' | 'uninstall',
  projectId: string,
  deps: RunHookDeps,
): RunHookResult {
  const project = deps.registry.find(projectId);
  if (!project) {
    throw new Error(`Project "${projectId}" is not registered`);
  }
  if (action === 'install') {
    deps.install(project.repository, project.id);
  } else {
    deps.uninstall(project.repository);
  }
  return { action, projectName: project.name };
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npx vitest run tests/cli/hook-command.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 9: Update `src/cli/index.ts` to dispatch the `hook` command (no TDD — thin process wiring, verified manually in Step 10)**

Read the current file first, then apply these edits:

1. Add two new import lines after the existing `import { createMcpServer } from '../mcp/server';` line:

```typescript
import { installHook, uninstallHook } from '../git/hook-installer';
import { runHookCommand } from './hook-command';
```

2. Change the usage-error message from:

```typescript
    console.error(
      'Usage: project-rag <ingest|sync> <project>  |  project-rag search <project> "<query>"  |  project-rag mcp',
    );
```

to:

```typescript
    console.error(
      'Usage: project-rag <ingest|sync> <project>  |  project-rag search <project> "<query>"  |  project-rag mcp  |  project-rag hook <install|uninstall> <project>',
    );
```

3. Add a new branch immediately after the `mcp` branch's closing `}` (before the `if (parsed.command === 'ingest')` branch):

```typescript
  if (parsed.command === 'hook') {
    const result = runHookCommand(parsed.action, parsed.projectId, {
      registry,
      install: installHook,
      uninstall: uninstallHook,
    });
    console.log(
      `[project-rag] ${result.action === 'install' ? 'Installed' : 'Uninstalled'} the post-commit hook for "${result.projectName}".`,
    );
    return;
  }
```

Do NOT change anything else in `index.ts` — the `mcp`/`ingest`/`sync`/`search` branches, the shared setup, and `main().catch(...)` stay exactly as they are.

- [ ] **Step 10: Build and manually verify the full end-to-end hook flow**

This is the actual acceptance criterion from `init.md` §26 Phase 6: "edit docs → git add → git commit → post-commit → project-rag sync → Qdrant updated. The commit must remain successful even when RAG sync fails." Verify it for real:

```bash
npm run build
```

Then, from the repo root, run this sequence (creates a scratch git repo + scratch registry, both outside this repo, cleaned up at the end):

```bash
SCRATCH=$(mktemp -d)
git init -b main "$SCRATCH/demo-repo" -q
git -C "$SCRATCH/demo-repo" config user.email test@test.com
git -C "$SCRATCH/demo-repo" config user.name Test
mkdir -p "$SCRATCH/demo-repo/docs"
echo "# Demo" > "$SCRATCH/demo-repo/docs/readme.md"
git -C "$SCRATCH/demo-repo" add .
git -C "$SCRATCH/demo-repo" commit -q -m "init"

echo '{"projects":[{"id":"demo","name":"demo","repository":"'"$SCRATCH/demo-repo"'","paths":["docs"]}]}' > "$SCRATCH/projects.json"

QDRANT_URL=http://localhost:6333 EMBEDDING_PROVIDER=ollama EMBEDDING_MODEL=bge-m3 PROJECT_REGISTRY_PATH="$SCRATCH/projects.json" node "$(pwd)/dist/cli/index.js" hook install demo

cat "$SCRATCH/demo-repo/.git/hooks/post-commit"

echo "# Demo updated" >> "$SCRATCH/demo-repo/docs/readme.md"
git -C "$SCRATCH/demo-repo" add .
QDRANT_URL=http://localhost:6333 EMBEDDING_PROVIDER=ollama EMBEDDING_MODEL=bge-m3 PROJECT_REGISTRY_PATH="$SCRATCH/projects.json" git -C "$SCRATCH/demo-repo" commit -q -m "update docs"
echo "commit exit code: $?"

rm -rf "$SCRATCH"
```

Expected:
- `cat` of the hook file shows the generated block with the real absolute paths to `node` and this repo's `dist/cli/index.js`.
- The second `git commit` prints `[project-rag] Sync started...` followed by a `[project-rag] Warning: RAG sync failed...` line (since `QDRANT_URL`/`EMBEDDING_PROVIDER` point at services that aren't actually running here), and **the commit still succeeds** — `commit exit code: 0`. This is the single most important behavior in this phase: prove it, don't just assert it in a unit test.

- [ ] **Step 11: Run the full suite and typecheck for real**

Run: `npm run typecheck && npm test`
Expected: all tests passing, clean typecheck. Paste the real output.

- [ ] **Step 12: Commit**

```bash
git add src/cli/args.ts tests/cli/args.test.ts src/cli/hook-command.ts tests/cli/hook-command.test.ts src/cli/index.ts
git commit -m "feat: add CLI hook install/uninstall command"
```

---

### Task 3: Update Feature Docs to Reflect Phase 6 (Final Phase)

**Files:**
- Modify: `docs/features/06-git-hook-auto-sync.md`
- Modify: `docs/features/README.md`

**Interfaces:**
- Consumes: nothing new — documentation only, per the `project-rag-feature-flow` skill's step 5.

- [ ] **Step 1: Update `docs/features/06-git-hook-auto-sync.md`**

Read the current file first. Change `**Status: Planned**` to `**Status: Implemented**`. Update the "Related Files" section to list: `src/git/hook-installer.ts`, `src/cli/hook-command.ts`, `src/cli/{args,index}.ts` (extended for the `hook` command). Remove any "Not yet implemented"/"Planned" framing. Since this is the LAST of the six phases from `init.md` §26, also note in the doc that all six phases (`init.md` §26) are now implemented — `docs/features/README.md`'s index is the authoritative per-feature status list.

- [ ] **Step 2: Update `docs/features/README.md`**

Replace the `**Updated**:` line with today's date and replace the `**Recent**:` line with: "Phase 6 (Git Hook Auto Sync) implemented: `project-rag hook install/uninstall <project>`, safe chaining with existing hooks, commit-never-blocked-by-sync-failure — see `docs/superpowers/plans/2026-08-08-phase6-git-hook.md`. All six phases from `init.md` §26 are now implemented." Update entry #6's index line from "— Planned" to "— Implemented".

- [ ] **Step 3: Commit**

```bash
git add docs/features/06-git-hook-auto-sync.md docs/features/README.md
git commit -m "docs: mark Phase 6 features implemented (all phases complete)"
```
