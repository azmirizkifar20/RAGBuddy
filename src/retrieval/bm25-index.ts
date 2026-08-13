import type { QdrantClient } from '@qdrant/js-client-rest';
import { getProjectChunks } from '../qdrant/qdrant-repository';
import { buildBm25Index, type Bm25Index } from './bm25';

interface CacheEntry {
  versionKey: string;
  index: Bm25Index;
}

const cache = new Map<string, CacheEntry>();

export interface Bm25IndexDeps {
  qdrantClient: QdrantClient;
  qdrantCollection: string;
  /** Cache-invalidation signal — the index rebuilds only when this differs from the cached
   *  entry's. In practice this is the project's cached stats `updatedAt` (`src/projects/
   *  project-stats.ts`), already bumped by every ingest/sync/upload. */
  versionKey: string;
}

/** Lazily builds and caches an in-memory BM25 index per project. Scoped to the running process —
 *  no disk persistence, since losing it on restart just costs one extra full-corpus scroll on the
 *  next chat query. Rebuilding only on a `versionKey` change (rather than every call, or on a
 *  TTL) avoids repeating the mistake in docs/issue/2026-08-11_dashboard-slow-project-list.md,
 *  where an uncached full-corpus scroll ran on every page load. */
export async function getBm25Index(project: string, deps: Bm25IndexDeps): Promise<Bm25Index> {
  const cached = cache.get(project);
  if (cached && cached.versionKey === deps.versionKey) return cached.index;

  const chunks = await getProjectChunks(deps.qdrantClient, deps.qdrantCollection, project);
  const index = buildBm25Index(chunks);
  cache.set(project, { versionKey: deps.versionKey, index });
  return index;
}
