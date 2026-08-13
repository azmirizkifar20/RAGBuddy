import { describe, it, expect, vi } from 'vitest';
import { getBm25Index } from '../../src/retrieval/bm25-index';

function scrollClient(points: unknown[]) {
  return {
    getCollections: vi.fn().mockResolvedValue({ collections: [{ name: 'docs' }] }),
    scroll: vi.fn().mockResolvedValue({ points, next_page_offset: null }),
  } as any;
}

describe('getBm25Index', () => {
  it('builds an index from the project corpus on first call', async () => {
    const client = scrollClient([{ id: '1', payload: { file: 'a.md', section: 'Intro', content: 'hello sync world' } }]);

    const index = await getBm25Index('proj-fresh', {
      qdrantClient: client,
      qdrantCollection: 'docs',
      versionKey: 'v1',
    });

    expect(index.n).toBe(1);
    expect(client.scroll).toHaveBeenCalledTimes(1);
  });

  it('reuses the cached index on a second call with the same versionKey, without scrolling again', async () => {
    const client = scrollClient([{ id: '1', payload: { file: 'a.md', section: 'Intro', content: 'hello sync world' } }]);
    const deps = { qdrantClient: client, qdrantCollection: 'docs', versionKey: 'v1' };

    await getBm25Index('proj-cached', deps);
    await getBm25Index('proj-cached', deps);

    expect(client.scroll).toHaveBeenCalledTimes(1);
  });

  it('rebuilds when versionKey changes (e.g. after a sync bumped the project stats)', async () => {
    const client = scrollClient([{ id: '1', payload: { file: 'a.md', section: 'Intro', content: 'hello sync world' } }]);

    await getBm25Index('proj-versioned', { qdrantClient: client, qdrantCollection: 'docs', versionKey: 'v1' });
    await getBm25Index('proj-versioned', { qdrantClient: client, qdrantCollection: 'docs', versionKey: 'v2' });

    expect(client.scroll).toHaveBeenCalledTimes(2);
  });
});
