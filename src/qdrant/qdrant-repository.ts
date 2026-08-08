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
  [key: string]: unknown;
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

export async function getIndexedFileHashes(
  client: QdrantClient,
  collectionName: string,
  project: string,
): Promise<Map<string, string>> {
  const hashes = new Map<string, string>();
  let offset: string | number | Record<string, unknown> | null | undefined;
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
