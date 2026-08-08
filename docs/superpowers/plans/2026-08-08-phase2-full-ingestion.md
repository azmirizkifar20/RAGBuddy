# Phase 2 — Full Ingestion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire Phase 1's building blocks (scanner, hasher, chunker, embedding provider, Qdrant client) into a working `project-rag ingest <project>` full-rebuild pipeline, per `init.md` §11 and §26 Phase 2 — the first real CLI command.

**Architecture:** A new `src/git/git-status.ts` (current commit hash via `git rev-parse HEAD`), `src/qdrant/qdrant-repository.ts` (project-filtered upsert/delete, the storage layer `docs/steering/architecture.md` already names), `src/ingestion/indexer.ts` (orchestrator: scan → hash → chunk → embed → upsert, with vector size inferred from the first real embedding rather than configured, so no new env var is needed), and a minimal hand-rolled CLI (`src/cli/args.ts`, `src/cli/ingest-command.ts`, `src/cli/index.ts`) — no CLI framework dependency for one command. Point IDs are random UUIDs (`crypto.randomUUID()`): this phase always deletes-then-reinserts a project's whole vector set, so stable/deterministic IDs aren't needed yet (that's Phase 3's incremental-sync concern).

**Tech Stack:** Same as Phase 1 (Node.js 24, TypeScript, Vitest, `@qdrant/js-client-rest`) — no new dependencies.

## Global Constraints

- **Full rebuild only.** This phase always re-indexes every scanned file — do NOT build hash-comparison/skip-unchanged logic here. `content_hash` is computed and stored in each point's payload for Phase 3 to use later, but Phase 2 itself never reads/compares it to decide what to (re)index (`init.md` §11 vs. §10 — sync is a separate, later phase).
- **Mock Qdrant and the embedding provider in every test** — no live Qdrant instance or embedding server required (`init.md` §23). Scanning, hashing, chunking, and git commands run for real against temp fixtures (they're local and deterministic, same precedent as Phase 1).
- **Metadata payload shape** must include at least: `project`, `file`, `absolute_path`, `document_type`, `category`, `content_hash`, `git_commit`, `chunk_index` (`init.md` §5) — plus `title`/`section`/`content` so the future `search_project_docs` MCP tool (`init.md` §14) can return them without a second lookup.
- **Project isolation is enforced at the storage layer**, never left to the caller: every write and delete goes through `qdrant-repository.ts` filtered by `project` (`init.md` §6, §21.7).
- **No new runtime dependencies** — no CLI framework (yargs/commander) for a single command, no HTTP client, no YAML (`init.md` §3, §27).
- **Never commit credentials**; scanner's existing exclusion rules (`.env`, `CLAUDE.md`, `AGENTS.md`, etc.) are untouched (`init.md` §2, §19).

---

### Task 1: Git Commit Metadata Helper

**Files:**
- Create: `src/git/git-status.ts`
- Test: `tests/git/git-status.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `function getCurrentCommit(repositoryPath: string): string | null` — consumed by Task 3's indexer to stamp `git_commit` on every chunk.

- [ ] **Step 1: Write the failing test**

`tests/git/git-status.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { getCurrentCommit } from '../../src/git/git-status';

describe('getCurrentCommit', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'project-rag-git-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns the current commit hash for a repo with commits', () => {
    execFileSync('git', ['init', '-b', 'main'], { cwd: dir });
    execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: dir });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
    writeFileSync(path.join(dir, 'file.txt'), 'hello');
    execFileSync('git', ['add', '.'], { cwd: dir });
    execFileSync('git', ['commit', '-m', 'init'], { cwd: dir });

    const commit = getCurrentCommit(dir);
    expect(commit).toMatch(/^[0-9a-f]{40}$/);
  });

  it('returns null for a repo with no commits yet', () => {
    execFileSync('git', ['init', '-b', 'main'], { cwd: dir });
    expect(getCurrentCommit(dir)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/git/git-status.test.ts`
Expected: FAIL with "Cannot find module '../../src/git/git-status'".

- [ ] **Step 3: Write minimal implementation**

`src/git/git-status.ts`:

```typescript
import { execFileSync } from 'node:child_process';

export function getCurrentCommit(repositoryPath: string): string | null {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repositoryPath,
      encoding: 'utf8',
    }).trim();
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/git/git-status.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/git/git-status.ts tests/git/git-status.test.ts
git commit -m "feat: add git commit metadata helper"
```

---

### Task 2: Qdrant Repository Layer

**Files:**
- Create: `src/qdrant/qdrant-repository.ts`
- Test: `tests/qdrant/qdrant-repository.test.ts`

**Interfaces:**
- Consumes: `QdrantClient` type from `@qdrant/js-client-rest` (already a dependency since Phase 1)
- Produces: `interface ChunkPayload { project: string; file: string; absolute_path: string; document_type: string; category: string; content_hash: string; git_commit: string | null; chunk_index: number; title: string; section: string; content: string }`, `interface DocumentPoint { id: string; vector: number[]; payload: ChunkPayload }`, `function upsertChunks(client: QdrantClient, collectionName: string, points: DocumentPoint[]): Promise<void>`, and `function deleteProjectVectors(client: QdrantClient, collectionName: string, project: string): Promise<void>` — consumed by Task 3's indexer.

- [ ] **Step 1: Write the failing test**

`tests/qdrant/qdrant-repository.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { upsertChunks, deleteProjectVectors } from '../../src/qdrant/qdrant-repository';
import type { DocumentPoint } from '../../src/qdrant/qdrant-repository';

describe('upsertChunks', () => {
  it('upserts points with id/vector/payload', async () => {
    const client = { upsert: vi.fn().mockResolvedValue(true) } as any;
    const points: DocumentPoint[] = [
      {
        id: 'a',
        vector: [1, 2],
        payload: {
          project: 'p',
          file: 'f.md',
          absolute_path: '/repo/f.md',
          document_type: 'markdown',
          category: 'features',
          content_hash: 'h',
          git_commit: 'c',
          chunk_index: 0,
          title: 't',
          section: 's',
          content: 'x',
        },
      },
    ];

    await upsertChunks(client, 'docs', points);

    expect(client.upsert).toHaveBeenCalledWith('docs', {
      points: [{ id: 'a', vector: [1, 2], payload: points[0].payload }],
    });
  });

  it('does nothing for an empty points array', async () => {
    const client = { upsert: vi.fn() } as any;
    await upsertChunks(client, 'docs', []);
    expect(client.upsert).not.toHaveBeenCalled();
  });
});

describe('deleteProjectVectors', () => {
  it('deletes points filtered by project', async () => {
    const client = { delete: vi.fn().mockResolvedValue(true) } as any;
    await deleteProjectVectors(client, 'docs', 'bidubadu');
    expect(client.delete).toHaveBeenCalledWith('docs', {
      filter: { must: [{ key: 'project', match: { value: 'bidubadu' } }] },
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/qdrant/qdrant-repository.test.ts`
Expected: FAIL with "Cannot find module '../../src/qdrant/qdrant-repository'".

- [ ] **Step 3: Write minimal implementation**

`src/qdrant/qdrant-repository.ts`:

```typescript
import type { QdrantClient } from '@qdrant/js-client-rest';

export interface ChunkPayload {
  project: string;
  file: string;
  absolute_path: string;
  document_type: string;
  category: string;
  content_hash: string;
  git_commit: string | null;
  chunk_index: number;
  title: string;
  section: string;
  content: string;
}

export interface DocumentPoint {
  id: string;
  vector: number[];
  payload: ChunkPayload;
}

export async function upsertChunks(
  client: QdrantClient,
  collectionName: string,
  points: DocumentPoint[],
): Promise<void> {
  if (points.length === 0) return;
  await client.upsert(collectionName, {
    points: points.map((p) => ({ id: p.id, vector: p.vector, payload: p.payload })),
  });
}

export async function deleteProjectVectors(
  client: QdrantClient,
  collectionName: string,
  project: string,
): Promise<void> {
  await client.delete(collectionName, {
    filter: { must: [{ key: 'project', match: { value: project } }] },
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/qdrant/qdrant-repository.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/qdrant/qdrant-repository.ts tests/qdrant/qdrant-repository.test.ts
git commit -m "feat: add qdrant repository layer (upsert/delete, project-filtered)"
```

---

### Task 3: Ingestion Indexer Orchestrator

**Files:**
- Create: `src/ingestion/indexer.ts`
- Test: `tests/ingestion/indexer.test.ts`

**Interfaces:**
- Consumes: `scanDocuments` (`src/ingestion/scanner.ts`, Phase 1), `hashContent` (`src/ingestion/hasher.ts`, Phase 1), `chunkMarkdown` (`src/ingestion/chunker.ts`, Phase 1), `EmbeddingProvider` (`src/embedding/embedding-provider.ts`, Phase 1), `getCurrentCommit` (Task 1), `ensureCollection` (`src/qdrant/qdrant-client.ts`, Phase 1), `upsertChunks`/`deleteProjectVectors`/`DocumentPoint` (Task 2), `ProjectConfig` (`src/projects/project-types.ts`, Phase 1)
- Produces: `interface IndexProjectDeps { qdrantClient: QdrantClient; qdrantUrl: string; qdrantCollection: string; embeddingProvider: EmbeddingProvider }`, `interface IndexProjectResult { filesIndexed: number; chunksIndexed: number }`, and `function indexProject(project: ProjectConfig, deps: IndexProjectDeps): Promise<IndexProjectResult>` — consumed by Task 5's CLI ingest command.

- [ ] **Step 1: Write the failing test**

`tests/ingestion/indexer.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { indexProject } from '../../src/ingestion/indexer';

describe('indexProject', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'project-rag-indexer-'));
    execFileSync('git', ['init', '-b', 'main'], { cwd: dir });
    execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: dir });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
    mkdirSync(path.join(dir, 'docs', 'features'), { recursive: true });
    writeFileSync(path.join(dir, 'docs', 'features', '01-auth.md'), '# Auth\n\nAuth content.\n');
    execFileSync('git', ['add', '.'], { cwd: dir });
    execFileSync('git', ['commit', '-m', 'init'], { cwd: dir });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('scans, chunks, embeds, and upserts, deriving category from path', async () => {
    const project = { id: 'sample', name: 'sample', repository: dir, paths: ['docs'] };
    const embeddingProvider = {
      embedDocuments: vi.fn().mockResolvedValue([[0.1, 0.2]]),
      embedQuery: vi.fn(),
    };
    const qdrantClient = {
      getCollections: vi.fn().mockResolvedValue({ collections: [] }),
      createCollection: vi.fn().mockResolvedValue(true),
      delete: vi.fn().mockResolvedValue(true),
      upsert: vi.fn().mockResolvedValue(true),
    } as any;

    const result = await indexProject(project, {
      qdrantClient,
      qdrantUrl: 'http://localhost:6333',
      qdrantCollection: 'project_rag_documents',
      embeddingProvider: embeddingProvider as any,
    });

    expect(result).toEqual({ filesIndexed: 1, chunksIndexed: 1 });
    expect(qdrantClient.createCollection).toHaveBeenCalledWith('project_rag_documents', {
      vectors: { size: 2, distance: 'Cosine' },
    });
    expect(qdrantClient.delete).toHaveBeenCalledWith('project_rag_documents', {
      filter: { must: [{ key: 'project', match: { value: 'sample' } }] },
    });
    const upsertCall = qdrantClient.upsert.mock.calls[0];
    expect(upsertCall[0]).toBe('project_rag_documents');
    expect(upsertCall[1].points).toHaveLength(1);
    expect(upsertCall[1].points[0].payload).toMatchObject({
      project: 'sample',
      file: 'docs/features/01-auth.md',
      document_type: 'markdown',
      category: 'features',
      chunk_index: 0,
      title: 'Auth',
    });
    expect(upsertCall[1].points[0].payload.git_commit).toMatch(/^[0-9a-f]{40}$/);
  });

  it('clears existing vectors when there are no documents to index, without creating a collection', async () => {
    rmSync(path.join(dir, 'docs'), { recursive: true, force: true });
    const project = { id: 'sample', name: 'sample', repository: dir, paths: ['docs'] };
    const embeddingProvider = { embedDocuments: vi.fn(), embedQuery: vi.fn() };
    const qdrantClient = {
      getCollections: vi.fn().mockResolvedValue({ collections: [{ name: 'project_rag_documents' }] }),
      createCollection: vi.fn(),
      delete: vi.fn().mockResolvedValue(true),
      upsert: vi.fn(),
    } as any;

    const result = await indexProject(project, {
      qdrantClient,
      qdrantUrl: 'http://localhost:6333',
      qdrantCollection: 'project_rag_documents',
      embeddingProvider: embeddingProvider as any,
    });

    expect(result).toEqual({ filesIndexed: 0, chunksIndexed: 0 });
    expect(qdrantClient.createCollection).not.toHaveBeenCalled();
    expect(qdrantClient.upsert).not.toHaveBeenCalled();
    expect(qdrantClient.delete).toHaveBeenCalledWith('project_rag_documents', {
      filter: { must: [{ key: 'project', match: { value: 'sample' } }] },
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/ingestion/indexer.test.ts`
Expected: FAIL with "Cannot find module '../../src/ingestion/indexer'".

- [ ] **Step 3: Write minimal implementation**

`src/ingestion/indexer.ts`:

```typescript
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { QdrantClient } from '@qdrant/js-client-rest';
import type { ProjectConfig } from '../projects/project-types';
import type { EmbeddingProvider } from '../embedding/embedding-provider';
import { scanDocuments } from './scanner';
import { hashContent } from './hasher';
import { chunkMarkdown } from './chunker';
import { getCurrentCommit } from '../git/git-status';
import { ensureCollection } from '../qdrant/qdrant-client';
import { upsertChunks, deleteProjectVectors, type DocumentPoint } from '../qdrant/qdrant-repository';

export interface IndexProjectDeps {
  qdrantClient: QdrantClient;
  qdrantUrl: string;
  qdrantCollection: string;
  embeddingProvider: EmbeddingProvider;
}

export interface IndexProjectResult {
  filesIndexed: number;
  chunksIndexed: number;
}

export async function indexProject(
  project: ProjectConfig,
  deps: IndexProjectDeps,
): Promise<IndexProjectResult> {
  const files = scanDocuments(project.repository, project.paths);
  const gitCommit = getCurrentCommit(project.repository);
  const points: DocumentPoint[] = [];

  for (const file of files) {
    const content = readFileSync(file.absolutePath, 'utf8');
    const contentHash = hashContent(content);
    const chunks = chunkMarkdown(content);
    if (chunks.length === 0) continue;

    const texts = chunks.map((chunk) => `${chunk.title}\n${chunk.section}\n${chunk.content}`);
    const vectors = await deps.embeddingProvider.embedDocuments(texts);

    for (let i = 0; i < chunks.length; i++) {
      points.push({
        id: randomUUID(),
        vector: vectors[i],
        payload: {
          project: project.id,
          file: file.relativePath,
          absolute_path: file.absolutePath,
          document_type: 'markdown',
          category: deriveCategory(file.relativePath),
          content_hash: contentHash,
          git_commit: gitCommit,
          chunk_index: chunks[i].chunkIndex,
          title: chunks[i].title,
          section: chunks[i].section,
          content: chunks[i].content,
        },
      });
    }
  }

  if (points.length > 0) {
    const vectorSize = points[0].vector.length;
    await ensureCollection(deps.qdrantClient, {
      url: deps.qdrantUrl,
      collectionName: deps.qdrantCollection,
      vectorSize,
    });
    await deleteProjectVectors(deps.qdrantClient, deps.qdrantCollection, project.id);
    await upsertChunks(deps.qdrantClient, deps.qdrantCollection, points);
  } else {
    const collections = await deps.qdrantClient.getCollections();
    const exists = collections.collections.some((c) => c.name === deps.qdrantCollection);
    if (exists) {
      await deleteProjectVectors(deps.qdrantClient, deps.qdrantCollection, project.id);
    }
  }

  return { filesIndexed: files.length, chunksIndexed: points.length };
}

function deriveCategory(relativePath: string): string {
  const match = /^docs\/([^/]+)\//.exec(relativePath);
  return match ? match[1] : 'other';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/ingestion/indexer.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/ingestion/indexer.ts tests/ingestion/indexer.test.ts
git commit -m "feat: add full-rebuild ingestion indexer orchestrator"
```

---

### Task 4: CLI Argument Parsing

**Files:**
- Create: `src/cli/args.ts`
- Test: `tests/cli/args.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `type ParsedArgs = { command: 'ingest'; projectId: string } | { command: 'unknown' }` and `function parseArgs(argv: string[]): ParsedArgs` — consumed by Task 5's `src/cli/index.ts`.

- [ ] **Step 1: Write the failing test**

`tests/cli/args.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { parseArgs } from '../../src/cli/args';

describe('parseArgs', () => {
  it('parses an ingest command with a project id', () => {
    expect(parseArgs(['ingest', 'bidubadu'])).toEqual({ command: 'ingest', projectId: 'bidubadu' });
  });

  it('returns unknown for an unrecognized command', () => {
    expect(parseArgs(['bogus'])).toEqual({ command: 'unknown' });
  });

  it('returns unknown when ingest is missing a project id', () => {
    expect(parseArgs(['ingest'])).toEqual({ command: 'unknown' });
  });

  it('returns unknown for empty argv', () => {
    expect(parseArgs([])).toEqual({ command: 'unknown' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/cli/args.test.ts`
Expected: FAIL with "Cannot find module '../../src/cli/args'".

- [ ] **Step 3: Write minimal implementation**

`src/cli/args.ts`:

```typescript
export type ParsedArgs = { command: 'ingest'; projectId: string } | { command: 'unknown' };

export function parseArgs(argv: string[]): ParsedArgs {
  const [command, projectId] = argv;
  if (command === 'ingest' && projectId) {
    return { command: 'ingest', projectId };
  }
  return { command: 'unknown' };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/cli/args.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/cli/args.ts tests/cli/args.test.ts
git commit -m "feat: add CLI argument parsing"
```

---

### Task 5: CLI Ingest Command + Entrypoint Wiring

**Files:**
- Create: `src/cli/ingest-command.ts`
- Test: `tests/cli/ingest-command.test.ts`
- Create: `src/cli/index.ts` (thin process wiring — no dedicated unit test; verified manually in Step 6)
- Modify: `package.json` (add `"bin"` field)

**Interfaces:**
- Consumes: `ProjectRegistry`/`ProjectConfig` (Phase 1), `IndexProjectResult` (Task 3), `parseArgs`/`ParsedArgs` (Task 4), `loadConfig` (Phase 1), `createQdrantClient` (Phase 1), `createEmbeddingProvider` (Phase 1), `indexProject` (Task 3)
- Produces: `interface RunIngestDeps { registry: ProjectRegistry; index: (project: ProjectConfig) => Promise<IndexProjectResult> }`, `interface RunIngestResult extends IndexProjectResult { projectName: string }`, and `function runIngestCommand(projectId: string, deps: RunIngestDeps): Promise<RunIngestResult>` — this is the first real CLI command, run via `node dist/cli/index.js ingest <project>` (or `project-rag ingest <project>` once linked globally).

- [ ] **Step 1: Write the failing test**

`tests/cli/ingest-command.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { runIngestCommand } from '../../src/cli/ingest-command';

describe('runIngestCommand', () => {
  it('indexes a registered project and returns a combined result', async () => {
    const registry = {
      find: vi.fn().mockReturnValue({ id: 'sample', name: 'Sample', repository: '/r', paths: ['docs'] }),
    } as any;
    const index = vi.fn().mockResolvedValue({ filesIndexed: 3, chunksIndexed: 9 });

    const result = await runIngestCommand('sample', { registry, index });

    expect(result).toEqual({ filesIndexed: 3, chunksIndexed: 9, projectName: 'Sample' });
    expect(index).toHaveBeenCalledWith({ id: 'sample', name: 'Sample', repository: '/r', paths: ['docs'] });
  });

  it('throws a clear error for an unregistered project', async () => {
    const registry = { find: vi.fn().mockReturnValue(undefined) } as any;
    const index = vi.fn();

    await expect(runIngestCommand('missing', { registry, index })).rejects.toThrow('is not registered');
    expect(index).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/cli/ingest-command.test.ts`
Expected: FAIL with "Cannot find module '../../src/cli/ingest-command'".

- [ ] **Step 3: Write minimal implementation**

`src/cli/ingest-command.ts`:

```typescript
import type { ProjectRegistry } from '../projects/project-registry';
import type { ProjectConfig } from '../projects/project-types';
import type { IndexProjectResult } from '../ingestion/indexer';

export interface RunIngestDeps {
  registry: ProjectRegistry;
  index: (project: ProjectConfig) => Promise<IndexProjectResult>;
}

export interface RunIngestResult extends IndexProjectResult {
  projectName: string;
}

export async function runIngestCommand(
  projectId: string,
  deps: RunIngestDeps,
): Promise<RunIngestResult> {
  const project = deps.registry.find(projectId);
  if (!project) {
    throw new Error(`Project "${projectId}" is not registered`);
  }
  const result = await deps.index(project);
  return { ...result, projectName: project.name };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/cli/ingest-command.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Write the CLI entrypoint (no TDD — thin process wiring, verified manually in Step 6)**

`src/cli/index.ts`:

```typescript
#!/usr/bin/env node
import { loadConfig } from '../config/config';
import { ProjectRegistry } from '../projects/project-registry';
import { createQdrantClient } from '../qdrant/qdrant-client';
import { createEmbeddingProvider } from '../embedding/embedding-provider';
import { indexProject } from '../ingestion/indexer';
import { parseArgs } from './args';
import { runIngestCommand } from './ingest-command';

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.command !== 'ingest') {
    console.error('Usage: project-rag ingest <project>');
    process.exitCode = 1;
    return;
  }

  const config = loadConfig();
  const registry = new ProjectRegistry(config.projectRegistryPath);
  const qdrantClient = createQdrantClient(config.qdrantUrl);
  const embeddingProvider = createEmbeddingProvider({
    provider: config.embeddingProvider,
    baseUrl: config.embeddingBaseUrl,
    model: config.embeddingModel,
    apiKey: config.embeddingApiKey,
  });

  const start = Date.now();
  const result = await runIngestCommand(parsed.projectId, {
    registry,
    index: (project) =>
      indexProject(project, {
        qdrantClient,
        qdrantUrl: config.qdrantUrl,
        qdrantCollection: config.qdrantCollection,
        embeddingProvider,
      }),
  });
  const durationSeconds = ((Date.now() - start) / 1000).toFixed(1);

  console.log(`Project: ${result.projectName}\n`);
  console.log('Indexed:');
  console.log(`  ${result.filesIndexed} files`);
  console.log(`  ${result.chunksIndexed} chunks\n`);
  console.log(`Ingest completed in ${durationSeconds}s`);
}

main().catch((error) => {
  console.error(`[project-rag] Error: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
```

- [ ] **Step 6: Add the `bin` field and manually verify the entrypoint**

In `package.json`, add a `"bin"` field next to `"main"`:

```json
"bin": {
  "project-rag": "dist/cli/index.js"
}
```

Build and manually verify the error path (no live Qdrant/embedding server needed — registry lookup fails before any network call):

```bash
npm run build
QDRANT_URL=http://localhost:6333 EMBEDDING_PROVIDER=ollama EMBEDDING_MODEL=bge-m3 PROJECT_REGISTRY_PATH=./config/projects.json node dist/cli/index.js ingest nonexistent-project-id
```

Expected: prints `[project-rag] Error: Project "nonexistent-project-id" is not registered` and exits with a non-zero code. (`config/projects.json` won't exist yet in this repo — that's fine, `ProjectRegistry.list()`/`find()` treat a missing registry file as an empty project list, per Phase 1's `project-registry.ts`.)

- [ ] **Step 7: Run the full suite and typecheck**

Run: `npm run typecheck && npm test`
Expected: all Phase 1 + Phase 2 tests pass, no type errors.

- [ ] **Step 8: Commit**

```bash
git add src/cli/ingest-command.ts tests/cli/ingest-command.test.ts src/cli/index.ts package.json
git commit -m "feat: add CLI ingest command and entrypoint"
```

---

### Task 6: Update Feature Docs to Reflect Phase 2

**Files:**
- Modify: `docs/features/02-ingestion-full-index.md`
- Modify: `docs/features/README.md`

**Interfaces:**
- Consumes: nothing new — documentation only, per the `project-rag-feature-flow` skill's step 5 (docs updates are part of feature work, not follow-up).

- [ ] **Step 1: Update `docs/features/02-ingestion-full-index.md`**

Change `**Status: Planned**` to `**Status: Implemented**`. Update the "Related Files" section to list the real paths: `src/ingestion/indexer.ts`, `src/git/git-status.ts`, `src/qdrant/qdrant-repository.ts`, `src/cli/{args,ingest-command,index}.ts` (Phase 2), plus the Phase 1 building blocks (`src/ingestion/{scanner,hasher,parser,chunker}.ts`). Remove/replace the "Phase 1 scope" note added earlier now that the full pipeline exists — keep a short line noting that hash-based skip/incremental behavior is still Phase 3 (not yet implemented), so a reader doesn't assume `project-rag ingest` is incremental.

- [ ] **Step 2: Update `docs/features/README.md`**

Replace the `**Updated**:` line with today's date and replace the `**Recent**:` line with: "Phase 2 (Full Ingestion) implemented: git commit metadata, Qdrant repository layer, ingestion indexer, and the first real CLI command (`project-rag ingest <project>`) — see `docs/superpowers/plans/2026-08-08-phase2-full-ingestion.md`." Update entry #2's index line from "— Planned" to "— Implemented".

- [ ] **Step 3: Commit**

```bash
git add docs/features/02-ingestion-full-index.md docs/features/README.md
git commit -m "docs: mark Phase 2 features implemented"
```
