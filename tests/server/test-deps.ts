import { vi } from 'vitest';
import path from 'node:path';
import { tmpdir } from 'node:os';

/**
 * Shared `AppDeps` stub for the route tests — every route file needs the full
 * dependency object even when it only exercises one endpoint, so it lives in
 * one place instead of being copy-pasted per file.
 */
export function baseDeps(overrides: Record<string, unknown> = {}): any {
  return {
    registry: { list: vi.fn().mockReturnValue([]), find: vi.fn(), register: vi.fn(), remove: vi.fn() },
    qdrantClient: {},
    qdrantUrl: 'http://localhost:6333',
    qdrantCollection: 'ragbuddy_documents',
    embeddingProvider: { embedQuery: vi.fn(), embedDocuments: vi.fn() },
    ragTopK: 5,
    chatSettings: {
      get: vi.fn().mockReturnValue({ provider: 'ollama', baseUrl: 'http://localhost:11434', model: 'llama3' }),
      getPublic: vi
        .fn()
        .mockReturnValue({ provider: 'ollama', baseUrl: 'http://localhost:11434', model: 'llama3', apiKeyConfigured: false }),
      save: vi.fn(),
    },
    chatContextLimit: 10,
    staticDir: '/tmp/does-not-matter',
    dataDir: path.join(tmpdir(), 'ragbuddy-test-data-does-not-exist'),
    history: { append: vi.fn(), list: vi.fn().mockReturnValue([]) },
    runtime: {
      nodePath: '/usr/bin/node',
      cliEntrypoint: '/opt/ragbuddy/dist/cli/index.js',
      embeddingProvider: 'ollama',
      embeddingModel: 'bge-m3',
      embeddingBaseUrl: 'http://localhost:11434',
      embeddingApiKeyConfigured: false,
      projectRegistryPath: '/opt/ragbuddy/config/projects.json',
    },
    ...overrides,
  };
}
