import { describe, it, expect } from 'vitest';
import { loadConfig } from '../../src/config/config';

describe('loadConfig', () => {
  it('applies defaults when optional vars are missing', () => {
    const config = loadConfig({
      QDRANT_URL: 'http://localhost:6333',
      EMBEDDING_PROVIDER: 'ollama',
      EMBEDDING_MODEL: 'bge-m3',
    } as NodeJS.ProcessEnv);

    expect(config.qdrantUrl).toBe('http://localhost:6333');
    expect(config.qdrantCollection).toBe('project_rag_documents');
    expect(config.embeddingBaseUrl).toBe('http://localhost:11434');
    expect(config.ragTopK).toBe(5);
    expect(config.projectRegistryPath).toBe('./config/projects.json');
  });

  it('throws when a required var is missing', () => {
    expect(() =>
      loadConfig({ EMBEDDING_PROVIDER: 'ollama', EMBEDDING_MODEL: 'bge-m3' } as NodeJS.ProcessEnv),
    ).toThrow('QDRANT_URL');
  });

  it('throws on an invalid embedding provider', () => {
    expect(() =>
      loadConfig({
        QDRANT_URL: 'http://localhost:6333',
        EMBEDDING_PROVIDER: 'bogus',
        EMBEDDING_MODEL: 'bge-m3',
      } as NodeJS.ProcessEnv),
    ).toThrow('Unknown EMBEDDING_PROVIDER');
  });
});
