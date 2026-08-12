import { describe, it, expect, vi } from 'vitest';
import { searchProject, searchProjectMultiQuery } from '../../src/retrieval/search';

describe('searchProject', () => {
  it('embeds the query, enforces the project filter, and maps results', async () => {
    const embeddingProvider = {
      embedQuery: vi.fn().mockResolvedValue([0.1, 0.2]),
      embedDocuments: vi.fn(),
    };
    const qdrantClient = {
      query: vi.fn().mockResolvedValue({
        points: [
          { id: '1', score: 0.9, payload: { file: 'docs/a.md', section: 'Intro', content: 'Hello world' } },
          { id: '2', score: 0.8, payload: { file: 'docs/b.md', section: 'Setup', content: 'Setup steps' } },
        ],
      }),
    } as any;

    const results = await searchProject('sample', 'hello', {
      qdrantClient,
      qdrantCollection: 'ragbuddy_documents',
      embeddingProvider: embeddingProvider as any,
    });

    expect(embeddingProvider.embedQuery).toHaveBeenCalledWith('hello');
    expect(qdrantClient.query).toHaveBeenCalledWith('ragbuddy_documents', {
      query: [0.1, 0.2],
      limit: 5,
      filter: { must: [{ key: 'project', match: { value: 'sample' } }] },
      with_payload: true,
    });
    expect(results).toEqual([
      { file: 'docs/a.md', section: 'Intro', score: 0.9, content: 'Hello world' },
      { file: 'docs/b.md', section: 'Setup', score: 0.8, content: 'Setup steps' },
    ]);
  });

  it('respects a configured topK instead of the default 5', async () => {
    const embeddingProvider = { embedQuery: vi.fn().mockResolvedValue([0.1]), embedDocuments: vi.fn() };
    const qdrantClient = { query: vi.fn().mockResolvedValue({ points: [] }) } as any;

    await searchProject('sample', 'hello', {
      qdrantClient,
      qdrantCollection: 'ragbuddy_documents',
      embeddingProvider: embeddingProvider as any,
      topK: 3,
    });

    expect(qdrantClient.query).toHaveBeenCalledWith(
      'ragbuddy_documents',
      expect.objectContaining({ limit: 3 }),
    );
  });

  it('returns an empty array when nothing matches', async () => {
    const embeddingProvider = { embedQuery: vi.fn().mockResolvedValue([0.1]), embedDocuments: vi.fn() };
    const qdrantClient = { query: vi.fn().mockResolvedValue({ points: [] }) } as any;

    const results = await searchProject('sample', 'nothing matches this', {
      qdrantClient,
      qdrantCollection: 'ragbuddy_documents',
      embeddingProvider: embeddingProvider as any,
    });

    expect(results).toEqual([]);
  });
});

describe('searchProjectMultiQuery', () => {
  it('searches once per query variant and merges the distinct hits, best score first', async () => {
    const embeddingProvider = { embedQuery: vi.fn().mockResolvedValue([0.1]), embedDocuments: vi.fn() };
    const qdrantClient = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          points: [{ id: '1', score: 0.6, payload: { file: 'docs/a.md', section: 'Intro', content: 'A' } }],
        })
        .mockResolvedValueOnce({
          points: [{ id: '2', score: 0.9, payload: { file: 'docs/b.md', section: 'Setup', content: 'B' } }],
        }),
    } as any;

    const results = await searchProjectMultiQuery('sample', ['original query', 'alternative phrasing'], {
      qdrantClient,
      qdrantCollection: 'ragbuddy_documents',
      embeddingProvider: embeddingProvider as any,
    });

    expect(qdrantClient.query).toHaveBeenCalledTimes(2);
    expect(results).toEqual([
      { file: 'docs/b.md', section: 'Setup', score: 0.9, content: 'B' },
      { file: 'docs/a.md', section: 'Intro', score: 0.6, content: 'A' },
    ]);
  });

  it('dedupes the same file+section across variants, keeping the higher score', async () => {
    const embeddingProvider = { embedQuery: vi.fn().mockResolvedValue([0.1]), embedDocuments: vi.fn() };
    const qdrantClient = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          points: [{ id: '1', score: 0.5, payload: { file: 'docs/a.md', section: 'Intro', content: 'A (weaker match)' } }],
        })
        .mockResolvedValueOnce({
          points: [{ id: '1', score: 0.95, payload: { file: 'docs/a.md', section: 'Intro', content: 'A (stronger match)' } }],
        }),
    } as any;

    const results = await searchProjectMultiQuery('sample', ['q1', 'q2'], {
      qdrantClient,
      qdrantCollection: 'ragbuddy_documents',
      embeddingProvider: embeddingProvider as any,
    });

    expect(results).toEqual([{ file: 'docs/a.md', section: 'Intro', score: 0.95, content: 'A (stronger match)' }]);
  });

  it('cuts the merged set down to topK', async () => {
    const embeddingProvider = { embedQuery: vi.fn().mockResolvedValue([0.1]), embedDocuments: vi.fn() };
    const qdrantClient = {
      query: vi.fn().mockResolvedValue({
        points: [
          { id: '1', score: 0.9, payload: { file: 'docs/a.md', section: 'A', content: 'a' } },
          { id: '2', score: 0.8, payload: { file: 'docs/b.md', section: 'B', content: 'b' } },
          { id: '3', score: 0.7, payload: { file: 'docs/c.md', section: 'C', content: 'c' } },
        ],
      }),
    } as any;

    const results = await searchProjectMultiQuery('sample', ['only query'], {
      qdrantClient,
      qdrantCollection: 'ragbuddy_documents',
      embeddingProvider: embeddingProvider as any,
      topK: 2,
    });

    expect(results).toHaveLength(2);
    expect(results.map((r) => r.file)).toEqual(['docs/a.md', 'docs/b.md']);
  });
});
