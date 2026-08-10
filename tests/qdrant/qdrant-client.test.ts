import { describe, it, expect, vi } from 'vitest';
import { ensureCollection, dropCollection } from '../../src/qdrant/qdrant-client';

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

  it('skips creation when the collection already exists with a matching vector size', async () => {
    const client = {
      getCollections: vi.fn().mockResolvedValue({ collections: [{ name: 'docs' }] }),
      createCollection: vi.fn(),
      getCollection: vi.fn().mockResolvedValue({ config: { params: { vectors: { size: 4 } } } }),
    } as any;

    await ensureCollection(client, { url: 'http://x', collectionName: 'docs', vectorSize: 4 });

    expect(client.createCollection).not.toHaveBeenCalled();
  });

  it('throws a clear error when the existing collection was built with a different vector size', async () => {
    const client = {
      getCollections: vi.fn().mockResolvedValue({ collections: [{ name: 'docs' }] }),
      createCollection: vi.fn(),
      getCollection: vi.fn().mockResolvedValue({ config: { params: { vectors: { size: 3072 } } } }),
    } as any;

    await expect(
      ensureCollection(client, { url: 'http://x', collectionName: 'docs', vectorSize: 1024 }),
    ).rejects.toThrow(/dimension mismatch.*1024.*3072/is);
    expect(client.createCollection).not.toHaveBeenCalled();
  });
});

describe('dropCollection', () => {
  it('deletes the collection when it exists', async () => {
    const client = {
      getCollections: vi.fn().mockResolvedValue({ collections: [{ name: 'docs' }] }),
      deleteCollection: vi.fn().mockResolvedValue(true),
    } as any;

    await dropCollection(client, 'docs');

    expect(client.deleteCollection).toHaveBeenCalledWith('docs');
  });

  it('is a no-op when the collection does not exist', async () => {
    const client = {
      getCollections: vi.fn().mockResolvedValue({ collections: [] }),
      deleteCollection: vi.fn(),
    } as any;

    await dropCollection(client, 'docs');

    expect(client.deleteCollection).not.toHaveBeenCalled();
  });
});
