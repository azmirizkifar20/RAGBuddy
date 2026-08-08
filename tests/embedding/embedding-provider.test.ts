import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  createEmbeddingProvider,
  EMBEDDING_CONCURRENCY,
} from '../../src/embedding/embedding-provider';

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

  it('passes an AbortSignal timeout to fetch', async () => {
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
    await provider.embedQuery('hello');

    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });

  it('caps concurrent in-flight requests at EMBEDDING_CONCURRENCY for the ollama provider', async () => {
    let active = 0;
    let maxActive = 0;
    const fetchMock = vi.fn().mockImplementation(async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return { ok: true, json: async () => ({ embedding: [0.1, 0.2] }) };
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = createEmbeddingProvider({
      provider: 'ollama',
      baseUrl: 'http://localhost:11434',
      model: 'bge-m3',
    });
    const texts = Array.from({ length: 12 }, (_, i) => `text-${i}`);
    await provider.embedDocuments(texts);

    expect(maxActive).toBeLessThanOrEqual(EMBEDDING_CONCURRENCY);
    expect(maxActive).toBeGreaterThan(1);
    expect(fetchMock).toHaveBeenCalledTimes(12);
  });
});
