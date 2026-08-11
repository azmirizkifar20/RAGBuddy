/** Called as each unit of work finishes — one call per text for Ollama, one per batch for
 *  the OpenAI-compatible provider (which embeds up to 100 texts in a single request). */
export type EmbedProgress = (done: number, total: number) => void;

export interface EmbeddingProvider {
  embedDocuments(texts: string[], onProgress?: EmbedProgress): Promise<number[][]>;
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
// A 500 for a large input is far more often Ollama/llama.cpp's batch-size ceiling
// (`num_batch`, default 2048 tokens) than a genuine transient failure — our chunker only
// estimates tokens from char count (init.md §8's ~4 chars/token rule of thumb), which
// undercounts dense content (code, CJK, heavy punctuation), so a max-size chunk can still
// tokenize past the limit. Ollama's error wording isn't a stable contract to parse (the
// internal engine log and the HTTP response body aren't guaranteed to match), so rather than
// pattern-match the message, any large-enough input just gets split in half and the two
// halves' embeddings mean-pooled — correct either way: if it really was too large, splitting
// fixes it; if the failure was something else transient, retrying with smaller prompts still
// gives it a better shot than resending the identical oversized payload.
const OLLAMA_SPLIT_THRESHOLD_CHARS = 800;
const OLLAMA_MAX_SPLIT_DEPTH = 4;

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

  embedDocuments(texts: string[], onProgress?: EmbedProgress): Promise<number[][]> {
    let done = 0;
    return mapWithConcurrency(texts, EMBEDDING_CONCURRENCY, async (text) => {
      const vector = await this.embedOne(text);
      onProgress?.(++done, texts.length);
      return vector;
    });
  }

  embedQuery(text: string): Promise<number[]> {
    return this.embedOne(text);
  }

  private async embedOne(text: string, splitDepth = 0): Promise<number[]> {
    let res: Response;
    for (let attempt = 0; ; attempt++) {
      res = await fetch(`${this.config.baseUrl}/api/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: this.config.model, prompt: text }),
        signal: AbortSignal.timeout(EMBEDDING_TIMEOUT_MS),
      });
      if (res.ok) break;
      if (res.status >= 500) {
        if (splitDepth < OLLAMA_MAX_SPLIT_DEPTH && text.length > OLLAMA_SPLIT_THRESHOLD_CHARS) {
          return this.embedSplit(text, splitDepth);
        }
        // Already small — a 500 here is a genuinely transient server-side failure, not a
        // batch-size ceiling. Retry with backoff.
        if (attempt < OLLAMA_MAX_RETRIES) {
          await sleep(OLLAMA_RETRY_BASE_DELAY_MS * 2 ** attempt);
          continue;
        }
      }
      // A 4xx means the request itself is wrong; retrying never helps.
      break;
    }
    if (!res.ok) {
      throw new Error(`Ollama embedding request failed: ${res.status} ${res.statusText}`);
    }
    const data = (await res.json()) as { embedding: number[] };
    return data.embedding;
  }

  /** Recovery for an input too large for Ollama's batch size: split in half and mean-pool. */
  private async embedSplit(text: string, splitDepth: number): Promise<number[]> {
    const mid = Math.floor(text.length / 2);
    const [a, b] = await Promise.all([
      this.embedOne(text.slice(0, mid), splitDepth + 1),
      this.embedOne(text.slice(mid), splitDepth + 1),
    ]);
    return a.map((value, i) => (value + b[i]) / 2);
  }
}

// Some OpenAI-compatible proxies front Gemini, whose BatchEmbedContentsRequest caps at 100
// items per batch — a file with more chunks than this sent as one `input` array 400s. 100 is
// also safely under every other provider's own batch cap, so splitting unconditionally is safe.
const OPENAI_MAX_BATCH_SIZE = 100;
const OPENAI_MAX_RETRIES = 4;
const OPENAI_RETRY_BASE_DELAY_MS = 1000;

/** Retry-After is usually a whole number of seconds; ignore anything else (e.g. an HTTP date). */
function parseRetryAfterMs(header: string | null | undefined): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : undefined;
}

class OpenAICompatibleEmbeddingProvider implements EmbeddingProvider {
  constructor(private readonly config: EmbeddingConfig) {}

  async embedDocuments(texts: string[], onProgress?: EmbedProgress): Promise<number[][]> {
    const results: number[][] = [];
    for (let i = 0; i < texts.length; i += OPENAI_MAX_BATCH_SIZE) {
      const res = await this.request(texts.slice(i, i + OPENAI_MAX_BATCH_SIZE));
      results.push(...res.data.map((item) => item.embedding));
      onProgress?.(results.length, texts.length);
    }
    return results;
  }

  async embedQuery(text: string): Promise<number[]> {
    const res = await this.request([text]);
    return res.data[0].embedding;
  }

  private async request(input: string[]): Promise<{ data: { embedding: number[] }[] }> {
    let res: Response;
    for (let attempt = 0; ; attempt++) {
      res = await fetch(`${this.config.baseUrl}/embeddings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.config.apiKey ? { Authorization: `Bearer ${this.config.apiKey}` } : {}),
        },
        body: JSON.stringify({ model: this.config.model, input }),
        signal: AbortSignal.timeout(EMBEDDING_TIMEOUT_MS),
      });
      if (res.ok) break;
      // 429 (rate limit) and 5xx (transient server error) are worth retrying with backoff — a
      // 4xx other than 429 means the request itself is wrong, not something waiting out helps.
      const retryable = res.status === 429 || res.status >= 500;
      if (!retryable || attempt >= OPENAI_MAX_RETRIES) break;
      const retryAfterMs = parseRetryAfterMs(res.headers?.get?.('retry-after'));
      await sleep(retryAfterMs ?? OPENAI_RETRY_BASE_DELAY_MS * 2 ** attempt);
    }
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
