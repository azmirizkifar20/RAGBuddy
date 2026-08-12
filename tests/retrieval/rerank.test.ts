import { describe, it, expect, afterEach, vi } from 'vitest';
import { rerank } from '../../src/retrieval/rerank';
import type { SearchResult } from '../../src/retrieval/search';

const SETTINGS = { provider: 'ollama' as const, baseUrl: 'http://localhost:11434', model: 'llama3' };

const CANDIDATES: SearchResult[] = [
  { file: 'docs/a.md', section: 'A', score: 0.9, content: 'a content' },
  { file: 'docs/b.md', section: 'B', score: 0.8, content: 'b content' },
  { file: 'docs/c.md', section: 'C', score: 0.7, content: 'c content' },
];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('rerank', () => {
  it('returns candidates unchanged, with no LLM call, when already at or under topK', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const results = await rerank('q', CANDIDATES, SETTINGS, 3);

    expect(results).toEqual(CANDIDATES);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reorders candidates according to the model's ranking and cuts to topK", async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: { content: '[2,0,1]' } }), { status: 200 })),
    );

    const results = await rerank('q', CANDIDATES, SETTINGS, 2);

    expect(results).toEqual([CANDIDATES[2], CANDIDATES[0]]);
  });

  it('appends any index the model dropped, then cuts to topK', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: { content: '[1]' } }), { status: 200 })),
    );

    // topK=2 < candidates.length=3, so the model's incomplete ranking is exercised
    // (rather than the length<=topK short-circuit): it only ranked index 1, so 0 and
    // 2 get appended in their original order before the slice.
    const results = await rerank('q', CANDIDATES, SETTINGS, 2);

    expect(results).toEqual([CANDIDATES[1], CANDIDATES[0]]);
  });

  it('falls back to the original order when the reply is not valid JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: { content: 'not json' } }), { status: 200 })),
    );

    const results = await rerank('q', CANDIDATES, SETTINGS, 2);

    expect(results).toEqual(CANDIDATES.slice(0, 2));
  });

  it('falls back to the original order when the rerank request fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('timeout')));

    const results = await rerank('q', CANDIDATES, SETTINGS, 2);

    expect(results).toEqual(CANDIDATES.slice(0, 2));
  });
});
