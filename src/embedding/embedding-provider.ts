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

class OllamaEmbeddingProvider implements EmbeddingProvider {
  constructor(private readonly config: EmbeddingConfig) {}

  embedDocuments(texts: string[]): Promise<number[][]> {
    return Promise.all(texts.map((text) => this.embedOne(text)));
  }

  embedQuery(text: string): Promise<number[]> {
    return this.embedOne(text);
  }

  private async embedOne(text: string): Promise<number[]> {
    const res = await fetch(`${this.config.baseUrl}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.config.model, prompt: text }),
    });
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
