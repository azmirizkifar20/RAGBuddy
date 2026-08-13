import { describe, it, expect, vi, afterEach } from 'vitest';
import { getRagResults } from '../../src/retrieval/rag-context';

const SETTINGS = { provider: 'ollama' as const, baseUrl: 'http://localhost:11434', model: 'llama3' };

function embeddingProvider() {
  return { embedQuery: vi.fn().mockResolvedValue([0.1]), embedDocuments: vi.fn() };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('getRagResults', () => {
  it('runs rewrite -> hybrid search -> rerank and returns results with no error', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: { content: '' } }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const qdrantClient = {
      query: vi.fn().mockResolvedValue({
        points: [{ id: '1', score: 0.9, payload: { file: 'a.md', section: 'A', content: 'hello' } }],
      }),
    } as any;

    const { results, error } = await getRagResults('proj', 'hello', SETTINGS, [], {
      qdrantClient,
      qdrantCollection: 'docs',
      embeddingProvider: embeddingProvider() as any,
      ragTopK: 5,
      bm25VersionKey: 'v1',
    });

    expect(error).toBeUndefined();
    expect(results).toEqual([{ file: 'a.md', section: 'A', score: 0.9, content: 'hello' }]);
  });

  it('passes conversation history through to the rewrite call', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: { content: '' } }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const qdrantClient = { query: vi.fn().mockResolvedValue({ points: [] }) } as any;
    const history = [{ role: 'user' as const, content: 'earlier turn' }];

    await getRagResults('proj', 'follow up', SETTINGS, history, {
      qdrantClient,
      qdrantCollection: 'docs',
      embeddingProvider: embeddingProvider() as any,
      ragTopK: 5,
      bm25VersionKey: 'v1',
    });

    const rewriteBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(rewriteBody.messages).toContainEqual({ role: 'user', content: 'earlier turn' });
  });

  it('never throws — a retrieval failure comes back as `error` with empty results', async () => {
    // The query-rewrite call still goes through completeOnce before hybridSearch's vector search
    // fails, so fetch must be stubbed here too — otherwise it would hit the network for real.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: { content: '' } }), { status: 200 })));
    const qdrantClient = { query: vi.fn().mockRejectedValue(new Error('Bad Request')) } as any;

    const { results, error } = await getRagResults('proj', 'hello', SETTINGS, [], {
      qdrantClient,
      qdrantCollection: 'docs',
      embeddingProvider: embeddingProvider() as any,
      ragTopK: 5,
      bm25VersionKey: 'v1',
    });

    expect(results).toEqual([]);
    expect(error).toBe('Bad Request');
  });
});
