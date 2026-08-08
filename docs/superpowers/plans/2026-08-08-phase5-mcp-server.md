# Phase 5 — MCP Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the MCP server (`project-rag mcp`) per `init.md` §14–§15 and §26 Phase 5, exposing `search_project_docs`, `get_project_document`, and `list_project_knowledge` — the single MCP interface shared by Claude Code, OpenCode, and any other MCP-compatible agent (`init.md` §28), reusing Phase 4's `searchProject` rather than a separate implementation.

**Architecture:** A project-resolution helper (`src/projects/project-resolver.ts`, `init.md` §15 — explicit `project` param wins, otherwise match the caller's cwd against registered repositories, error on zero or multiple matches, never guess), a path-traversal-and-configured-paths-scoped document reader (`src/mcp/document-reader.ts` — closes a real gap: a direct filesystem read for `get_project_document` bypasses the scanner's `.env`/exclusion rules entirely unless this module re-applies an equivalent boundary), a tiny shared MCP result helper (`src/mcp/tool-result.ts`), the three tool modules (`src/mcp/tools/*.ts`), a server assembly function (`src/mcp/server.ts`), and a fourth CLI command (`mcp`, no project id — resolution happens per tool call).

**Dependency verification (done before writing this plan, not guessed):** `@modelcontextprotocol/sdk` (v1.30.0) and `zod` (v4.4.3) were installed and their real installed `.d.ts` files read directly (`node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.d.ts`, `.../server/stdio.d.ts`, `.../types.d.ts`) to confirm the exact API — `new McpServer({name, version})`, `server.registerTool(name, {description, inputSchema: <raw Zod shape, NOT z.object(...)>}, async (args, extra) => CallToolResult)`, `new StdioServerTransport()`, `server.connect(transport)`. A full end-to-end smoke test (`McpServer` + `Client` + `InMemoryTransport.createLinkedPair()`, register one tool, call it) was run and passed before this plan was written, confirming the exact pattern used throughout this plan actually works — not just types that compile.

**Tech Stack:** Node.js 24, TypeScript, Vitest, `@qdrant/js-client-rest` (existing), plus two NEW dependencies for this phase: `@modelcontextprotocol/sdk` and `zod` (both already installed and present in `package.json`/`package-lock.json` as of this plan being written — `init.md` §3 explicitly calls for "MCP SDK for the MCP server", so this is not scope creep).

## Global Constraints

- **Project isolation for every MCP call**: each tool resolves its target project before touching any data, via `resolveProject` — explicit `project` argument wins, otherwise resolved from the server process's cwd; ambiguous or unmatched cwd is a hard error, never a guess (`init.md` §15, §21.7).
- **`get_project_document` must be path-traversal-safe AND scoped to the project's configured documentation paths** (not just "inside the repo") — a direct filesystem read bypasses the ingestion scanner's own exclusion rules (`.env`, files outside `docs/`, etc.), so the document reader must re-apply an equivalent boundary itself (`init.md` §14, §21.3, §21.6).
- **Validate all MCP tool parameters** (`init.md` §21.10) — every tool's `inputSchema` is a real Zod shape (the SDK validates automatically against it before the handler runs; that's the actual reason to use Zod here, not decoration).
- **Do not expose unnecessary absolute paths through MCP responses** (`init.md` §5, §21.9) — `search_project_docs` reuses Phase 4's `SearchResult` (already `file`/`section`/`score`/`content` only, no `absolute_path`); `list_project_knowledge` returns the same relative `file` keys `getIndexedFileHashes` already uses; `get_project_document` takes a relative `file` input and returns content only.
- **One MCP server implementation shared by all agents** (`init.md` §28) — no Claude-Code-specific or OpenCode-specific logic anywhere in `src/mcp/`.
- **Mock the registry/Qdrant client/embedding provider in tool tests** — but exercise the REAL `McpServer`/`Client`/`InMemoryTransport` wiring (no live network, no live MCP client process) so schema validation and result-shape correctness are actually verified, not just handler logic in isolation (`init.md` §23).
- **No new dependencies beyond the two already justified by `init.md` §3** (`@modelcontextprotocol/sdk`, `zod`) — no CLI framework, no HTTP layer.

---

### Task 1: Project Resolver

**Files:**
- Create: `src/projects/project-resolver.ts`
- Test: `tests/projects/project-resolver.test.ts`

**Interfaces:**
- Consumes: `ProjectRegistry`/`ProjectConfig` (Phase 1 `src/projects/project-registry.ts`, `src/projects/project-types.ts`)
- Produces: `function resolveProject(registry: ProjectRegistry, cwd: string, explicitProjectId?: string): ProjectConfig` — consumed by all three MCP tools (Tasks 3-5).

- [ ] **Step 1: Write the failing test**

`tests/projects/project-resolver.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ProjectRegistry } from '../../src/projects/project-registry';
import { resolveProject } from '../../src/projects/project-resolver';

describe('resolveProject', () => {
  let dir: string;
  let registry: ProjectRegistry;
  let repoA: string;
  let repoB: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'project-rag-resolver-'));
    repoA = path.join(dir, 'repo-a');
    repoB = path.join(dir, 'repo-b');
    mkdirSync(path.join(repoA, '.git'), { recursive: true });
    mkdirSync(path.join(repoB, '.git'), { recursive: true });
    registry = new ProjectRegistry(path.join(dir, 'projects.json'));
    registry.register('project-a', repoA);
    registry.register('project-b', repoB);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('resolves the project whose repository contains the cwd', () => {
    const project = resolveProject(registry, repoA, undefined);
    expect(project.id).toBe('project-a');
  });

  it('resolves correctly from a subdirectory of the repository', () => {
    const subdir = path.join(repoB, 'docs', 'features');
    mkdirSync(subdir, { recursive: true });
    const project = resolveProject(registry, subdir, undefined);
    expect(project.id).toBe('project-b');
  });

  it('prefers an explicit project id over cwd resolution', () => {
    const project = resolveProject(registry, repoB, 'project-a');
    expect(project.id).toBe('project-a');
  });

  it('throws a clear error for an unregistered explicit project id', () => {
    expect(() => resolveProject(registry, repoA, 'missing')).toThrow('is not registered');
  });

  it('throws a clear error when cwd matches no registered project', () => {
    const outside = path.join(dir, 'outside');
    mkdirSync(outside, { recursive: true });
    expect(() => resolveProject(registry, outside, undefined)).toThrow('No registered project found');
  });

  it('throws a clear error when cwd is ambiguous between nested projects', () => {
    const nestedRepo = path.join(repoA, 'nested-repo');
    mkdirSync(path.join(nestedRepo, '.git'), { recursive: true });
    registry.register('nested', nestedRepo);
    expect(() => resolveProject(registry, nestedRepo, undefined)).toThrow('Ambiguous project');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/projects/project-resolver.test.ts`
Expected: FAIL with "Cannot find module '../../src/projects/project-resolver'".

- [ ] **Step 3: Write minimal implementation**

`src/projects/project-resolver.ts`:

```typescript
import path from 'node:path';
import type { ProjectRegistry } from './project-registry';
import type { ProjectConfig } from './project-types';

export function resolveProject(
  registry: ProjectRegistry,
  cwd: string,
  explicitProjectId?: string,
): ProjectConfig {
  if (explicitProjectId) {
    const project = registry.find(explicitProjectId);
    if (!project) {
      throw new Error(`Project "${explicitProjectId}" is not registered`);
    }
    return project;
  }

  const resolvedCwd = path.resolve(cwd);
  const matches = registry.list().filter((project) => {
    const repositoryRoot = path.resolve(project.repository);
    return resolvedCwd === repositoryRoot || resolvedCwd.startsWith(repositoryRoot + path.sep);
  });

  if (matches.length === 0) {
    throw new Error(
      `No registered project found for the current directory (${cwd}). Pass an explicit "project" argument.`,
    );
  }
  if (matches.length > 1) {
    throw new Error(
      `Ambiguous project for the current directory (${cwd}): matches ${matches
        .map((m) => m.id)
        .join(', ')}. Pass an explicit "project" argument.`,
    );
  }
  return matches[0];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/projects/project-resolver.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Run the full suite and typecheck for real**

Run: `npm run typecheck && npm test`
Expected: clean typecheck, all tests passing. Actually run these and paste the real output — do not assume success.

- [ ] **Step 6: Commit**

```bash
git add src/projects/project-resolver.ts tests/projects/project-resolver.test.ts
git commit -m "feat: add cwd-or-explicit project resolver for MCP tools"
```

---

### Task 2: Path-Traversal-Safe Document Reader

**Files:**
- Create: `src/mcp/document-reader.ts`
- Test: `tests/mcp/document-reader.test.ts`

**Interfaces:**
- Consumes: `ProjectConfig` (Phase 1 `src/projects/project-types.ts`)
- Produces: `function getProjectDocument(project: ProjectConfig, file: string): string` — consumed by Task 4's `get_project_document` tool.

- [ ] **Step 1: Write the failing test**

`tests/mcp/document-reader.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { getProjectDocument } from '../../src/mcp/document-reader';

describe('getProjectDocument', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'project-rag-docreader-'));
    mkdirSync(path.join(dir, 'docs', 'steering'), { recursive: true });
    writeFileSync(path.join(dir, 'docs', 'steering', 'architecture.md'), '# Architecture\n\nContent.\n');
    writeFileSync(path.join(dir, 'secret.txt'), 'top secret');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const project = () => ({ id: 'sample', name: 'sample', repository: dir, paths: ['docs'] });

  it('reads a document inside the configured paths', () => {
    const content = getProjectDocument(project(), 'docs/steering/architecture.md');
    expect(content).toContain('# Architecture');
  });

  it('rejects a path that escapes the repository root', () => {
    expect(() => getProjectDocument(project(), '../../etc/passwd')).toThrow('escapes repository root');
  });

  it('rejects a file that exists in the repo but outside the configured paths', () => {
    expect(() => getProjectDocument(project(), 'secret.txt')).toThrow(
      "outside the project's configured documentation paths",
    );
  });

  it('rejects a nonexistent file within the configured paths', () => {
    expect(() => getProjectDocument(project(), 'docs/steering/does-not-exist.md')).toThrow('File not found');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/mcp/document-reader.test.ts`
Expected: FAIL with "Cannot find module '../../src/mcp/document-reader'".

- [ ] **Step 3: Write minimal implementation**

`src/mcp/document-reader.ts`:

```typescript
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { ProjectConfig } from '../projects/project-types';

export function getProjectDocument(project: ProjectConfig, file: string): string {
  const resolvedRoot = path.resolve(project.repository);
  const resolvedTarget = path.resolve(project.repository, file);
  if (resolvedTarget !== resolvedRoot && !resolvedTarget.startsWith(resolvedRoot + path.sep)) {
    throw new Error(`File path escapes repository root: ${file}`);
  }

  const relativePath = path.relative(resolvedRoot, resolvedTarget).split(path.sep).join('/');
  const withinConfiguredPath = project.paths.some((configuredPath) => {
    const prefix = configuredPath.endsWith('/') ? configuredPath : `${configuredPath}/`;
    return relativePath === configuredPath || relativePath.startsWith(prefix);
  });
  if (!withinConfiguredPath) {
    throw new Error(`File is outside the project's configured documentation paths: ${file}`);
  }

  if (!existsSync(resolvedTarget)) {
    throw new Error(`File not found: ${file}`);
  }

  return readFileSync(resolvedTarget, 'utf8');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/mcp/document-reader.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Run the full suite and typecheck for real**

Run: `npm run typecheck && npm test`
Expected: clean typecheck, all tests passing. Paste the real output.

- [ ] **Step 6: Commit**

```bash
git add src/mcp/document-reader.ts tests/mcp/document-reader.test.ts
git commit -m "feat: add path-traversal-safe, configured-path-scoped document reader"
```

---

### Task 3: MCP Result Helpers + `search_project_docs` Tool

**Files:**
- Create: `src/mcp/tool-result.ts`
- Test: `tests/mcp/tool-result.test.ts`
- Create: `src/mcp/tools/search-project-docs.ts`
- Test: `tests/mcp/tools/search-project-docs.test.ts`

**Interfaces:**
- Consumes: `CallToolResult` type from `@modelcontextprotocol/sdk/types.js`, `McpServer` from `@modelcontextprotocol/sdk/server/mcp.js`, `z` from `zod`, `resolveProject` (Task 1), `ProjectRegistry`/`ProjectConfig` (Phase 1), `SearchResult` (Phase 4 `src/retrieval/search.ts`)
- Produces: `function toolText(text: string): CallToolResult`, `function toolError(error: unknown): CallToolResult`, `interface SearchProjectDocsDeps { registry: ProjectRegistry; search: (project: ProjectConfig, query: string) => Promise<SearchResult[]>; cwd: () => string }`, and `function registerSearchProjectDocsTool(server: McpServer, deps: SearchProjectDocsDeps): void` — the tool-result helpers are reused by Task 4 and Task 5's tools.

- [ ] **Step 1: Write the failing test for `tool-result.ts`**

`tests/mcp/tool-result.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { toolText, toolError } from '../../src/mcp/tool-result';

describe('toolText', () => {
  it('wraps text in a content array', () => {
    expect(toolText('hello')).toEqual({ content: [{ type: 'text', text: 'hello' }] });
  });
});

describe('toolError', () => {
  it('wraps an Error message with isError true', () => {
    expect(toolError(new Error('boom'))).toEqual({
      content: [{ type: 'text', text: 'boom' }],
      isError: true,
    });
  });

  it('stringifies a non-Error value', () => {
    expect(toolError('plain string')).toEqual({
      content: [{ type: 'text', text: 'plain string' }],
      isError: true,
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/mcp/tool-result.test.ts`
Expected: FAIL with "Cannot find module '../../src/mcp/tool-result'".

- [ ] **Step 3: Write minimal implementation for `tool-result.ts`**

`src/mcp/tool-result.ts`:

```typescript
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

export function toolText(text: string): CallToolResult {
  return { content: [{ type: 'text', text }] };
}

export function toolError(error: unknown): CallToolResult {
  return {
    content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }],
    isError: true,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/mcp/tool-result.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Write the failing test for `search-project-docs.ts`**

`tests/mcp/tools/search-project-docs.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { registerSearchProjectDocsTool } from '../../../src/mcp/tools/search-project-docs';

describe('search_project_docs tool', () => {
  let dir: string;
  let repo: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'project-rag-mcp-search-'));
    repo = path.join(dir, 'repo');
    mkdirSync(path.join(repo, '.git'), { recursive: true });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  async function setup(deps: any) {
    const server = new McpServer({ name: 'test', version: '0.0.1' });
    registerSearchProjectDocsTool(server, deps);
    const client = new Client({ name: 'test-client', version: '0.0.1' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
    return client;
  }

  it('resolves the project via cwd and returns search results as JSON text', async () => {
    const registry = {
      list: vi.fn().mockReturnValue([{ id: 'sample', name: 'Sample', repository: repo, paths: ['docs'] }]),
      find: vi.fn(),
    } as any;
    const search = vi.fn().mockResolvedValue([{ file: 'a.md', section: 'Intro', score: 0.9, content: 'hi' }]);
    const client = await setup({ registry, search, cwd: () => repo });

    const result: any = await client.callTool({ name: 'search_project_docs', arguments: { query: 'hello' } });

    expect(search).toHaveBeenCalledWith(
      { id: 'sample', name: 'Sample', repository: repo, paths: ['docs'] },
      'hello',
    );
    expect(result.isError).toBeFalsy();
    expect(JSON.parse(result.content[0].text)).toEqual([
      { file: 'a.md', section: 'Intro', score: 0.9, content: 'hi' },
    ]);
  });

  it('returns an isError result when the project cannot be resolved', async () => {
    const registry = { list: vi.fn().mockReturnValue([]), find: vi.fn() } as any;
    const search = vi.fn();
    const client = await setup({ registry, search, cwd: () => path.join(dir, 'nowhere') });

    const result: any = await client.callTool({ name: 'search_project_docs', arguments: { query: 'hello' } });

    expect(result.isError).toBe(true);
    expect(search).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx vitest run tests/mcp/tools/search-project-docs.test.ts`
Expected: FAIL with "Cannot find module '../../../src/mcp/tools/search-project-docs'".

- [ ] **Step 7: Write minimal implementation for `search-project-docs.ts`**

`src/mcp/tools/search-project-docs.ts`:

```typescript
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ProjectRegistry } from '../../projects/project-registry';
import type { ProjectConfig } from '../../projects/project-types';
import type { SearchResult } from '../../retrieval/search';
import { resolveProject } from '../../projects/project-resolver';
import { toolText, toolError } from '../tool-result';

export interface SearchProjectDocsDeps {
  registry: ProjectRegistry;
  search: (project: ProjectConfig, query: string) => Promise<SearchResult[]>;
  cwd: () => string;
}

export function registerSearchProjectDocsTool(server: McpServer, deps: SearchProjectDocsDeps): void {
  server.registerTool(
    'search_project_docs',
    {
      description: "Search a project's indexed documentation for relevant content, scoped to a single project.",
      inputSchema: {
        query: z.string().describe('The search query'),
        project: z
          .string()
          .optional()
          .describe('Explicit project id; if omitted, resolved from the current working directory'),
      },
    },
    async ({ query, project: projectId }) => {
      try {
        const project = resolveProject(deps.registry, deps.cwd(), projectId);
        const results = await deps.search(project, query);
        return toolText(JSON.stringify(results, null, 2));
      } catch (error) {
        return toolError(error);
      }
    },
  );
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npx vitest run tests/mcp/tools/search-project-docs.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 9: Run the full suite and typecheck for real**

Run: `npm run typecheck && npm test`
Expected: clean typecheck, all tests passing. Paste the real output.

- [ ] **Step 10: Commit**

```bash
git add src/mcp/tool-result.ts tests/mcp/tool-result.test.ts src/mcp/tools/search-project-docs.ts tests/mcp/tools/search-project-docs.test.ts
git commit -m "feat: add search_project_docs MCP tool"
```

---

### Task 4: `get_project_document` Tool

**Files:**
- Create: `src/mcp/tools/get-project-document.ts`
- Test: `tests/mcp/tools/get-project-document.test.ts`

**Interfaces:**
- Consumes: `resolveProject` (Task 1), `getProjectDocument` (Task 2), `toolText`/`toolError` (Task 3), `McpServer`, `z`, `ProjectRegistry`
- Produces: `interface GetProjectDocumentDeps { registry: ProjectRegistry; cwd: () => string }` and `function registerGetProjectDocumentTool(server: McpServer, deps: GetProjectDocumentDeps): void`.

- [ ] **Step 1: Write the failing test**

`tests/mcp/tools/get-project-document.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { registerGetProjectDocumentTool } from '../../../src/mcp/tools/get-project-document';

describe('get_project_document tool', () => {
  let dir: string;
  let repo: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'project-rag-mcp-getdoc-'));
    repo = path.join(dir, 'repo');
    mkdirSync(path.join(repo, 'docs'), { recursive: true });
    writeFileSync(path.join(repo, 'docs', 'architecture.md'), '# Architecture\n');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  async function setup(deps: any) {
    const server = new McpServer({ name: 'test', version: '0.0.1' });
    registerGetProjectDocumentTool(server, deps);
    const client = new Client({ name: 'test-client', version: '0.0.1' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
    return client;
  }

  it("returns a document's content", async () => {
    const registry = {
      list: vi.fn().mockReturnValue([{ id: 'sample', name: 'Sample', repository: repo, paths: ['docs'] }]),
      find: vi.fn(),
    } as any;
    const client = await setup({ registry, cwd: () => repo });

    const result: any = await client.callTool({
      name: 'get_project_document',
      arguments: { file: 'docs/architecture.md' },
    });

    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain('# Architecture');
  });

  it('rejects path traversal attempts with an isError result', async () => {
    const registry = {
      list: vi.fn().mockReturnValue([{ id: 'sample', name: 'Sample', repository: repo, paths: ['docs'] }]),
      find: vi.fn(),
    } as any;
    const client = await setup({ registry, cwd: () => repo });

    const result: any = await client.callTool({
      name: 'get_project_document',
      arguments: { file: '../../../etc/passwd' },
    });

    expect(result.isError).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/mcp/tools/get-project-document.test.ts`
Expected: FAIL with "Cannot find module '../../../src/mcp/tools/get-project-document'".

- [ ] **Step 3: Write minimal implementation**

`src/mcp/tools/get-project-document.ts`:

```typescript
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ProjectRegistry } from '../../projects/project-registry';
import { resolveProject } from '../../projects/project-resolver';
import { getProjectDocument } from '../document-reader';
import { toolText, toolError } from '../tool-result';

export interface GetProjectDocumentDeps {
  registry: ProjectRegistry;
  cwd: () => string;
}

export function registerGetProjectDocumentTool(server: McpServer, deps: GetProjectDocumentDeps): void {
  server.registerTool(
    'get_project_document',
    {
      description: 'Return the content of a specific document within a project. Path-traversal-safe.',
      inputSchema: {
        file: z
          .string()
          .describe('Path to the document, relative to the repository root (e.g. docs/steering/architecture.md)'),
        project: z
          .string()
          .optional()
          .describe('Explicit project id; if omitted, resolved from the current working directory'),
      },
    },
    async ({ file, project: projectId }) => {
      try {
        const project = resolveProject(deps.registry, deps.cwd(), projectId);
        const content = getProjectDocument(project, file);
        return toolText(content);
      } catch (error) {
        return toolError(error);
      }
    },
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/mcp/tools/get-project-document.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Run the full suite and typecheck for real**

Run: `npm run typecheck && npm test`
Expected: clean typecheck, all tests passing. Paste the real output.

- [ ] **Step 6: Commit**

```bash
git add src/mcp/tools/get-project-document.ts tests/mcp/tools/get-project-document.test.ts
git commit -m "feat: add get_project_document MCP tool"
```

---

### Task 5: `list_project_knowledge` Tool

**Files:**
- Create: `src/mcp/tools/list-project-knowledge.ts`
- Test: `tests/mcp/tools/list-project-knowledge.test.ts`

**Interfaces:**
- Consumes: `resolveProject` (Task 1), `toolText`/`toolError` (Task 3), `getIndexedFileHashes` (Phase 3 `src/qdrant/qdrant-repository.ts` — reused as-is, no new Qdrant function needed), `McpServer`, `z`, `ProjectRegistry`, `QdrantClient`
- Produces: `interface ListProjectKnowledgeDeps { registry: ProjectRegistry; qdrantClient: QdrantClient; qdrantCollection: string; cwd: () => string }` and `function registerListProjectKnowledgeTool(server: McpServer, deps: ListProjectKnowledgeDeps): void`.

- [ ] **Step 1: Write the failing test**

`tests/mcp/tools/list-project-knowledge.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { registerListProjectKnowledgeTool } from '../../../src/mcp/tools/list-project-knowledge';

describe('list_project_knowledge tool', () => {
  let dir: string;
  let repo: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'project-rag-mcp-listknow-'));
    repo = path.join(dir, 'repo');
    mkdirSync(path.join(repo, '.git'), { recursive: true });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  async function setup(deps: any) {
    const server = new McpServer({ name: 'test', version: '0.0.1' });
    registerListProjectKnowledgeTool(server, deps);
    const client = new Client({ name: 'test-client', version: '0.0.1' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
    return client;
  }

  it('lists indexed files for the resolved project, sorted', async () => {
    const registry = {
      list: vi.fn().mockReturnValue([{ id: 'sample', name: 'Sample', repository: repo, paths: ['docs'] }]),
      find: vi.fn(),
    } as any;
    const qdrantClient = {
      scroll: vi.fn().mockResolvedValue({
        points: [
          { id: '1', payload: { file: 'docs/b.md', content_hash: 'h2' } },
          { id: '2', payload: { file: 'docs/a.md', content_hash: 'h1' } },
        ],
        next_page_offset: null,
      }),
    } as any;
    const client = await setup({
      registry,
      qdrantClient,
      qdrantCollection: 'project_rag_documents',
      cwd: () => repo,
    });

    const result: any = await client.callTool({ name: 'list_project_knowledge', arguments: {} });

    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toBe('docs/a.md\ndocs/b.md');
  });

  it('reports when nothing is indexed yet', async () => {
    const registry = {
      list: vi.fn().mockReturnValue([{ id: 'sample', name: 'Sample', repository: repo, paths: ['docs'] }]),
      find: vi.fn(),
    } as any;
    const qdrantClient = { scroll: vi.fn().mockResolvedValue({ points: [], next_page_offset: null }) } as any;
    const client = await setup({
      registry,
      qdrantClient,
      qdrantCollection: 'project_rag_documents',
      cwd: () => repo,
    });

    const result: any = await client.callTool({ name: 'list_project_knowledge', arguments: {} });

    expect(result.content[0].text).toBe('No documents indexed yet.');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/mcp/tools/list-project-knowledge.test.ts`
Expected: FAIL with "Cannot find module '../../../src/mcp/tools/list-project-knowledge'".

- [ ] **Step 3: Write minimal implementation**

`src/mcp/tools/list-project-knowledge.ts`:

```typescript
import type { QdrantClient } from '@qdrant/js-client-rest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ProjectRegistry } from '../../projects/project-registry';
import { resolveProject } from '../../projects/project-resolver';
import { getIndexedFileHashes } from '../../qdrant/qdrant-repository';
import { toolText, toolError } from '../tool-result';

export interface ListProjectKnowledgeDeps {
  registry: ProjectRegistry;
  qdrantClient: QdrantClient;
  qdrantCollection: string;
  cwd: () => string;
}

export function registerListProjectKnowledgeTool(server: McpServer, deps: ListProjectKnowledgeDeps): void {
  server.registerTool(
    'list_project_knowledge',
    {
      description: 'List the documentation files currently indexed for a project.',
      inputSchema: {
        project: z
          .string()
          .optional()
          .describe('Explicit project id; if omitted, resolved from the current working directory'),
      },
    },
    async ({ project: projectId }) => {
      try {
        const project = resolveProject(deps.registry, deps.cwd(), projectId);
        const hashes = await getIndexedFileHashes(deps.qdrantClient, deps.qdrantCollection, project.id);
        const files = [...hashes.keys()].sort();
        return toolText(files.length > 0 ? files.join('\n') : 'No documents indexed yet.');
      } catch (error) {
        return toolError(error);
      }
    },
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/mcp/tools/list-project-knowledge.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Run the full suite and typecheck for real**

Run: `npm run typecheck && npm test`
Expected: clean typecheck, all tests passing. Paste the real output.

- [ ] **Step 6: Commit**

```bash
git add src/mcp/tools/list-project-knowledge.ts tests/mcp/tools/list-project-knowledge.test.ts
git commit -m "feat: add list_project_knowledge MCP tool"
```

---

### Task 6: MCP Server Assembly + CLI `mcp` Command

**Files:**
- Create: `src/mcp/server.ts`
- Test: `tests/mcp/server.test.ts`
- Modify: `src/cli/args.ts` (add the `mcp` command, no project id needed)
- Modify: `tests/cli/args.test.ts` (add `mcp` cases)
- Modify: `src/cli/index.ts` (dispatch to `mcp` — connects `StdioServerTransport`, the process then stays alive serving stdio)

**Interfaces:**
- Consumes: `registerSearchProjectDocsTool`/`registerGetProjectDocumentTool`/`registerListProjectKnowledgeTool` (Tasks 3-5), `McpServer`/`StdioServerTransport`, `ProjectRegistry`, `QdrantClient`, `SearchResult`/`ProjectConfig`
- Produces: `interface CreateMcpServerDeps { registry: ProjectRegistry; qdrantClient: QdrantClient; qdrantCollection: string; search: (project: ProjectConfig, query: string) => Promise<SearchResult[]>; cwd?: () => string }` and `function createMcpServer(deps: CreateMcpServerDeps): McpServer`.

- [ ] **Step 1: Write the failing test for `server.ts`**

`tests/mcp/server.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from '../../src/mcp/server';

describe('createMcpServer', () => {
  it('registers all three tools', async () => {
    const registry = { list: vi.fn().mockReturnValue([]), find: vi.fn() } as any;
    const qdrantClient = {} as any;
    const server = createMcpServer({
      registry,
      qdrantClient,
      qdrantCollection: 'project_rag_documents',
      search: vi.fn(),
    });

    const client = new Client({ name: 'test-client', version: '0.0.1' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

    const tools = await client.listTools();
    const names = tools.tools.map((t) => t.name).sort();

    expect(names).toEqual(['get_project_document', 'list_project_knowledge', 'search_project_docs']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/mcp/server.test.ts`
Expected: FAIL with "Cannot find module '../../src/mcp/server'".

- [ ] **Step 3: Write minimal implementation for `server.ts`**

`src/mcp/server.ts`:

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { QdrantClient } from '@qdrant/js-client-rest';
import type { ProjectRegistry } from '../projects/project-registry';
import type { ProjectConfig } from '../projects/project-types';
import type { SearchResult } from '../retrieval/search';
import { registerSearchProjectDocsTool } from './tools/search-project-docs';
import { registerGetProjectDocumentTool } from './tools/get-project-document';
import { registerListProjectKnowledgeTool } from './tools/list-project-knowledge';

export interface CreateMcpServerDeps {
  registry: ProjectRegistry;
  qdrantClient: QdrantClient;
  qdrantCollection: string;
  search: (project: ProjectConfig, query: string) => Promise<SearchResult[]>;
  cwd?: () => string;
}

export function createMcpServer(deps: CreateMcpServerDeps): McpServer {
  const cwd = deps.cwd ?? (() => process.cwd());
  const server = new McpServer({ name: 'project-rag', version: '0.1.0' });

  registerSearchProjectDocsTool(server, { registry: deps.registry, search: deps.search, cwd });
  registerGetProjectDocumentTool(server, { registry: deps.registry, cwd });
  registerListProjectKnowledgeTool(server, {
    registry: deps.registry,
    qdrantClient: deps.qdrantClient,
    qdrantCollection: deps.qdrantCollection,
    cwd,
  });

  return server;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/mcp/server.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Write the failing tests for `args.ts`**

Read the current `tests/cli/args.test.ts` first, then add this case inside the existing `describe('parseArgs', ...)` block (do not remove the existing 10 cases):

```typescript
  it('parses the mcp command with no project id needed', () => {
    expect(parseArgs(['mcp'])).toEqual({ command: 'mcp' });
  });
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx vitest run tests/cli/args.test.ts`
Expected: FAIL — `parseArgs` doesn't recognize `'mcp'` yet.

- [ ] **Step 7: Update `src/cli/args.ts`**

Read the current file first, then replace its entire contents with:

```typescript
export type ParsedArgs =
  | { command: 'ingest'; projectId: string }
  | { command: 'sync'; projectId: string }
  | { command: 'search'; projectId: string; query: string }
  | { command: 'mcp' }
  | { command: 'unknown' };

export function parseArgs(argv: string[]): ParsedArgs {
  const [command, projectId, ...rest] = argv;
  if (command === 'mcp') {
    return { command: 'mcp' };
  }
  if ((command === 'ingest' || command === 'sync') && projectId) {
    return { command, projectId };
  }
  if (command === 'search' && projectId && rest.length > 0) {
    return { command: 'search', projectId, query: rest.join(' ') };
  }
  return { command: 'unknown' };
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npx vitest run tests/cli/args.test.ts`
Expected: PASS (11 tests: 10 existing + 1 new).

- [ ] **Step 9: Update `src/cli/index.ts` to dispatch the `mcp` command (no TDD — thin process wiring, verified manually in Step 10)**

Read the current file first, then apply these edits:

1. Add two new import lines after the existing `import { createEmbeddingProvider } from '../embedding/embedding-provider';` line:

```typescript
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMcpServer } from '../mcp/server';
```

2. Change the usage-error condition from:

```typescript
  if (parsed.command === 'unknown') {
    console.error('Usage: project-rag <ingest|sync> <project>  |  project-rag search <project> "<query>"');
```

to:

```typescript
  if (parsed.command === 'unknown') {
    console.error(
      'Usage: project-rag <ingest|sync> <project>  |  project-rag search <project> "<query>"  |  project-rag mcp',
    );
```

3. Add a new branch immediately after the `const onLog = ...` line (before the existing `if (parsed.command === 'ingest')` branch):

```typescript
  if (parsed.command === 'mcp') {
    const server = createMcpServer({
      registry,
      qdrantClient,
      qdrantCollection: config.qdrantCollection,
      search: (project, query) =>
        searchProject(project.id, query, {
          qdrantClient,
          qdrantCollection: config.qdrantCollection,
          embeddingProvider,
          topK: config.ragTopK,
        }),
    });
    const transport = new StdioServerTransport();
    await server.connect(transport);
    return;
  }
```

Do NOT change anything else in `index.ts` — the `ingest`/`sync`/`search` branches, the shared setup (`loadConfig`/`registry`/`qdrantClient`/`embeddingProvider`), and the final `main().catch(...)` stay exactly as they are.

- [ ] **Step 10: Build and manually verify the `mcp` command actually serves tools over stdio**

```bash
npm run build
```

Then write a small one-off verification script (delete it after running — it is not part of the shipped code) at the repo root, e.g. `mcp-verify.mjs`:

```javascript
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const transport = new StdioClientTransport({
  command: 'node',
  args: ['dist/cli/index.js', 'mcp'],
  env: {
    QDRANT_URL: 'http://localhost:6333',
    EMBEDDING_PROVIDER: 'ollama',
    EMBEDDING_MODEL: 'bge-m3',
    PROJECT_REGISTRY_PATH: './config/projects.json',
  },
});
const client = new Client({ name: 'verify-client', version: '0.0.1' });
await client.connect(transport);
const tools = await client.listTools();
console.log('TOOLS:', JSON.stringify(tools.tools.map((t) => t.name).sort()));
await client.close();
```

Run: `node mcp-verify.mjs`
Expected output: `TOOLS: ["get_project_document","list_project_knowledge","search_project_docs"]` — this proves the real built CLI, spawned as a real child process, serves all three tools over stdio with no live Qdrant/embedding call needed (listing tools requires none). Delete `mcp-verify.mjs` after this passes; it must not be committed.

- [ ] **Step 11: Run the full suite and typecheck for real**

Run: `npm run typecheck && npm test`
Expected: all tests passing, clean typecheck. Paste the real output.

- [ ] **Step 12: Commit**

```bash
git add src/mcp/server.ts tests/mcp/server.test.ts src/cli/args.ts tests/cli/args.test.ts src/cli/index.ts
git commit -m "feat: assemble MCP server and add CLI mcp command"
```

---

### Task 7: Update Feature Docs to Reflect Phase 5

**Files:**
- Modify: `docs/features/05-mcp-server.md`
- Modify: `docs/features/README.md`

**Interfaces:**
- Consumes: nothing new — documentation only, per the `project-rag-feature-flow` skill's step 5.

- [ ] **Step 1: Update `docs/features/05-mcp-server.md`**

Read the current file first. Change `**Status: Planned**` to `**Status: Implemented**`. Update the "Related Files" section to list: `src/mcp/server.ts`, `src/mcp/tool-result.ts`, `src/mcp/document-reader.ts`, `src/mcp/tools/{search-project-docs,get-project-document,list-project-knowledge}.ts`, `src/projects/project-resolver.ts`, `src/cli/{args,index}.ts` (extended for the `mcp` command). Remove any "Not yet implemented"/"Planned" framing specific to this feature.

- [ ] **Step 2: Update `docs/features/README.md`**

Replace the `**Updated**:` line with today's date and replace the `**Recent**:` line with: "Phase 5 (MCP Server) implemented: `search_project_docs`, `get_project_document`, `list_project_knowledge`, cwd-or-explicit project resolution, and `project-rag mcp` — see `docs/superpowers/plans/2026-08-08-phase5-mcp-server.md`." Update entry #5's index line from "— Planned" to "— Implemented".

- [ ] **Step 3: Commit**

```bash
git add docs/features/05-mcp-server.md docs/features/README.md
git commit -m "docs: mark Phase 5 features implemented"
```
