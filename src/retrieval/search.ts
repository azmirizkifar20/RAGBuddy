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

/** Runs `searchProject` once per query variant (e.g. from `rewriteQuery`) and merges the results:
 *  same `file`+`section` keeps whichever variant scored it higher, then the merged set is sorted
 *  best-first and cut to `deps.topK`. Each variant still goes through `searchProject`, so the
 *  project filter is enforced identically for every one of them. */
export async function searchProjectMultiQuery(
  project: string,
  queries: string[],
  deps: SearchDeps,
): Promise<SearchResult[]> {
  const limit = deps.topK ?? DEFAULT_TOP_K;
  const perQueryResults = await Promise.all(queries.map((q) => searchProject(project, q, deps)));

  const byKey = new Map<string, SearchResult>();
  for (const results of perQueryResults) {
    for (const result of results) {
      const key = `${result.file}::${result.section}`;
      const existing = byKey.get(key);
      if (!existing || result.score > existing.score) byKey.set(key, result);
    }
  }

  return [...byKey.values()].sort((a, b) => b.score - a.score).slice(0, limit);
}
