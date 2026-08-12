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
});
