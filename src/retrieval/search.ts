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
