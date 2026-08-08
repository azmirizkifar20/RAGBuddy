import { describe, it, expect, vi } from 'vitest';
import { ensureCollection } from '../../src/qdrant/qdrant-client';

describe('ensureCollection', () => {
  it('creates the collection when it does not exist', async () => {
    const client = {
      getCollections: vi.fn().mockResolvedValue({ collections: [] }),
      createCollection: vi.fn().mockResolvedValue(true),
    } as any;

    await ensureCollection(client, { url: 'http://x', collectionName: 'docs', vectorSize: 4 });

    expect(client.createCollection).toHaveBeenCalledWith('docs', {
      vectors: { size: 4, distance: 'Cosine' },
    });
  });

  it('skips creation when the collection already exists', async () => {
    const client = {
      getCollections: vi.fn().mockResolvedValue({ collections: [{ name: 'docs' }] }),
      createCollection: vi.fn(),
    } as any;

    await ensureCollection(client, { url: 'http://x', collectionName: 'docs', vectorSize: 4 });

    expect(client.createCollection).not.toHaveBeenCalled();
  });
});
