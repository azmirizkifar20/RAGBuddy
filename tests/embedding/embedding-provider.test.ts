import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createEmbeddingProvider } from '../../src/embedding/embedding-provider';

describe('createEmbeddingProvider', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('throws on an unknown provider', () => {
    expect(() =>
      createEmbeddingProvider({ provider: 'bogus' as any, baseUrl: 'http://x', model: 'm' }),
    ).toThrow('Unknown embedding provider');
  });

  it('ollama provider calls the /api/embeddings endpoint for a single query', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ embedding: [0.1, 0.2] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = createEmbeddingProvider({
      provider: 'ollama',
      baseUrl: 'http://localhost:11434',
      model: 'bge-m3',
    });
    const result = await provider.embedQuery('hello');

    expect(result).toEqual([0.1, 0.2]);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:11434/api/embeddings',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('openai-compatible provider embeds multiple documents in one request', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [{ embedding: [1, 2] }, { embedding: [3, 4] }],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = createEmbeddingProvider({
      provider: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      model: 'text-embedding-3-small',
      apiKey: 'sk-test',
    });
    const result = await provider.embedDocuments(['a', 'b']);

    expect(result).toEqual([[1, 2], [3, 4]]);
  });

  it('throws a descriptive error when the embedding request fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 500, statusText: 'Internal Server Error' }),
    );

    const provider = createEmbeddingProvider({
      provider: 'ollama',
      baseUrl: 'http://localhost:11434',
      model: 'bge-m3',
    });

    await expect(provider.embedQuery('hello')).rejects.toThrow('500');
  });
});
