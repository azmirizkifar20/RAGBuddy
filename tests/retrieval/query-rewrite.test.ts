import { describe, it, expect, afterEach, vi } from 'vitest';
import { rewriteQuery } from '../../src/retrieval/query-rewrite';

const SETTINGS = { provider: 'ollama' as const, baseUrl: 'http://localhost:11434', model: 'llama3' };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('rewriteQuery', () => {
  it('returns the original query first, followed by the model-generated variants', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ message: { content: 'how does sync work\nexplain the sync process' } }), {
          status: 200,
        }),
      ),
    );

    const queries = await rewriteQuery('how does auto-sync work?', SETTINGS);

    expect(queries).toEqual([
      'how does auto-sync work?',
      'how does sync work',
      'explain the sync process',
    ]);
  });

  it('drops a variant that is identical to the original query (case-insensitive)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ message: { content: 'How Does Auto-Sync Work?\nsync mechanism' } }), {
          status: 200,
        }),
      ),
    );

    const queries = await rewriteQuery('how does auto-sync work?', SETTINGS);

    expect(queries).toEqual(['how does auto-sync work?', 'sync mechanism']);
  });

  it('falls back to just the original query when the rewrite request fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('timeout')));

    const queries = await rewriteQuery('how does auto-sync work?', SETTINGS);

    expect(queries).toEqual(['how does auto-sync work?']);
  });

  it('falls back to just the original query when the response has no usable content', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: { content: '' } }), { status: 200 })));

    const queries = await rewriteQuery('how does auto-sync work?', SETTINGS);

    expect(queries).toEqual(['how does auto-sync work?']);
  });

  it('sends recent conversation history ahead of the query, so the model can resolve follow-up references', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: { content: 'how does the git hook trigger sync\nexplain hook-triggered sync' } }), {
        status: 200,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const history = [
      { role: 'user' as const, content: 'tell me about the git hook' },
      { role: 'assistant' as const, content: 'it runs ragbuddy sync after every commit' },
    ];
    const queries = await rewriteQuery('how does that work internally?', SETTINGS, history);

    expect(queries[0]).toBe('how does that work internally?');
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.messages).toEqual([
      { role: 'system', content: expect.any(String) },
      { role: 'user', content: 'tell me about the git hook' },
      { role: 'assistant', content: 'it runs ragbuddy sync after every commit' },
      { role: 'user', content: 'how does that work internally?' },
    ]);
  });

  it('omits history entirely from the request when none is passed (default behavior unchanged)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: { content: 'variant one\nvariant two' } }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await rewriteQuery('plain query', SETTINGS);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.messages).toEqual([
      { role: 'system', content: expect.any(String) },
      { role: 'user', content: 'plain query' },
    ]);
  });
});
