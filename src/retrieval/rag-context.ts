import type { QdrantClient } from '@qdrant/js-client-rest';
import type { EmbeddingProvider } from '../embedding/embedding-provider';
import type { ActiveConnection } from '../config/credentials-store';
import { rewriteQuery, type ConversationTurn } from './query-rewrite';
import { hybridSearch } from './hybrid-search';
import { rerank } from './rerank';
import type { SearchResult } from './search';

/** How much larger a candidate pool `hybridSearch` fetches than the final `ragTopK`, giving
 * `rerank` something to actually reorder instead of just re-scoring the same top few. */
const RERANK_POOL_MULTIPLIER = 3;

export interface RagContextDeps {
  qdrantClient: QdrantClient;
  qdrantCollection: string;
  embeddingProvider: EmbeddingProvider;
  ragTopK: number;
  /** Cache-invalidation signal for the BM25 lexical index — see `src/retrieval/bm25-index.ts`. */
  bm25VersionKey: string;
}

export interface RagContextResult {
  results: SearchResult[];
  /** Set only when retrieval itself threw (e.g. an embedding/vector-size mismatch) — never for
   *  "ran fine, found nothing relevant", which is a normal outcome and stays silent. */
  error?: string;
}

/** The shared rewrite → hybrid search → rerank pipeline behind every RAG-grounded answer (the
 *  chat route, `ragbuddy ask`). Never throws — a retrieval failure comes back as `error` so the
 *  caller can still answer without context instead of failing outright. */
export async function getRagResults(
  project: string,
  query: string,
  settings: ActiveConnection,
  history: ConversationTurn[],
  deps: RagContextDeps,
): Promise<RagContextResult> {
  try {
    const queries = await rewriteQuery(query, settings, history);
    const candidates = await hybridSearch(project, queries, query, {
      qdrantClient: deps.qdrantClient,
      qdrantCollection: deps.qdrantCollection,
      embeddingProvider: deps.embeddingProvider,
      topK: deps.ragTopK * RERANK_POOL_MULTIPLIER,
      bm25VersionKey: deps.bm25VersionKey,
    });
    const results = await rerank(query, candidates, settings, deps.ragTopK);
    return { results };
  } catch (error) {
    return { results: [], error: error instanceof Error ? error.message : String(error) };
  }
}
