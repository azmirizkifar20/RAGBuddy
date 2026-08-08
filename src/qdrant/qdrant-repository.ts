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
  /** Absent on points written before uploads existed — treated as 'repository'. */
  source?: DocumentSource;
  [key: string]: unknown;
}

export type DocumentSource = 'repository' | 'upload';
/** 'repository' also matches legacy points that predate the `source` payload field. */
export type SourceScope = 'all' | DocumentSource;

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

/**
 * Legacy points carry no `source` field, so "repository" is expressed as
 * "not an upload" rather than "source == repository" — otherwise every point
 * written before uploads existed would fall outside both scopes and be
 * orphaned by sync (never diffed, never deleted).
 */
function scopedFilter(project: string, scope: SourceScope): Record<string, unknown> {
  const filter: Record<string, unknown> = { must: [{ key: 'project', match: { value: project } }] };
  if (scope === 'upload') {
    filter.must = [...(filter.must as unknown[]), { key: 'source', match: { value: 'upload' } }];
  } else if (scope === 'repository') {
    filter.must_not = [{ key: 'source', match: { value: 'upload' } }];
  }
  return filter;
}

export async function deleteProjectVectors(
  client: QdrantClient,
  collectionName: string,
  project: string,
  scope: SourceScope = 'all',
): Promise<void> {
  await client.delete(collectionName, { filter: scopedFilter(project, scope) });
}

async function scrollPayloads(
  client: QdrantClient,
  collectionName: string,
  project: string,
  scope: SourceScope,
): Promise<Partial<ChunkPayload>[]> {
  const collections = await client.getCollections();
  if (!collections.collections.some((c) => c.name === collectionName)) return [];

  const payloads: Partial<ChunkPayload>[] = [];
  let offset: string | number | Record<string, unknown> | null | undefined;
  do {
    const result = await client.scroll(collectionName, {
      filter: scopedFilter(project, scope),
      with_payload: true,
      with_vector: false,
      limit: 200,
      offset,
    });
    for (const point of result.points) {
      if (point.payload) payloads.push(point.payload as Partial<ChunkPayload>);
    }
    offset = result.next_page_offset ?? undefined;
  } while (offset !== undefined && offset !== null);
  return payloads;
}

export async function getIndexedFileHashes(
  client: QdrantClient,
  collectionName: string,
  project: string,
  scope: SourceScope = 'all',
): Promise<Map<string, string>> {
  const hashes = new Map<string, string>();
  for (const payload of await scrollPayloads(client, collectionName, project, scope)) {
    if (payload.file && payload.content_hash) hashes.set(payload.file, payload.content_hash);
  }
  return hashes;
}

export interface IndexedFile {
  file: string;
  source: DocumentSource;
  /** 'markdown' for repository docs; uploads carry their real format (pdf/docx/xlsx/…). */
  documentType: string;
  chunkCount: number;
  title: string;
}

/** One row per indexed file — what the dashboard's document list renders. */
export async function getIndexedFiles(
  client: QdrantClient,
  collectionName: string,
  project: string,
  scope: SourceScope = 'all',
): Promise<IndexedFile[]> {
  const byFile = new Map<string, IndexedFile>();
  for (const payload of await scrollPayloads(client, collectionName, project, scope)) {
    if (!payload.file) continue;
    const existing = byFile.get(payload.file);
    if (existing) {
      existing.chunkCount += 1;
      if (!existing.title && payload.title) existing.title = payload.title;
      continue;
    }
    byFile.set(payload.file, {
      file: payload.file,
      source: payload.source === 'upload' ? 'upload' : 'repository',
      documentType: payload.document_type ?? 'markdown',
      chunkCount: 1,
      title: payload.title ?? '',
    });
  }
  return [...byFile.values()].sort((a, b) => a.file.localeCompare(b.file));
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
