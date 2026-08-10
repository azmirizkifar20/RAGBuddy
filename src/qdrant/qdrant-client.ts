import { QdrantClient } from '@qdrant/js-client-rest';
import type { Schemas } from '@qdrant/js-client-rest/dist/types/types';

export interface QdrantConnectionConfig {
  url: string;
  collectionName: string;
  vectorSize: number;
}

/**
 * `vectors` is `VectorParams | Record<string, VectorParams>` (unnamed vs. named vectors) — every
 * collection this app creates uses a single unnamed vector, but the `Record` branch's index
 * signature means `'size' in vectors` alone doesn't narrow away a `VectorParams` result, so the
 * `typeof` check does the real work here.
 */
export function getCollectionVectorSize(info: Schemas['CollectionInfo']): number | undefined {
  const vectors = info.config?.params?.vectors;
  return vectors && 'size' in vectors && typeof vectors.size === 'number' ? vectors.size : undefined;
}

export function createQdrantClient(url: string): QdrantClient {
  return new QdrantClient({ url });
}

export async function ensureCollection(
  client: QdrantClient,
  config: QdrantConnectionConfig,
): Promise<void> {
  const collections = await client.getCollections();
  const exists = collections.collections.some((c) => c.name === config.collectionName);
  if (!exists) {
    await client.createCollection(config.collectionName, {
      vectors: { size: config.vectorSize, distance: 'Cosine' },
    });
    return;
  }
  // Fail fast on a dimension mismatch (e.g. EMBEDDING_MODEL changed since this collection was
  // created) rather than letting every file embed first and only discovering it as a raw
  // Qdrant "Bad Request" on the final upsert, possibly an hour in.
  const info = await client.getCollection(config.collectionName);
  const existingSize = getCollectionVectorSize(info);
  if (existingSize !== undefined && existingSize !== config.vectorSize) {
    throw new Error(
      `Embedding dimension mismatch: this embedding model produces ${config.vectorSize}-dim vectors, ` +
        `but Qdrant collection "${config.collectionName}" is configured for ${existingSize}-dim vectors. ` +
        'Switch back to a matching embedding model, or run `ragbuddy qdrant drop-collection --yes` to ' +
        'delete the collection and rebuild it at the new dimension (this requires re-ingesting every ' +
        'project sharing this collection).',
    );
  }
}

/** No-op if the collection doesn't exist — dropping something already gone isn't an error. */
export async function dropCollection(client: QdrantClient, collectionName: string): Promise<void> {
  const collections = await client.getCollections();
  if (collections.collections.some((c) => c.name === collectionName)) {
    await client.deleteCollection(collectionName);
  }
}
