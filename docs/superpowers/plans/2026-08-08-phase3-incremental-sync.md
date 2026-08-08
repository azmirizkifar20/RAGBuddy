# Phase 3 — Incremental Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement `project-rag sync <project>` per `init.md` §10 and §26 Phase 3 — detect added/modified/deleted/unchanged files by comparing content hashes against what's already indexed in Qdrant (no separate local state store needed, since `content_hash`/`file` have been stored in every point's payload since Phase 2), and only re-embed what changed.

**Architecture:** Two new Qdrant repository functions (`getIndexedFileHashes` — paginated `scroll()` grouped by `file`, and `deleteFileVectors` — delete scoped to `project` AND `file`), a new `src/ingestion/sync.ts` orchestrator (parallel to Phase 2's `indexer.ts`, sharing its point-payload logic via a small extracted `src/ingestion/payload-builder.ts`), and a second CLI command (`sync-command.ts`) wired alongside `ingest` in `src/cli/index.ts`. Verified against the real `@qdrant/js-client-rest` API via Context7 docs before writing this plan (`scroll`'s `{points, next_page_offset}` shape, `delete`'s multi-condition `filter.must` array) — this plan's Qdrant calls are not guessed.

**Tech Stack:** Same as Phase 1/2 (Node.js 24, TypeScript, Vitest, `@qdrant/js-client-rest`) — no new dependencies.

## Global Constraints

- **Never re-embed an unchanged file.** Compare `hashContent(content)` against the hash already stored in Qdrant for that `file`; skip embedding entirely when equal (`init.md` §10).
- **Deleted files must have their vectors removed.** A file present in Qdrant's existing index but absent from the current scan is `deleted`; its vectors must be deleted, not left stale (`init.md` §10).
- **Delete-before-upsert per file, not per project.** Unlike Phase 2's full-rebuild (`deleteProjectVectors`, whole-project scope), sync must only touch vectors for the SPECIFIC file that changed (`deleteFileVectors`, `project` AND `file` scoped) — deleting a modified file's old vectors must happen before its new chunks are upserted, and it must never touch other files' vectors in the same project.
- **Mock Qdrant and the embedding provider in tests** — no live Qdrant/embedding server required (`init.md` §23). Scanning, hashing, chunking, and git commands run for real against temp fixtures (same precedent as Phase 1/2).
- **No new runtime dependencies** (`init.md` §3, §27).
- **DRY the payload-building logic Phase 2 already wrote** — `deriveCategory` and the `${title}\n${section}\n${content}` embed-text composition are needed identically by both `indexer.ts` (full rebuild) and `sync.ts` (incremental) now; extract them once into `src/ingestion/payload-builder.ts` rather than duplicating, and refactor `indexer.ts` to use the extracted versions.
- **Output format must match `init.md` §10's example** exactly: `Project:`, then `Added:`/`Modified:`/`Deleted:`/`Skipped:` sections (only for non-empty lists), then a `Summary:` block with `Added:`/`Modified:`/`Deleted:`/`Unchanged:` counts.

---

### Task 1: Qdrant Repository — Read Existing Hashes & Delete Per-File

**Files:**
- Modify: `src/qdrant/qdrant-repository.ts` (add two functions; existing `upsertChunks`/`deleteProjectVectors`/`ChunkPayload`/`DocumentPoint` untouched)
- Modify: `tests/qdrant/qdrant-repository.test.ts` (add tests for the two new functions; existing tests untouched)

**Interfaces:**
- Consumes: `QdrantClient` type from `@qdrant/js-client-rest` (already a dependency)
- Produces: `function getIndexedFileHashes(client: QdrantClient, collectionName: string, project: string): Promise<Map<string, string>>` and `function deleteFileVectors(client: QdrantClient, collectionName: string, project: string, file: string): Promise<void>` — both consumed by Task 3's sync orchestrator.

- [ ] **Step 1: Write the failing tests**

Add to `tests/qdrant/qdrant-repository.test.ts` (append after the existing `describe` blocks — do not remove or modify the existing `upsertChunks`/`deleteProjectVectors` tests):

```typescript
describe('getIndexedFileHashes', () => {
  it('builds a file→hash map from existing points, paginating until exhausted', async () => {
    const client = {
      scroll: vi
        .fn()
        .mockResolvedValueOnce({
          points: [{ id: 'a', payload: { file: 'docs/a.md', content_hash: 'hash-a' } }],
          next_page_offset: 'page2',
        })
        .mockResolvedValueOnce({
          points: [{ id: 'b', payload: { file: 'docs/b.md', content_hash: 'hash-b' } }],
          next_page_offset: null,
        }),
    } as any;

    const result = await getIndexedFileHashes(client, 'docs', 'sample');

    expect(result).toEqual(
      new Map([
        ['docs/a.md', 'hash-a'],
        ['docs/b.md', 'hash-b'],
      ]),
    );
    expect(client.scroll).toHaveBeenCalledTimes(2);
    expect(client.scroll).toHaveBeenNthCalledWith(
      1,
      'docs',
      expect.objectContaining({
        filter: { must: [{ key: 'project', match: { value: 'sample' } }] },
        offset: undefined,
      }),
    );
    expect(client.scroll).toHaveBeenNthCalledWith(2, 'docs', expect.objectContaining({ offset: 'page2' }));
  });

  it('returns an empty map when there are no points', async () => {
    const client = { scroll: vi.fn().mockResolvedValue({ points: [], next_page_offset: null }) } as any;
    const result = await getIndexedFileHashes(client, 'docs', 'sample');
    expect(result.size).toBe(0);
  });
});

describe('deleteFileVectors', () => {
  it('deletes points filtered by project and file', async () => {
    const client = { delete: vi.fn().mockResolvedValue(true) } as any;
    await deleteFileVectors(client, 'docs', 'sample', 'docs/a.md');
    expect(client.delete).toHaveBeenCalledWith('docs', {
      filter: {
        must: [
          { key: 'project', match: { value: 'sample' } },
          { key: 'file', match: { value: 'docs/a.md' } },
        ],
      },
    });
  });
});
```

Also update the import line at the top of the test file to include the two new functions:

```typescript
import { upsertChunks, deleteProjectVectors, getIndexedFileHashes, deleteFileVectors } from '../../src/qdrant/qdrant-repository';
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/qdrant/qdrant-repository.test.ts`
Expected: FAIL — `getIndexedFileHashes`/`deleteFileVectors` are not exported yet.

- [ ] **Step 3: Add the implementation**

Add to `src/qdrant/qdrant-repository.ts` (append after the existing `deleteProjectVectors` function — do not modify anything above it):

```typescript
export async function getIndexedFileHashes(
  client: QdrantClient,
  collectionName: string,
  project: string,
): Promise<Map<string, string>> {
  const hashes = new Map<string, string>();
  let offset: string | number | null | undefined;
  do {
    const result = await client.scroll(collectionName, {
      filter: { must: [{ key: 'project', match: { value: project } }] },
      with_payload: true,
      with_vector: false,
      limit: 200,
      offset,
    });
    for (const point of result.points) {
      const payload = point.payload as { file?: string; content_hash?: string } | null | undefined;
      if (payload?.file && payload?.content_hash) {
        hashes.set(payload.file, payload.content_hash);
      }
    }
    offset = result.next_page_offset ?? undefined;
  } while (offset !== undefined && offset !== null);
  return hashes;
}

export async function deleteFileVectors(
  client: QdrantClient,
  collectionName: string,
  project: string,
  file: string,
): Promise<void> {
  await client.delete(collectionName, {
    filter: {
      must: [
        { key: 'project', match: { value: project } },
        { key: 'file', match: { value: file } },
      ],
    },
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/qdrant/qdrant-repository.test.ts`
Expected: PASS (5 tests total: 3 existing + 2 new describe blocks with 3 new test cases — 6 total, verify the exact count in your output).

- [ ] **Step 5: Run the full suite and typecheck for real**

Run: `npm run typecheck && npm test`
Expected: clean typecheck, all tests passing. Actually run these commands and paste the real output in your report — do not just assert success (a prior task in this project had an implementer wrongly claim a clean typecheck when it wasn't).

- [ ] **Step 6: Commit**

```bash
git add src/qdrant/qdrant-repository.ts tests/qdrant/qdrant-repository.test.ts
git commit -m "feat: add per-file hash lookup and per-file vector deletion to qdrant repository"
```

---

### Task 2: Extract Shared Payload-Building Helpers (DRY refactor)

**Files:**
- Create: `src/ingestion/payload-builder.ts`
- Test: `tests/ingestion/payload-builder.test.ts`
- Modify: `src/ingestion/indexer.ts` (remove local `deriveCategory`, use the extracted helpers)

**Interfaces:**
- Consumes: `Chunk` type from `src/ingestion/chunker.ts` (Phase 1)
- Produces: `function deriveCategory(relativePath: string, paths: string[]): string` and `function composeEmbedText(chunk: Chunk): string` — consumed by both `src/ingestion/indexer.ts` (Phase 2, refactored here) and Task 3's `src/ingestion/sync.ts`.

- [ ] **Step 1: Write the failing test**

`tests/ingestion/payload-builder.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { deriveCategory, composeEmbedText } from '../../src/ingestion/payload-builder';

describe('deriveCategory', () => {
  it('derives the category from the matching configured path segment', () => {
    expect(deriveCategory('docs/features/01-auth.md', ['docs'])).toBe('features');
  });

  it('derives the category for a non-default configured path', () => {
    expect(deriveCategory('knowledge-base/faq/01.md', ['knowledge-base'])).toBe('faq');
  });

  it('falls back to "other" when no configured path matches', () => {
    expect(deriveCategory('README.md', ['docs'])).toBe('other');
  });

  it('falls back to "root" when the file sits directly in the configured path', () => {
    expect(deriveCategory('docs/README.md', ['docs'])).toBe('root');
  });
});

describe('composeEmbedText', () => {
  it('joins title, section, and content with newlines', () => {
    const text = composeEmbedText({ title: 'Doc', section: 'Intro', content: 'Body text.', chunkIndex: 0 });
    expect(text).toBe('Doc\nIntro\nBody text.');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/ingestion/payload-builder.test.ts`
Expected: FAIL with "Cannot find module '../../src/ingestion/payload-builder'".

- [ ] **Step 3: Write the implementation**

`src/ingestion/payload-builder.ts`:

```typescript
import type { Chunk } from './chunker';

export function deriveCategory(relativePath: string, paths: string[]): string {
  for (const configuredPath of paths) {
    const prefix = configuredPath.endsWith('/') ? configuredPath : `${configuredPath}/`;
    if (relativePath.startsWith(prefix)) {
      const rest = relativePath.slice(prefix.length);
      const segment = rest.split('/')[0];
      return segment || 'root';
    }
  }
  return 'other';
}

export function composeEmbedText(chunk: Chunk): string {
  return `${chunk.title}\n${chunk.section}\n${chunk.content}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/ingestion/payload-builder.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Refactor `src/ingestion/indexer.ts` to use the extracted helpers**

Read the current file first, then apply these exact edits:

1. Add a new import line after the existing `import { upsertChunks, deleteProjectVectors, type DocumentPoint } from '../qdrant/qdrant-repository';` line:

```typescript
import { deriveCategory, composeEmbedText } from './payload-builder';
```

2. Replace this line:

```typescript
    const texts = chunks.map((chunk) => `${chunk.title}\n${chunk.section}\n${chunk.content}`);
```

with:

```typescript
    const texts = chunks.map(composeEmbedText);
```

3. Delete the local `deriveCategory` function entirely from the bottom of the file (it now lives in `payload-builder.ts`):

```typescript
function deriveCategory(relativePath: string, paths: string[]): string {
  for (const configuredPath of paths) {
    const prefix = configuredPath.endsWith('/') ? configuredPath : `${configuredPath}/`;
    if (relativePath.startsWith(prefix)) {
      const rest = relativePath.slice(prefix.length);
      const segment = rest.split('/')[0];
      return segment || 'root';
    }
  }
  return 'other';
}
```

The call site `category: deriveCategory(file.relativePath, project.paths)` inside the payload object stays exactly as-is — it now resolves to the imported function instead of the local one, with identical behavior.

Do NOT change anything else in `indexer.ts` — the `IndexProjectDeps`/`IndexProjectResult` interfaces, the `ponytail:` comment, the delete-then-upsert order, and all `log(...)` calls stay untouched.

- [ ] **Step 6: Run the full suite and typecheck for real**

Run: `npm run typecheck && npm test`
Expected: clean typecheck; `tests/ingestion/indexer.test.ts`'s existing 3 tests must still pass unchanged (this refactor must not change `indexProject`'s observable behavior at all). Paste the real output in your report.

- [ ] **Step 7: Commit**

```bash
git add src/ingestion/payload-builder.ts tests/ingestion/payload-builder.test.ts src/ingestion/indexer.ts
git commit -m "refactor: extract shared payload-building helpers (deriveCategory, composeEmbedText)"
```

---

### Task 3: Incremental Sync Orchestrator

**Files:**
- Create: `src/ingestion/sync.ts`
- Test: `tests/ingestion/sync.test.ts`

**Interfaces:**
- Consumes: `scanDocuments` (Phase 1 `src/ingestion/scanner.ts`), `hashContent` (Phase 1 `src/ingestion/hasher.ts`), `chunkMarkdown` (Phase 1 `src/ingestion/chunker.ts`), `EmbeddingProvider` (Phase 1 `src/embedding/embedding-provider.ts`), `getCurrentCommit` (Phase 2 `src/git/git-status.ts`), `ensureCollection` (Phase 1 `src/qdrant/qdrant-client.ts`), `upsertChunks`/`DocumentPoint` (Phase 2 `src/qdrant/qdrant-repository.ts`), `getIndexedFileHashes`/`deleteFileVectors` (Task 1), `deriveCategory`/`composeEmbedText` (Task 2), `ProjectConfig` (Phase 1 `src/projects/project-types.ts`)
- Produces: `interface SyncProjectDeps { qdrantClient: QdrantClient; qdrantUrl: string; qdrantCollection: string; embeddingProvider: EmbeddingProvider; onLog?: (message: string) => void }`, `interface SyncResult { added: string[]; modified: string[]; deleted: string[]; unchanged: string[] }`, and `function syncProject(project: ProjectConfig, deps: SyncProjectDeps): Promise<SyncResult>` — consumed by Task 4's CLI sync command.

- [ ] **Step 1: Write the failing test**

`tests/ingestion/sync.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { hashContent } from '../../src/ingestion/hasher';
import { syncProject } from '../../src/ingestion/sync';

describe('syncProject', () => {
  let dir: string;
  const unchangedContent = '# Unchanged\n\nSame content.\n';
  const modifiedContent = '# Modified\n\nNew content.\n';
  const addedContent = '# Added\n\nAdded content.\n';

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'project-rag-sync-'));
    execFileSync('git', ['init', '-b', 'main'], { cwd: dir });
    execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: dir });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
    mkdirSync(path.join(dir, 'docs'), { recursive: true });
    writeFileSync(path.join(dir, 'docs', 'unchanged.md'), unchangedContent);
    writeFileSync(path.join(dir, 'docs', 'modified.md'), modifiedContent);
    writeFileSync(path.join(dir, 'docs', 'added.md'), addedContent);
    execFileSync('git', ['add', '.'], { cwd: dir });
    execFileSync('git', ['commit', '-m', 'init'], { cwd: dir });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('classifies added, modified, deleted, and unchanged files, and only re-embeds what changed', async () => {
    const project = { id: 'sample', name: 'sample', repository: dir, paths: ['docs'] };
    const embeddingProvider = {
      embedDocuments: vi.fn().mockResolvedValue([[0.1, 0.2]]),
      embedQuery: vi.fn(),
    };
    const qdrantClient = {
      scroll: vi.fn().mockResolvedValue({
        points: [
          { id: '1', payload: { file: 'docs/unchanged.md', content_hash: hashContent(unchangedContent) } },
          { id: '2', payload: { file: 'docs/modified.md', content_hash: 'stale-hash' } },
          { id: '3', payload: { file: 'docs/deleted.md', content_hash: 'whatever' } },
        ],
        next_page_offset: null,
      }),
      getCollections: vi.fn().mockResolvedValue({ collections: [] }),
      createCollection: vi.fn().mockResolvedValue(true),
      delete: vi.fn().mockResolvedValue(true),
      upsert: vi.fn().mockResolvedValue(true),
    } as any;

    const result = await syncProject(project, {
      qdrantClient,
      qdrantUrl: 'http://localhost:6333',
      qdrantCollection: 'project_rag_documents',
      embeddingProvider: embeddingProvider as any,
    });

    expect(result).toEqual({
      added: ['docs/added.md'],
      modified: ['docs/modified.md'],
      deleted: ['docs/deleted.md'],
      unchanged: ['docs/unchanged.md'],
    });

    expect(embeddingProvider.embedDocuments).toHaveBeenCalledTimes(2);

    const deleteCalls = qdrantClient.delete.mock.calls.map((call: any[]) => call[1].filter.must[1].match.value);
    expect(deleteCalls.sort()).toEqual(['docs/deleted.md', 'docs/modified.md']);

    expect(qdrantClient.upsert).toHaveBeenCalledTimes(1);
    const upsertedFiles = qdrantClient.upsert.mock.calls[0][1].points.map((p: any) => p.payload.file);
    expect(upsertedFiles.sort()).toEqual(['docs/added.md', 'docs/modified.md']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/ingestion/sync.test.ts`
Expected: FAIL with "Cannot find module '../../src/ingestion/sync'".

- [ ] **Step 3: Write minimal implementation**

`src/ingestion/sync.ts`:

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
import {
  upsertChunks,
  deleteFileVectors,
  getIndexedFileHashes,
  type DocumentPoint,
} from '../qdrant/qdrant-repository';
import { deriveCategory, composeEmbedText } from './payload-builder';

export interface SyncProjectDeps {
  qdrantClient: QdrantClient;
  qdrantUrl: string;
  qdrantCollection: string;
  embeddingProvider: EmbeddingProvider;
  onLog?: (message: string) => void;
}

export interface SyncResult {
  added: string[];
  modified: string[];
  deleted: string[];
  unchanged: string[];
}

export async function syncProject(
  project: ProjectConfig,
  deps: SyncProjectDeps,
): Promise<SyncResult> {
  const log = deps.onLog ?? (() => {});
  const files = scanDocuments(project.repository, project.paths);
  const currentPaths = new Set(files.map((f) => f.relativePath));
  const existingHashes = await getIndexedFileHashes(deps.qdrantClient, deps.qdrantCollection, project.id);
  const gitCommit = getCurrentCommit(project.repository);

  const added: string[] = [];
  const modified: string[] = [];
  const unchanged: string[] = [];
  const deleted = [...existingHashes.keys()].filter((file) => !currentPaths.has(file));
  const points: DocumentPoint[] = [];

  for (const file of files) {
    const content = readFileSync(file.absolutePath, 'utf8');
    const contentHash = hashContent(content);
    const existingHash = existingHashes.get(file.relativePath);

    if (existingHash === contentHash) {
      unchanged.push(file.relativePath);
      continue;
    }

    if (existingHash === undefined) {
      added.push(file.relativePath);
    } else {
      modified.push(file.relativePath);
      log(`Removing old vectors for ${file.relativePath}`);
      await deleteFileVectors(deps.qdrantClient, deps.qdrantCollection, project.id, file.relativePath);
    }

    const chunks = chunkMarkdown(content);
    if (chunks.length === 0) continue;

    const texts = chunks.map(composeEmbedText);
    log(`Embedding ${file.relativePath} (${chunks.length} chunk(s))`);
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
          category: deriveCategory(file.relativePath, project.paths),
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

  for (const file of deleted) {
    log(`Removing vectors for deleted file ${file}`);
    await deleteFileVectors(deps.qdrantClient, deps.qdrantCollection, project.id, file);
  }

  if (points.length > 0) {
    const vectorSize = points[0].vector.length;
    await ensureCollection(deps.qdrantClient, {
      url: deps.qdrantUrl,
      collectionName: deps.qdrantCollection,
      vectorSize,
    });
    await upsertChunks(deps.qdrantClient, deps.qdrantCollection, points);
    log(`Upserted ${points.length} chunk(s) to Qdrant`);
  }

  return { added, modified, deleted, unchanged };
}
```

Note the ordering is deliberate and safe: any per-file delete (for a modified or deleted file) always runs BEFORE the single batched `upsertChunks` call at the end — never after — so a file's old vectors are never deleted after its own new vectors have already landed (which would risk the same "delete wipes what you just inserted" trap as Phase 2's project-wide delete, if the order were reversed).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/ingestion/sync.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Run the full suite and typecheck for real**

Run: `npm run typecheck && npm test`
Expected: clean typecheck, all tests passing. Paste the real output.

- [ ] **Step 6: Commit**

```bash
git add src/ingestion/sync.ts tests/ingestion/sync.test.ts
git commit -m "feat: add incremental sync orchestrator"
```

---

### Task 4: CLI Sync Command + Dual Dispatch

**Files:**
- Modify: `src/cli/args.ts` (support `sync` alongside `ingest`)
- Modify: `tests/cli/args.test.ts` (add sync cases)
- Create: `src/cli/sync-command.ts`
- Test: `tests/cli/sync-command.test.ts`
- Modify: `src/cli/index.ts` (dispatch to `ingest` or `sync`, print the sync summary format from `init.md` §10)

**Interfaces:**
- Consumes: `ProjectRegistry`/`ProjectConfig` (Phase 1), `SyncResult` (Task 3), `syncProject` (Task 3)
- Produces: updated `ParsedArgs` union including `{ command: 'sync'; projectId: string }`, `interface RunSyncDeps { registry: ProjectRegistry; sync: (project: ProjectConfig) => Promise<SyncResult> }`, `interface RunSyncResult extends SyncResult { projectName: string }`, and `function runSyncCommand(projectId: string, deps: RunSyncDeps): Promise<RunSyncResult>`.

- [ ] **Step 1: Write the failing tests for `args.ts`**

Read the current `tests/cli/args.test.ts` first, then add these two cases inside the existing `describe('parseArgs', ...)` block (do not remove the existing 4 cases):

```typescript
  it('parses a sync command with a project id', () => {
    expect(parseArgs(['sync', 'bidubadu'])).toEqual({ command: 'sync', projectId: 'bidubadu' });
  });

  it('returns unknown when sync is missing a project id', () => {
    expect(parseArgs(['sync'])).toEqual({ command: 'unknown' });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/cli/args.test.ts`
Expected: FAIL — `parseArgs(['sync', 'bidubadu'])` currently returns `{ command: 'unknown' }`, not `{ command: 'sync', projectId: 'bidubadu' }`.

- [ ] **Step 3: Update `src/cli/args.ts`**

Read the current file first, then replace its entire contents with:

```typescript
export type ParsedArgs =
  | { command: 'ingest'; projectId: string }
  | { command: 'sync'; projectId: string }
  | { command: 'unknown' };

export function parseArgs(argv: string[]): ParsedArgs {
  const [command, projectId] = argv;
  if ((command === 'ingest' || command === 'sync') && projectId) {
    return { command, projectId };
  }
  return { command: 'unknown' };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/cli/args.test.ts`
Expected: PASS (6 tests: 4 existing + 2 new).

- [ ] **Step 5: Write the failing test for `sync-command.ts`**

`tests/cli/sync-command.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { runSyncCommand } from '../../src/cli/sync-command';

describe('runSyncCommand', () => {
  it('syncs a registered project and returns a combined result', async () => {
    const registry = {
      find: vi.fn().mockReturnValue({ id: 'sample', name: 'Sample', repository: '/r', paths: ['docs'] }),
    } as any;
    const sync = vi.fn().mockResolvedValue({
      added: ['a.md'],
      modified: [],
      deleted: [],
      unchanged: ['b.md'],
    });

    const result = await runSyncCommand('sample', { registry, sync });

    expect(result).toEqual({
      added: ['a.md'],
      modified: [],
      deleted: [],
      unchanged: ['b.md'],
      projectName: 'Sample',
    });
    expect(sync).toHaveBeenCalledWith({ id: 'sample', name: 'Sample', repository: '/r', paths: ['docs'] });
  });

  it('throws a clear error for an unregistered project', async () => {
    const registry = { find: vi.fn().mockReturnValue(undefined) } as any;
    const sync = vi.fn();

    await expect(runSyncCommand('missing', { registry, sync })).rejects.toThrow('is not registered');
    expect(sync).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx vitest run tests/cli/sync-command.test.ts`
Expected: FAIL with "Cannot find module '../../src/cli/sync-command'".

- [ ] **Step 7: Write minimal implementation**

`src/cli/sync-command.ts`:

```typescript
import type { ProjectRegistry } from '../projects/project-registry';
import type { ProjectConfig } from '../projects/project-types';
import type { SyncResult } from '../ingestion/sync';

export interface RunSyncDeps {
  registry: ProjectRegistry;
  sync: (project: ProjectConfig) => Promise<SyncResult>;
}

export interface RunSyncResult extends SyncResult {
  projectName: string;
}

export async function runSyncCommand(
  projectId: string,
  deps: RunSyncDeps,
): Promise<RunSyncResult> {
  const project = deps.registry.find(projectId);
  if (!project) {
    throw new Error(`Project "${projectId}" is not registered`);
  }
  const result = await deps.sync(project);
  return { ...result, projectName: project.name };
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npx vitest run tests/cli/sync-command.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 9: Update `src/cli/index.ts` to dispatch both commands (no TDD — thin process wiring, verified manually in Step 10)**

Read the current file first, then replace its entire contents with:

```typescript
#!/usr/bin/env node
import { loadConfig } from '../config/config';
import { ProjectRegistry } from '../projects/project-registry';
import { createQdrantClient } from '../qdrant/qdrant-client';
import { createEmbeddingProvider } from '../embedding/embedding-provider';
import { indexProject } from '../ingestion/indexer';
import { syncProject } from '../ingestion/sync';
import { parseArgs } from './args';
import { runIngestCommand } from './ingest-command';
import { runSyncCommand } from './sync-command';

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.command !== 'ingest' && parsed.command !== 'sync') {
    console.error('Usage: project-rag <ingest|sync> <project>');
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
  const onLog = (message: string) => console.log(`[INFO] ${message}`);

  if (parsed.command === 'ingest') {
    const start = Date.now();
    const result = await runIngestCommand(parsed.projectId, {
      registry,
      index: (project) =>
        indexProject(project, {
          qdrantClient,
          qdrantUrl: config.qdrantUrl,
          qdrantCollection: config.qdrantCollection,
          embeddingProvider,
          onLog,
        }),
    });
    const durationSeconds = ((Date.now() - start) / 1000).toFixed(1);

    console.log(`Project: ${result.projectName}\n`);
    console.log('Indexed:');
    console.log(`  ${result.filesIndexed} files`);
    console.log(`  ${result.chunksIndexed} chunks\n`);
    console.log(`Ingest completed in ${durationSeconds}s`);
    return;
  }

  const start = Date.now();
  const result = await runSyncCommand(parsed.projectId, {
    registry,
    sync: (project) =>
      syncProject(project, {
        qdrantClient,
        qdrantUrl: config.qdrantUrl,
        qdrantCollection: config.qdrantCollection,
        embeddingProvider,
        onLog,
      }),
  });
  const durationSeconds = ((Date.now() - start) / 1000).toFixed(1);

  console.log(`Project: ${result.projectName}\n`);
  if (result.added.length > 0) {
    console.log('Added:');
    for (const file of result.added) console.log(`  ${file}`);
    console.log('');
  }
  if (result.modified.length > 0) {
    console.log('Modified:');
    for (const file of result.modified) console.log(`  ${file}`);
    console.log('');
  }
  if (result.deleted.length > 0) {
    console.log('Deleted:');
    for (const file of result.deleted) console.log(`  ${file}`);
    console.log('');
  }
  if (result.unchanged.length > 0) {
    console.log('Skipped:');
    for (const file of result.unchanged) console.log(`  ${file}`);
    console.log('');
  }
  console.log('Summary:');
  console.log(`  Added: ${result.added.length}`);
  console.log(`  Modified: ${result.modified.length}`);
  console.log(`  Deleted: ${result.deleted.length}`);
  console.log(`  Unchanged: ${result.unchanged.length}\n`);
  console.log(`Sync completed in ${durationSeconds}s`);
}

main().catch((error) => {
  console.error(`[project-rag] Error: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
```

- [ ] **Step 10: Build and manually verify both commands' error paths**

```bash
npm run build
QDRANT_URL=http://localhost:6333 EMBEDDING_PROVIDER=ollama EMBEDDING_MODEL=bge-m3 PROJECT_REGISTRY_PATH=./config/projects.json node dist/cli/index.js sync nonexistent-project-id
```

Expected: prints `[project-rag] Error: Project "nonexistent-project-id" is not registered` and exits with a non-zero code (a second, unrelated line from `@qdrant/js-client-rest`'s own async version-check warning may also print — that's pre-existing library behavior from Phase 2, not something to fix here). Also re-run the Phase 2 `ingest` manual check to confirm it still works: `node dist/cli/index.js ingest nonexistent-project-id` should behave identically to before.

- [ ] **Step 11: Run the full suite and typecheck for real**

Run: `npm run typecheck && npm test`
Expected: all tests passing, clean typecheck. Paste the real output.

- [ ] **Step 12: Commit**

```bash
git add src/cli/args.ts tests/cli/args.test.ts src/cli/sync-command.ts tests/cli/sync-command.test.ts src/cli/index.ts
git commit -m "feat: add CLI sync command and dual ingest/sync dispatch"
```

---

### Task 5: Update Feature Docs to Reflect Phase 3

**Files:**
- Modify: `docs/features/03-incremental-sync.md`
- Modify: `docs/features/README.md`

**Interfaces:**
- Consumes: nothing new — documentation only, per the `project-rag-feature-flow` skill's step 5.

- [ ] **Step 1: Update `docs/features/03-incremental-sync.md`**

Read the current file first. Change `**Status: Planned**` to `**Status: Implemented**`. Update the "Related Files" section to list: `src/ingestion/sync.ts`, `src/ingestion/payload-builder.ts`, `src/qdrant/qdrant-repository.ts` (extended with `getIndexedFileHashes`/`deleteFileVectors`), `src/cli/{args,sync-command,index}.ts`. Remove the old "Not yet implemented" framing.

- [ ] **Step 2: Update `docs/features/README.md`**

Replace the `**Updated**:` line with today's date and replace the `**Recent**:` line with: "Phase 3 (Incremental Sync) implemented: hash-based add/modify/delete detection reading Qdrant's own stored `content_hash`/`file` payload fields (no separate state store), per-file vector deletion, and `project-rag sync <project>` — see `docs/superpowers/plans/2026-08-08-phase3-incremental-sync.md`." Update entry #3's index line from "— Planned" to "— Implemented".

- [ ] **Step 3: Commit**

```bash
git add docs/features/03-incremental-sync.md docs/features/README.md
git commit -m "docs: mark Phase 3 features implemented"
```
