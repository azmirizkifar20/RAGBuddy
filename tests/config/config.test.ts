import path from 'node:path';
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
    expect(config.qdrantCollection).toBe('ragbuddy_documents');
    expect(config.embeddingBaseUrl).toBe('http://localhost:11434');
    expect(config.ragTopK).toBe(5);
    expect(config.projectRegistryPath).toBe(path.resolve(__dirname, '../../config/projects.json'));
  });

  it('resolves a relative PROJECT_REGISTRY_PATH against the project root, not process.cwd()', () => {
    const config = loadConfig({
      QDRANT_URL: 'http://localhost:6333',
      EMBEDDING_PROVIDER: 'ollama',
      EMBEDDING_MODEL: 'bge-m3',
      PROJECT_REGISTRY_PATH: './custom/registry.json',
    } as NodeJS.ProcessEnv);

    expect(config.projectRegistryPath).toBe(path.resolve(__dirname, '../../custom/registry.json'));
  });

  it('keeps an absolute PROJECT_REGISTRY_PATH unchanged', () => {
    const absolute = path.resolve('/tmp/somewhere/registry.json');
    const config = loadConfig({
      QDRANT_URL: 'http://localhost:6333',
      EMBEDDING_PROVIDER: 'ollama',
      EMBEDDING_MODEL: 'bge-m3',
      PROJECT_REGISTRY_PATH: absolute,
    } as NodeJS.ProcessEnv);

    expect(config.projectRegistryPath).toBe(absolute);
  });

  it('throws when a required var is missing', () => {
    expect(() =>
      loadConfig({ EMBEDDING_PROVIDER: 'ollama', EMBEDDING_MODEL: 'bge-m3' } as NodeJS.ProcessEnv),
    ).toThrow('QDRANT_URL');
  });

  it('defaults chatModel per provider when CHAT_MODEL is missing', () => {
    const ollama = loadConfig({
      QDRANT_URL: 'http://localhost:6333',
      EMBEDDING_PROVIDER: 'ollama',
      EMBEDDING_MODEL: 'bge-m3',
    } as NodeJS.ProcessEnv);
    expect(ollama.chatModel).toBe('llama3');

    const openai = loadConfig({
      QDRANT_URL: 'http://localhost:6333',
      EMBEDDING_PROVIDER: 'openai',
      EMBEDDING_MODEL: 'text-embedding-3-small',
    } as NodeJS.ProcessEnv);
    expect(openai.chatModel).toBe('gpt-4o-mini');
  });

  it('honors an explicit CHAT_MODEL', () => {
    const config = loadConfig({
      QDRANT_URL: 'http://localhost:6333',
      EMBEDDING_PROVIDER: 'ollama',
      EMBEDDING_MODEL: 'bge-m3',
      CHAT_MODEL: 'qwen2.5',
    } as NodeJS.ProcessEnv);
    expect(config.chatModel).toBe('qwen2.5');
  });

  it('parses CHAT_CONTEXT_LIMIT and defaults to 10 on invalid or missing', () => {
    const valid = loadConfig({
      QDRANT_URL: 'http://localhost:6333',
      EMBEDDING_PROVIDER: 'ollama',
      EMBEDDING_MODEL: 'bge-m3',
      CHAT_CONTEXT_LIMIT: '5',
    } as NodeJS.ProcessEnv);
    expect(valid.chatContextLimit).toBe(5);

    const invalid = loadConfig({
      QDRANT_URL: 'http://localhost:6333',
      EMBEDDING_PROVIDER: 'ollama',
      EMBEDDING_MODEL: 'bge-m3',
      CHAT_CONTEXT_LIMIT: 'not-a-number',
    } as NodeJS.ProcessEnv);
    expect(invalid.chatContextLimit).toBe(10);

    const missing = loadConfig({
      QDRANT_URL: 'http://localhost:6333',
      EMBEDDING_PROVIDER: 'ollama',
      EMBEDDING_MODEL: 'bge-m3',
    } as NodeJS.ProcessEnv);
    expect(missing.chatContextLimit).toBe(10);
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
