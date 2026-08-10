export interface EmbeddingProvider {
  embedDocuments(texts: string[]): Promise<number[][]>;
  embedQuery(text: string): Promise<number[]>;
}

export interface EmbeddingConfig {
  provider: 'ollama' | 'openai';
  baseUrl: string;
  model: string;
  apiKey?: string;
}

// ponytail: fixed concurrency/timeout, make configurable via EmbeddingConfig if a real workload needs tuning.
// Concurrency lowered from 5: a local Ollama instance serving 5 parallel /api/embeddings
// calls for a heavier model (e.g. bge-m3) has been observed to run out of resources and
// return 500s mid-batch — 2 is gentler on a single local server.
export const EMBEDDING_CONCURRENCY = 2;
export const EMBEDDING_TIMEOUT_MS = 30_000;
const OLLAMA_MAX_RETRIES = 2;
const OLLAMA_RETRY_BASE_DELAY_MS = 500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const current = nextIndex++;
      results[current] = await fn(items[current]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

class OllamaEmbeddingProvider implements EmbeddingProvider {
  constructor(private readonly config: EmbeddingConfig) {}

  embedDocuments(texts: string[]): Promise<number[][]> {
    return mapWithConcurrency(texts, EMBEDDING_CONCURRENCY, (text) => this.embedOne(text));
  }

  embedQuery(text: string): Promise<number[]> {
    return this.embedOne(text);
  }

  private async embedOne(text: string): Promise<number[]> {
    let res: Response;
    for (let attempt = 0; ; attempt++) {
      res = await fetch(`${this.config.baseUrl}/api/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: this.config.model, prompt: text }),
        signal: AbortSignal.timeout(EMBEDDING_TIMEOUT_MS),
      });
      // Only retry 5xx — a genuinely transient server-side failure (Ollama running low on
      // resources under load). A 4xx means the request itself is wrong; retrying won't help.
      if (res.ok || res.status < 500 || attempt >= OLLAMA_MAX_RETRIES) break;
      await sleep(OLLAMA_RETRY_BASE_DELAY_MS * 2 ** attempt);
    }
    if (!res.ok) {
      throw new Error(`Ollama embedding request failed: ${res.status} ${res.statusText}`);
    }
    const data = (await res.json()) as { embedding: number[] };
    return data.embedding;
  }
}

class OpenAICompatibleEmbeddingProvider implements EmbeddingProvider {
  constructor(private readonly config: EmbeddingConfig) {}

  async embedDocuments(texts: string[]): Promise<number[][]> {
    const res = await this.request(texts);
    return res.data.map((item) => item.embedding);
  }

  async embedQuery(text: string): Promise<number[]> {
    const res = await this.request([text]);
    return res.data[0].embedding;
  }

  private async request(input: string[]): Promise<{ data: { embedding: number[] }[] }> {
    const res = await fetch(`${this.config.baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.config.apiKey ? { Authorization: `Bearer ${this.config.apiKey}` } : {}),
      },
      body: JSON.stringify({ model: this.config.model, input }),
      signal: AbortSignal.timeout(EMBEDDING_TIMEOUT_MS),
    });
    if (!res.ok) {
      throw new Error(`Embedding request failed: ${res.status} ${res.statusText}`);
    }
    return (await res.json()) as { data: { embedding: number[] }[] };
  }
}

export function createEmbeddingProvider(config: EmbeddingConfig): EmbeddingProvider {
  if (config.provider === 'ollama') return new OllamaEmbeddingProvider(config);
  if (config.provider === 'openai') return new OpenAICompatibleEmbeddingProvider(config);
  throw new Error(`Unknown embedding provider: ${config.provider}`);
}
