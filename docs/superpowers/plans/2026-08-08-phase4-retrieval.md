# Phase 4 — Retrieval Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement `project-rag search <project> "<query>"` per `init.md` §16 and §26 Phase 4 — embed the query, run a topK vector similarity search against Qdrant filtered by `project`, and return concise `file`/`section`/`score`/`content` results. Project isolation is enforced at the retrieval layer itself, never left to the caller.

**Architecture:** A new `searchPoints` function in the existing `src/qdrant/qdrant-repository.ts` (the storage layer — thin wrapper around `client.query()` with the `project` filter baked in, matching the file's existing role for `upsertChunks`/`deleteProjectVectors`/`deleteFileVectors`/`getIndexedFileHashes`), a new `src/retrieval/search.ts` (the business layer named in `docs/steering/architecture.md` — embeds the query, calls `searchPoints`, shapes the result), and a third CLI command (`search-command.ts`) wired into the existing `args.ts`/`index.ts` alongside `ingest`/`sync`. **Correction during Task 1 execution:** the plan originally cited `client.search()` per a Context7 doc lookup, but the actually-installed `@qdrant/js-client-rest` (v1.19.0, checked directly against `node_modules/@qdrant/js-client-rest/dist/types/qdrant-client.d.ts`) has removed `search()` in favor of the unified `client.query(collectionName, { query: vector, filter, limit, with_payload })`, which returns `Promise<{ points: ScoredPoint[] }>` (not a bare array) — Context7 was showing an older/different doc snapshot than what's installed. All code below already reflects the corrected `query()`/`{points}` shape, verified against the real `.d.ts` file, not guessed.

**Tech Stack:** Same as Phase 1-3 (Node.js 24, TypeScript, Vitest, `@qdrant/js-client-rest`) — no new dependencies.

## Global Constraints

- **Project filter is mandatory and enforced at the retrieval layer, never left to the caller/LLM** (`init.md` §16, §21.7) — every `searchPoints`/`searchProject` call must filter by `project`; there is no code path that searches without it.
- **`topK` defaults to 5, configurable** — already available as `AppConfig.ragTopK` (Phase 1 `src/config/config.ts`, reads `RAG_TOP_K` env var); this phase wires it through, doesn't reintroduce a new config knob.
- **Return concise metadata per result: `file`, `section`, `score`, `content`** (`init.md` §14, §16) — no huge context dumps; each result is already one bounded chunk (Phase 1's chunker caps chunk size), so no additional truncation is needed.
- **Keep it simple — no hybrid search, BM25, reranking, or per-project collections in this phase** (`init.md` §17 — those are explicitly future-proofing notes, not v1 requirements). Plain topK vector similarity only.
- **Mock Qdrant and the embedding provider in tests** — no live server required (`init.md` §23); the underlying `client.query()` call is the only mocked boundary, `searchPoints`/`searchProject` run for real in tests.
- **No new runtime dependencies** (`init.md` §3, §27).

---

### Task 1: Qdrant Repository — Search With Project Filter

**Files:**
- Modify: `src/qdrant/qdrant-repository.ts` (add one function; existing `ChunkPayload`/`DocumentPoint`/`upsertChunks`/`deleteProjectVectors`/`deleteFileVectors`/`getIndexedFileHashes` untouched)
- Modify: `tests/qdrant/qdrant-repository.test.ts` (add tests; existing tests untouched)

**Interfaces:**
- Consumes: `QdrantClient` type from `@qdrant/js-client-rest`, `ChunkPayload` (already defined in this file)
- Produces: `interface SearchHit { score: number; payload: ChunkPayload }` and `function searchPoints(client: QdrantClient, collectionName: string, project: string, vector: number[], limit: number): Promise<SearchHit[]>` — consumed by Task 2's `searchProject`.

- [ ] **Step 1: Write the failing test**

Add to `tests/qdrant/qdrant-repository.test.ts` (append after the existing `describe` blocks — do not remove or modify any existing test):

```typescript
describe('searchPoints', () => {
  it('searches with a project filter and maps score/payload', async () => {
    const client = {
      query: vi.fn().mockResolvedValue({
        points: [{ id: '1', score: 0.9, payload: { file: 'docs/a.md', section: 'Intro', content: 'hi' } }],
      }),
    } as any;

    const hits = await searchPoints(client, 'docs', 'sample', [0.1, 0.2], 5);

    expect(client.query).toHaveBeenCalledWith('docs', {
      query: [0.1, 0.2],
      limit: 5,
      filter: { must: [{ key: 'project', match: { value: 'sample' } }] },
      with_payload: true,
    });
    expect(hits).toEqual([{ score: 0.9, payload: { file: 'docs/a.md', section: 'Intro', content: 'hi' } }]);
  });

  it('never omits the project filter, even with an empty project string edge case', async () => {
    const client = { query: vi.fn().mockResolvedValue({ points: [] }) } as any;
    await searchPoints(client, 'docs', 'bidubadu', [0.1], 3);
    const callArgs = client.query.mock.calls[0][1];
    expect(callArgs.filter).toEqual({ must: [{ key: 'project', match: { value: 'bidubadu' } }] });
  });
});
```

Also update the import line at the top of the test file to include `searchPoints`:

```typescript
import {
  upsertChunks,
  deleteProjectVectors,
  getIndexedFileHashes,
  deleteFileVectors,
  searchPoints,
} from '../../src/qdrant/qdrant-repository';
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/qdrant/qdrant-repository.test.ts`
Expected: FAIL — `searchPoints` is not exported yet.

- [ ] **Step 3: Add the implementation**

Add to `src/qdrant/qdrant-repository.ts` (append after the existing `deleteFileVectors`/`getIndexedFileHashes` functions — do not modify anything above it):

```typescript
export interface SearchHit {
  score: number;
  payload: ChunkPayload;
}

export async function searchPoints(
  client: QdrantClient,
  collectionName: string,
  project: string,
  vector: number[],
  limit: number,
): Promise<SearchHit[]> {
  const response = await client.query(collectionName, {
    query: vector,
    limit,
    filter: { must: [{ key: 'project', match: { value: project } }] },
    with_payload: true,
  });
  return response.points.map((r) => ({
    score: r.score ?? 0,
    payload: r.payload as ChunkPayload,
  }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/qdrant/qdrant-repository.test.ts`
Expected: PASS (all existing tests + 2 new ones).

- [ ] **Step 5: Run the full suite and typecheck for real**

Run: `npm run typecheck && npm test`
Expected: clean typecheck, all tests passing. Actually run these commands and paste the real output — several earlier tasks in this project had implementers wrongly claim success without verifying, and at least three caught real bugs in this plan's own prescribed code by tracing it carefully. Don't assume this task's code is bug-free either — check it against the actual `@qdrant/js-client-rest` types if anything looks off.

- [ ] **Step 6: Commit**

```bash
git add src/qdrant/qdrant-repository.ts tests/qdrant/qdrant-repository.test.ts
git commit -m "feat: add project-filtered vector search to qdrant repository"
```

---

### Task 2: Retrieval Layer

**Files:**
- Create: `src/retrieval/search.ts`
- Test: `tests/retrieval/search.test.ts`

**Interfaces:**
- Consumes: `searchPoints`/`SearchHit` (Task 1), `EmbeddingProvider` (Phase 1 `src/embedding/embedding-provider.ts`), `QdrantClient` type
- Produces: `interface SearchResult { file: string; section: string; score: number; content: string }`, `interface SearchDeps { qdrantClient: QdrantClient; qdrantCollection: string; embeddingProvider: EmbeddingProvider; topK?: number }`, and `function searchProject(project: string, query: string, deps: SearchDeps): Promise<SearchResult[]>` — consumed by Task 3's CLI search command.

- [ ] **Step 1: Write the failing test**

`tests/retrieval/search.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { searchProject } from '../../src/retrieval/search';

describe('searchProject', () => {
  it('embeds the query, enforces the project filter, and maps results', async () => {
    const embeddingProvider = {
      embedQuery: vi.fn().mockResolvedValue([0.1, 0.2]),
      embedDocuments: vi.fn(),
    };
    const qdrantClient = {
      query: vi.fn().mockResolvedValue({
        points: [
          { id: '1', score: 0.9, payload: { file: 'docs/a.md', section: 'Intro', content: 'Hello world' } },
          { id: '2', score: 0.8, payload: { file: 'docs/b.md', section: 'Setup', content: 'Setup steps' } },
        ],
      }),
    } as any;

    const results = await searchProject('sample', 'hello', {
      qdrantClient,
      qdrantCollection: 'project_rag_documents',
      embeddingProvider: embeddingProvider as any,
    });

    expect(embeddingProvider.embedQuery).toHaveBeenCalledWith('hello');
    expect(qdrantClient.query).toHaveBeenCalledWith('project_rag_documents', {
      query: [0.1, 0.2],
      limit: 5,
      filter: { must: [{ key: 'project', match: { value: 'sample' } }] },
      with_payload: true,
    });
    expect(results).toEqual([
      { file: 'docs/a.md', section: 'Intro', score: 0.9, content: 'Hello world' },
      { file: 'docs/b.md', section: 'Setup', score: 0.8, content: 'Setup steps' },
    ]);
  });

  it('respects a configured topK instead of the default 5', async () => {
    const embeddingProvider = { embedQuery: vi.fn().mockResolvedValue([0.1]), embedDocuments: vi.fn() };
    const qdrantClient = { query: vi.fn().mockResolvedValue({ points: [] }) } as any;

    await searchProject('sample', 'hello', {
      qdrantClient,
      qdrantCollection: 'project_rag_documents',
      embeddingProvider: embeddingProvider as any,
      topK: 3,
    });

    expect(qdrantClient.query).toHaveBeenCalledWith(
      'project_rag_documents',
      expect.objectContaining({ limit: 3 }),
    );
  });

  it('returns an empty array when nothing matches', async () => {
    const embeddingProvider = { embedQuery: vi.fn().mockResolvedValue([0.1]), embedDocuments: vi.fn() };
    const qdrantClient = { query: vi.fn().mockResolvedValue({ points: [] }) } as any;

    const results = await searchProject('sample', 'nothing matches this', {
      qdrantClient,
      qdrantCollection: 'project_rag_documents',
      embeddingProvider: embeddingProvider as any,
    });

    expect(results).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/retrieval/search.test.ts`
Expected: FAIL with "Cannot find module '../../src/retrieval/search'".

- [ ] **Step 3: Write minimal implementation**

`src/retrieval/search.ts`:

```typescript
import type { QdrantClient } from '@qdrant/js-client-rest';
import type { EmbeddingProvider } from '../embedding/embedding-provider';
import { searchPoints } from '../qdrant/qdrant-repository';

export interface SearchResult {
  file: string;
  section: string;
  score: number;
  content: string;
}

export interface SearchDeps {
  qdrantClient: QdrantClient;
  qdrantCollection: string;
  embeddingProvider: EmbeddingProvider;
  topK?: number;
}

const DEFAULT_TOP_K = 5;

export async function searchProject(
  project: string,
  query: string,
  deps: SearchDeps,
): Promise<SearchResult[]> {
  const vector = await deps.embeddingProvider.embedQuery(query);
  const limit = deps.topK ?? DEFAULT_TOP_K;
  const hits = await searchPoints(deps.qdrantClient, deps.qdrantCollection, project, vector, limit);
  return hits.map((hit) => ({
    file: hit.payload.file,
    section: hit.payload.section,
    score: hit.score,
    content: hit.payload.content,
  }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/retrieval/search.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Run the full suite and typecheck for real**

Run: `npm run typecheck && npm test`
Expected: clean typecheck, all tests passing. Paste the real output.

- [ ] **Step 6: Commit**

```bash
git add src/retrieval/search.ts tests/retrieval/search.test.ts
git commit -m "feat: add project-scoped retrieval layer"
```

---

### Task 3: CLI Search Command + Triple Dispatch

**Files:**
- Modify: `src/cli/args.ts` (support `search <project> <query...>` alongside `ingest`/`sync`)
- Modify: `tests/cli/args.test.ts` (add search cases)
- Create: `src/cli/search-command.ts`
- Test: `tests/cli/search-command.test.ts`
- Modify: `src/cli/index.ts` (dispatch to `ingest`/`sync`/`search`, print search results)

**Interfaces:**
- Consumes: `ProjectRegistry`/`ProjectConfig` (Phase 1), `SearchResult`/`searchProject` (Task 2)
- Produces: updated `ParsedArgs` union including `{ command: 'search'; projectId: string; query: string }`, `interface RunSearchDeps { registry: ProjectRegistry; search: (project: ProjectConfig, query: string) => Promise<SearchResult[]> }`, `interface RunSearchResult { projectName: string; query: string; results: SearchResult[] }`, and `function runSearchCommand(projectId: string, query: string, deps: RunSearchDeps): Promise<RunSearchResult>`.

- [ ] **Step 1: Write the failing tests for `args.ts`**

Read the current `tests/cli/args.test.ts` first, then add these four cases inside the existing `describe('parseArgs', ...)` block (do not remove the existing 6 cases):

```typescript
  it('parses a search command with a project id and single-word query', () => {
    expect(parseArgs(['search', 'bidubadu', 'auth'])).toEqual({
      command: 'search',
      projectId: 'bidubadu',
      query: 'auth',
    });
  });

  it('joins a multi-word query into a single string', () => {
    expect(parseArgs(['search', 'bidubadu', 'authentication', 'flow'])).toEqual({
      command: 'search',
      projectId: 'bidubadu',
      query: 'authentication flow',
    });
  });

  it('returns unknown when search is missing a query', () => {
    expect(parseArgs(['search', 'bidubadu'])).toEqual({ command: 'unknown' });
  });

  it('returns unknown when search is missing a project id', () => {
    expect(parseArgs(['search'])).toEqual({ command: 'unknown' });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/cli/args.test.ts`
Expected: FAIL — `parseArgs` doesn't recognize `'search'` yet.

- [ ] **Step 3: Update `src/cli/args.ts`**

Read the current file first, then replace its entire contents with:

```typescript
export type ParsedArgs =
  | { command: 'ingest'; projectId: string }
  | { command: 'sync'; projectId: string }
  | { command: 'search'; projectId: string; query: string }
  | { command: 'unknown' };

export function parseArgs(argv: string[]): ParsedArgs {
  const [command, projectId, ...rest] = argv;
  if ((command === 'ingest' || command === 'sync') && projectId) {
    return { command, projectId };
  }
  if (command === 'search' && projectId && rest.length > 0) {
    return { command: 'search', projectId, query: rest.join(' ') };
  }
  return { command: 'unknown' };
}
```

Note: joining `rest` with a space means a query works whether the user quotes it (`search proj "auth flow"` → argv `['search','proj','auth flow']`, `rest` = `['auth flow']`, joined = `'auth flow'`) or doesn't (`search proj auth flow` → `rest` = `['auth','flow']`, joined = `'auth flow'`) — both produce the same query string.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/cli/args.test.ts`
Expected: PASS (10 tests: 6 existing + 4 new).

- [ ] **Step 5: Write the failing test for `search-command.ts`**

`tests/cli/search-command.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { runSearchCommand } from '../../src/cli/search-command';

describe('runSearchCommand', () => {
  it('searches a registered project and returns results with project name and query', async () => {
    const registry = {
      find: vi.fn().mockReturnValue({ id: 'sample', name: 'Sample', repository: '/r', paths: ['docs'] }),
    } as any;
    const search = vi.fn().mockResolvedValue([{ file: 'a.md', section: 'Intro', score: 0.9, content: 'hi' }]);

    const result = await runSearchCommand('sample', 'hello', { registry, search });

    expect(result).toEqual({
      projectName: 'Sample',
      query: 'hello',
      results: [{ file: 'a.md', section: 'Intro', score: 0.9, content: 'hi' }],
    });
    expect(search).toHaveBeenCalledWith(
      { id: 'sample', name: 'Sample', repository: '/r', paths: ['docs'] },
      'hello',
    );
  });

  it('throws a clear error for an unregistered project', async () => {
    const registry = { find: vi.fn().mockReturnValue(undefined) } as any;
    const search = vi.fn();

    await expect(runSearchCommand('missing', 'hello', { registry, search })).rejects.toThrow(
      'is not registered',
    );
    expect(search).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx vitest run tests/cli/search-command.test.ts`
Expected: FAIL with "Cannot find module '../../src/cli/search-command'".

- [ ] **Step 7: Write minimal implementation**

`src/cli/search-command.ts`:

```typescript
import type { ProjectRegistry } from '../projects/project-registry';
import type { ProjectConfig } from '../projects/project-types';
import type { SearchResult } from '../retrieval/search';

export interface RunSearchDeps {
  registry: ProjectRegistry;
  search: (project: ProjectConfig, query: string) => Promise<SearchResult[]>;
}

export interface RunSearchResult {
  projectName: string;
  query: string;
  results: SearchResult[];
}

export async function runSearchCommand(
  projectId: string,
  query: string,
  deps: RunSearchDeps,
): Promise<RunSearchResult> {
  const project = deps.registry.find(projectId);
  if (!project) {
    throw new Error(`Project "${projectId}" is not registered`);
  }
  const results = await deps.search(project, query);
  return { projectName: project.name, query, results };
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npx vitest run tests/cli/search-command.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 9: Update `src/cli/index.ts` to dispatch all three commands (no TDD — thin process wiring, verified manually in Step 10)**

Read the current file first, then replace its entire contents with:

```typescript
#!/usr/bin/env node
import { loadConfig } from '../config/config';
import { ProjectRegistry } from '../projects/project-registry';
import { createQdrantClient } from '../qdrant/qdrant-client';
import { createEmbeddingProvider } from '../embedding/embedding-provider';
import { indexProject } from '../ingestion/indexer';
import { syncProject } from '../ingestion/sync';
import { searchProject } from '../retrieval/search';
import { parseArgs } from './args';
import { runIngestCommand } from './ingest-command';
import { runSyncCommand } from './sync-command';
import { runSearchCommand } from './search-command';

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.command === 'unknown') {
    console.error('Usage: project-rag <ingest|sync> <project>  |  project-rag search <project> "<query>"');
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

  if (parsed.command === 'sync') {
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
    return;
  }

  const result = await runSearchCommand(parsed.projectId, parsed.query, {
    registry,
    search: (project, query) =>
      searchProject(project.id, query, {
        qdrantClient,
        qdrantCollection: config.qdrantCollection,
        embeddingProvider,
        topK: config.ragTopK,
      }),
  });

  console.log(`Project: ${result.projectName}`);
  console.log(`Query: "${result.query}"\n`);
  if (result.results.length === 0) {
    console.log('No results found.');
    return;
  }
  result.results.forEach((r, i) => {
    console.log(`${i + 1}. [${r.score.toFixed(4)}] ${r.file} — ${r.section}`);
    console.log(`   ${r.content}\n`);
  });
}

main().catch((error) => {
  console.error(`[project-rag] Error: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
```

- [ ] **Step 10: Build and manually verify all three commands' error paths**

```bash
npm run build
QDRANT_URL=http://localhost:6333 EMBEDDING_PROVIDER=ollama EMBEDDING_MODEL=bge-m3 PROJECT_REGISTRY_PATH=./config/projects.json node dist/cli/index.js search nonexistent-project-id "authentication flow"
```

Expected: prints `[project-rag] Error: Project "nonexistent-project-id" is not registered` and exits with a non-zero code (registry lookup fails before any embedding/Qdrant call, same pattern as `ingest`/`sync`). Also re-run the existing `ingest` and `sync` manual checks against `nonexistent-project-id` to confirm neither regressed from the `index.ts` rewrite.

- [ ] **Step 11: Run the full suite and typecheck for real**

Run: `npm run typecheck && npm test`
Expected: all tests passing, clean typecheck. Paste the real output.

- [ ] **Step 12: Commit**

```bash
git add src/cli/args.ts tests/cli/args.test.ts src/cli/search-command.ts tests/cli/search-command.test.ts src/cli/index.ts
git commit -m "feat: add CLI search command and triple ingest/sync/search dispatch"
```

---

### Task 4: Update Feature Docs to Reflect Phase 4

**Files:**
- Modify: `docs/features/04-retrieval-search.md`
- Modify: `docs/features/README.md`

**Interfaces:**
- Consumes: nothing new — documentation only, per the `project-rag-feature-flow` skill's step 5.

- [ ] **Step 1: Update `docs/features/04-retrieval-search.md`**

Read the current file first. Change `**Status: Planned**` to `**Status: Implemented**`. Update the "Related Files" section to list: `src/retrieval/search.ts`, `src/qdrant/qdrant-repository.ts` (extended with `searchPoints`), `src/cli/search-command.ts`, `src/cli/{args,index}.ts` (extended for the `search` command). Remove any "Not yet implemented"/"Planned" framing specific to this feature. If the doc mentions future features from §17 (hybrid search, reranking, etc.), keep those explicitly marked as NOT part of this implementation (still future work), consistent with how Phase 3's doc scoped its own not-yet-built Phase 6 content.

- [ ] **Step 2: Update `docs/features/README.md`**

Replace the `**Updated**:` line with today's date and replace the `**Recent**:` line with: "Phase 4 (Retrieval) implemented: project-filtered vector similarity search (`searchPoints`/`searchProject`) and `project-rag search <project> \"<query>\"` — see `docs/superpowers/plans/2026-08-08-phase4-retrieval.md`." Update entry #4's index line from "— Planned" to "— Implemented".

- [ ] **Step 3: Commit**

```bash
git add docs/features/04-retrieval-search.md docs/features/README.md
git commit -m "docs: mark Phase 4 features implemented"
```
