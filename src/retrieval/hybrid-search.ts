import type { SearchDeps, SearchResult } from './search';
import { searchProjectMultiQuery } from './search';
import { getBm25Index } from './bm25-index';
import { bm25Search } from './bm25';

const RRF_K = 60;
const DEFAULT_TOP_K = 5;

export interface HybridSearchDeps extends SearchDeps {
  /** Cache-invalidation signal for the BM25 lexical index — see `getBm25Index`. */
  bm25VersionKey: string;
}

function keyOf(r: SearchResult): string {
  return `${r.file}::${r.section}`;
}

/** Reciprocal Rank Fusion: combines two ranked lists by position, not raw score, so a vector
 *  cosine similarity and a BM25 score never need to share a scale. The emitted `SearchResult`
 *  keeps its ORIGINAL score (preferring the vector-search version when a hit appears in both) so
 *  a downstream "% match" display stays meaningful — only the ordering comes from RRF. */
function fuseRankings(vectorResults: SearchResult[], lexicalResults: SearchResult[], limit: number): SearchResult[] {
  const rrfScore = new Map<string, number>();
  const byKey = new Map<string, SearchResult>();

  vectorResults.forEach((r, rank) => {
    const key = keyOf(r);
    rrfScore.set(key, (rrfScore.get(key) ?? 0) + 1 / (RRF_K + rank + 1));
    byKey.set(key, r);
  });
  lexicalResults.forEach((r, rank) => {
    const key = keyOf(r);
    rrfScore.set(key, (rrfScore.get(key) ?? 0) + 1 / (RRF_K + rank + 1));
    if (!byKey.has(key)) byKey.set(key, r);
  });

  return [...rrfScore.keys()]
    .sort((a, b) => rrfScore.get(b)! - rrfScore.get(a)!)
    .slice(0, limit)
    .map((key) => byKey.get(key)!);
}

/** Combines dense vector search (`searchProjectMultiQuery`, one call per rewritten query variant)
 *  with a lexical BM25 pass over the project's full chunk corpus, fused by Reciprocal Rank
 *  Fusion. Vector search alone can miss exact-term matches (function names, error codes, file
 *  paths) that never score high on cosine similarity; BM25 catches those. The BM25 pass runs only
 *  against the original query — the rewritten variants are semantic paraphrases meant to help
 *  vector recall, so running lexical search against them too would just dilute exact-term
 *  matching. Best-effort: any failure (index build, Qdrant scroll) falls back to vector-only
 *  results, mirroring how `rewriteQuery`/`rerank` already degrade gracefully elsewhere in this
 *  pipeline. */
export async function hybridSearch(
  project: string,
  queries: string[],
  originalQuery: string,
  deps: HybridSearchDeps,
): Promise<SearchResult[]> {
  const limit = deps.topK ?? DEFAULT_TOP_K;
  const vectorResults = await searchProjectMultiQuery(project, queries, deps);

  let lexicalResults: SearchResult[] = [];
  try {
    const index = await getBm25Index(project, {
      qdrantClient: deps.qdrantClient,
      qdrantCollection: deps.qdrantCollection,
      versionKey: deps.bm25VersionKey,
    });
    lexicalResults = bm25Search(index, originalQuery, limit);
  } catch {
    lexicalResults = [];
  }

  if (lexicalResults.length === 0) return vectorResults;
  return fuseRankings(vectorResults, lexicalResults, limit);
}
