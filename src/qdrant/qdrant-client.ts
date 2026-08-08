import { QdrantClient } from '@qdrant/js-client-rest';

export interface QdrantConnectionConfig {
  url: string;
  collectionName: string;
  vectorSize: number;
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
  }
}
