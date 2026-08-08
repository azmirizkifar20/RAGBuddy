import { describe, it, expect, vi } from 'vitest';
import { searchProject } from '../../src/retrieval/search';

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
      qdrantCollection: 'project_rag_documents',
      embeddingProvider: embeddingProvider as any,
    });

    expect(embeddingProvider.embedQuery).toHaveBeenCalledWith('hello');
    expect(qdrantClient.query).toHaveBeenCalledWith('project_rag_documents', {
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
      qdrantCollection: 'project_rag_documents',
      embeddingProvider: embeddingProvider as any,
      topK: 3,
    });

    expect(qdrantClient.query).toHaveBeenCalledWith(
      'project_rag_documents',
      expect.objectContaining({ limit: 3 }),
    );
  });

  it('returns an empty array when nothing matches', async () => {
    const embeddingProvider = { embedQuery: vi.fn().mockResolvedValue([0.1]), embedDocuments: vi.fn() };
    const qdrantClient = { query: vi.fn().mockResolvedValue({ points: [] }) } as any;

    const results = await searchProject('sample', 'nothing matches this', {
      qdrantClient,
      qdrantCollection: 'project_rag_documents',
      embeddingProvider: embeddingProvider as any,
    });

    expect(results).toEqual([]);
  });
});
