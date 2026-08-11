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

  it('splits a large batch into requests of at most 100 items (Gemini BatchEmbedContentsRequest cap)', async () => {
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init: any) => {
      const { input } = JSON.parse(init.body);
      return {
        ok: true,
        json: async () => ({ data: input.map((text: string) => ({ embedding: [text.length] })) }),
      };
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = createEmbeddingProvider({
      provider: 'openai',
      baseUrl: 'http://proxy.local/v1',
      model: 'gemini/gemini-embedding-2-preview',
      apiKey: 'sk-test',
    });
    const texts = Array.from({ length: 207 }, (_, i) => `chunk-${i}`);
    const result = await provider.embedDocuments(texts);

    expect(result).toHaveLength(207);
    expect(fetchMock).toHaveBeenCalledTimes(3); // 100 + 100 + 7
    const batchSizes = fetchMock.mock.calls.map(([, init]: any) => JSON.parse(init.body).input.length);
    expect(batchSizes).toEqual([100, 100, 7]);
  });

  it('retries a 429 (rate limit) with backoff, then succeeds', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 429, statusText: 'Too Many Requests', headers: { get: () => null } })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [{ embedding: [1, 2] }] }) });
    vi.stubGlobal('fetch', fetchMock);

    const provider = createEmbeddingProvider({
      provider: 'openai',
      baseUrl: 'http://proxy.local/v1',
      model: 'gemini/gemini-embedding-2-preview',
      apiKey: 'sk-test',
    });

    const pending = provider.embedQuery('hello');
    await vi.runAllTimersAsync();
    await expect(pending).resolves.toEqual([1, 2]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('honors a numeric Retry-After header on a 429 instead of the default backoff', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
        headers: { get: (name: string) => (name === 'retry-after' ? '3' : null) },
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [{ embedding: [1, 2] }] }) });
    vi.stubGlobal('fetch', fetchMock);

    const provider = createEmbeddingProvider({
      provider: 'openai',
      baseUrl: 'http://proxy.local/v1',
      model: 'gemini/gemini-embedding-2-preview',
      apiKey: 'sk-test',
    });

    const pending = provider.embedQuery('hello');
    await vi.advanceTimersByTimeAsync(3000);
    await expect(pending).resolves.toEqual([1, 2]);
    vi.useRealTimers();
  });

  it('retries a transient 5xx from the embeddings proxy, then throws once exhausted', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
      headers: { get: () => null },
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = createEmbeddingProvider({
      provider: 'openai',
      baseUrl: 'http://proxy.local/v1',
      model: 'gemini/gemini-embedding-2-preview',
      apiKey: 'sk-test',
    });

    const pending = expect(provider.embedQuery('hello')).rejects.toThrow('503');
    await vi.runAllTimersAsync();
    await pending;
    expect(fetchMock).toHaveBeenCalledTimes(5); // 1 initial + 4 retries
    vi.useRealTimers();
  });

  it('does not retry a non-429 4xx (e.g. a real bad request)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 400, statusText: 'Bad Request' });
    vi.stubGlobal('fetch', fetchMock);

    const provider = createEmbeddingProvider({
      provider: 'openai',
      baseUrl: 'http://proxy.local/v1',
      model: 'gemini/gemini-embedding-2-preview',
      apiKey: 'sk-test',
    });

    await expect(provider.embedQuery('hello')).rejects.toThrow('400');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('throws a descriptive error when the embedding request fails after exhausting retries', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = createEmbeddingProvider({
      provider: 'ollama',
      baseUrl: 'http://localhost:11434',
      model: 'bge-m3',
    });

    const pending = expect(provider.embedQuery('hello')).rejects.toThrow('500');
    await vi.runAllTimersAsync();
    await pending;
    // 1 initial attempt + 2 retries.
    expect(fetchMock).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });

  it('does not retry a 4xx (client/validation) failure', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 400, statusText: 'Bad Request' });
    vi.stubGlobal('fetch', fetchMock);

    const provider = createEmbeddingProvider({
      provider: 'ollama',
      baseUrl: 'http://localhost:11434',
      model: 'bge-m3',
    });

    await expect(provider.embedQuery('hello')).rejects.toThrow('400');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('recovers from a transient 500 on retry', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 500, statusText: 'Internal Server Error' })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ embedding: [0.1, 0.2] }) });
    vi.stubGlobal('fetch', fetchMock);

    const provider = createEmbeddingProvider({
      provider: 'ollama',
      baseUrl: 'http://localhost:11434',
      model: 'bge-m3',
    });

    const pending = provider.embedQuery('hello');
    await vi.runAllTimersAsync();
    await expect(pending).resolves.toEqual([0.1, 0.2]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('splits and mean-pools a large input on 500, without needing to parse the error body', async () => {
    // Over OLLAMA_SPLIT_THRESHOLD_CHARS (800); each half (450 chars) is under it, so it
    // succeeds after exactly one split — no reliance on Ollama's error wording at all.
    const longText = 'a'.repeat(450) + 'b'.repeat(450);
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init: any) => {
      const { prompt } = JSON.parse(init.body);
      if (prompt === longText) {
        return { ok: false, status: 500, statusText: 'Internal Server Error' };
      }
      // Each half gets embedded successfully.
      return { ok: true, json: async () => ({ embedding: prompt === longText.slice(0, 450) ? [1, 1] : [3, 3] }) };
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = createEmbeddingProvider({
      provider: 'ollama',
      baseUrl: 'http://localhost:11434',
      model: 'bge-m3',
    });

    const result = await provider.embedQuery(longText);

    expect(result).toEqual([2, 2]);
    expect(fetchMock).toHaveBeenCalledTimes(3); // original + 2 halves
  });

  it('gives up splitting past OLLAMA_MAX_SPLIT_DEPTH and falls back to retry-then-throw', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500, statusText: 'Internal Server Error' });
    vi.stubGlobal('fetch', fetchMock);

    const provider = createEmbeddingProvider({
      provider: 'ollama',
      baseUrl: 'http://localhost:11434',
      model: 'bge-m3',
    });

    // Every attempt at every split depth fails, so this proves the recursion terminates
    // (bounded by OLLAMA_MAX_SPLIT_DEPTH) instead of splitting forever.
    const pending = expect(provider.embedQuery('y'.repeat(5000))).rejects.toThrow('500');
    await vi.runAllTimersAsync();
    await pending;
    vi.useRealTimers();
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

  it('reports one onProgress tick per text for the ollama provider', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ embedding: [0.1] }) }));
    const provider = createEmbeddingProvider({ provider: 'ollama', baseUrl: 'http://localhost:11434', model: 'bge-m3' });
    const ticks: Array<[number, number]> = [];

    await provider.embedDocuments(['a', 'b', 'c'], (done, total) => ticks.push([done, total]));

    expect(ticks).toHaveLength(3);
    expect(ticks.every(([, total]) => total === 3)).toBe(true);
    expect(ticks.map(([done]) => done).sort()).toEqual([1, 2, 3]);
  });

  it('reports one onProgress tick per batch for the openai-compatible provider', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (_url: string, init: any) => {
        const { input } = JSON.parse(init.body);
        return { ok: true, json: async () => ({ data: input.map(() => ({ embedding: [0.1] })) }) };
      }),
    );
    const provider = createEmbeddingProvider({
      provider: 'openai',
      baseUrl: 'http://proxy.local/v1',
      model: 'gemini-embedding',
      apiKey: 'sk-test',
    });
    const ticks: Array<[number, number]> = [];
    const texts = Array.from({ length: 150 }, (_, i) => `chunk-${i}`);

    await provider.embedDocuments(texts, (done, total) => ticks.push([done, total]));

    expect(ticks).toEqual([[100, 150], [150, 150]]);
  });
});
