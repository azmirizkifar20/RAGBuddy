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
