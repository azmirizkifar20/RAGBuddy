import { describe, it, expect, vi } from 'vitest';
import { hybridSearch } from '../../src/retrieval/hybrid-search';

function embeddingProvider() {
  return { embedQuery: vi.fn().mockResolvedValue([0.1]), embedDocuments: vi.fn() };
}

describe('hybridSearch', () => {
  it('fuses vector and lexical hits via RRF, surfacing a lexical-only match vector search missed, and keeps original scores', async () => {
    const qdrantClient = {
      query: vi.fn().mockResolvedValue({
        points: [
          { id: '1', score: 0.9, payload: { file: 'a.md', section: 'A', content: 'vector match a with a hook mention' } },
          { id: '2', score: 0.8, payload: { file: 'b.md', section: 'B', content: 'vector match b, unrelated content entirely' } },
        ],
      }),
      getCollections: vi.fn().mockResolvedValue({ collections: [{ name: 'docs' }] }),
      scroll: vi.fn().mockResolvedValue({
        points: [
          { id: '1', payload: { file: 'a.md', section: 'A', content: 'vector match a with a hook mention' } },
          { id: '2', payload: { file: 'b.md', section: 'B', content: 'vector match b, unrelated content entirely' } },
          { id: '3', payload: { file: 'c.md', section: 'C', content: 'ELECTRON_RUN_AS_NODE headless hook trick' } },
        ],
        next_page_offset: null,
      }),
    } as any;

    const results = await hybridSearch('proj-fuse', ['ELECTRON_RUN_AS_NODE hook'], 'ELECTRON_RUN_AS_NODE hook', {
      qdrantClient,
      qdrantCollection: 'docs',
      embeddingProvider: embeddingProvider() as any,
      topK: 3,
      bm25VersionKey: 'v1',
    });

    // a.md is in both lists (vector-ranked highest, and lexically matches "hook"), so it wins the
    // fused RRF ranking and keeps its ORIGINAL vector score, not the RRF value.
    expect(results[0]).toEqual({ file: 'a.md', section: 'A', score: 0.9, content: 'vector match a with a hook mention' });
    // c.md never appeared in the vector results at all — only BM25 surfaced it.
    expect(results.some((r) => r.file === 'c.md')).toBe(true);
    // b.md is vector-only; its original score is untouched by the fusion.
    expect(results.find((r) => r.file === 'b.md')?.score).toBe(0.8);
  });

  it('falls back to vector-only results when the BM25 pass fails (e.g. qdrant client has no scroll support)', async () => {
    const qdrantClient = {
      query: vi.fn().mockResolvedValue({
        points: [{ id: '1', score: 0.9, payload: { file: 'a.md', section: 'A', content: 'hello' } }],
      }),
      // No `scroll` method at all — mirrors the minimal mocks used by chat route tests.
    } as any;

    const results = await hybridSearch('proj-degrade', ['hello'], 'hello', {
      qdrantClient,
      qdrantCollection: 'docs',
      embeddingProvider: embeddingProvider() as any,
      topK: 5,
      bm25VersionKey: 'v1',
    });

    expect(results).toEqual([{ file: 'a.md', section: 'A', score: 0.9, content: 'hello' }]);
  });

  it('returns vector-only results unchanged when nothing matches lexically', async () => {
    const qdrantClient = {
      query: vi.fn().mockResolvedValue({
        points: [{ id: '1', score: 0.9, payload: { file: 'a.md', section: 'A', content: 'hello world' } }],
      }),
      getCollections: vi.fn().mockResolvedValue({ collections: [{ name: 'docs' }] }),
      scroll: vi.fn().mockResolvedValue({
        points: [{ id: '1', payload: { file: 'a.md', section: 'A', content: 'hello world' } }],
        next_page_offset: null,
      }),
    } as any;

    const results = await hybridSearch('proj-no-lexical-match', ['hello'], 'zzz gibberish nomatch', {
      qdrantClient,
      qdrantCollection: 'docs',
      embeddingProvider: embeddingProvider() as any,
      topK: 5,
      bm25VersionKey: 'v1',
    });

    expect(results).toEqual([{ file: 'a.md', section: 'A', score: 0.9, content: 'hello world' }]);
  });

  it('runs the lexical pass against the original query, not the rewritten dense-search variants', async () => {
    const qdrantClient = {
      query: vi.fn().mockResolvedValue({ points: [] }),
      getCollections: vi.fn().mockResolvedValue({ collections: [{ name: 'docs' }] }),
      scroll: vi.fn().mockResolvedValue({
        points: [{ id: '1', payload: { file: 'c.md', section: 'C', content: 'ELECTRON_RUN_AS_NODE trick' } }],
        next_page_offset: null,
      }),
    } as any;

    const results = await hybridSearch(
      'proj-original-query',
      ['a dense-search paraphrase that shares no terms with the corpus'],
      'ELECTRON_RUN_AS_NODE',
      {
        qdrantClient,
        qdrantCollection: 'docs',
        embeddingProvider: embeddingProvider() as any,
        topK: 5,
        bm25VersionKey: 'v1',
      },
    );

    expect(results).toEqual([{ file: 'c.md', section: 'C', score: 1, content: 'ELECTRON_RUN_AS_NODE trick' }]);
  });
});
