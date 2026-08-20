import { vi } from 'vitest';
import path from 'node:path';
import { tmpdir } from 'node:os';

/**
 * Shared `AppDeps` stub for the route tests — every route file needs the full
 * dependency object even when it only exercises one endpoint, so it lives in
 * one place instead of being copy-pasted per file.
 *
 * `embeddingCredentials`/`chatCredentials` default to a plain `get()`-only stub (ollama,
 * localhost:11434, model `bge-m3`/`llama3`) — routes resolve a REAL `EmbeddingProvider` via
 * `resolveEmbeddingProvider(deps)`/a real chat completion fetch from whatever `get()` returns, so
 * any test that reaches those code paths must stub `global.fetch` to match.
 */
export function baseDeps(overrides: Record<string, unknown> = {}): any {
  return {
    registry: { list: vi.fn().mockReturnValue([]), find: vi.fn(), register: vi.fn(), remove: vi.fn() },
    qdrantClient: {},
    qdrantUrl: 'http://localhost:6333',
    qdrantCollection: 'ragbuddy_documents',
    embeddingCredentials: {
      get: vi.fn().mockReturnValue({ provider: 'ollama', baseUrl: 'http://localhost:11434', model: 'bge-m3' }),
      list: vi.fn(),
      getRawApiKey: vi.fn(),
      add: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
      setActive: vi.fn(),
    },
    ragTopK: 5,
    chatCredentials: {
      get: vi.fn().mockReturnValue({ provider: 'ollama', baseUrl: 'http://localhost:11434', model: 'llama3' }),
      list: vi
        .fn()
        .mockReturnValue({
          credentials: [
            { id: 'default', name: 'Default', provider: 'ollama', baseUrl: 'http://localhost:11434', apiKeyConfigured: false, models: ['llama3'] },
          ],
          activeCredentialId: 'default',
          activeModel: 'llama3',
        }),
      getRawApiKey: vi.fn(),
      add: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
      setActive: vi.fn(),
    },
    chatContextLimit: 10,
    staticDir: '/tmp/does-not-matter',
    dataDir: path.join(tmpdir(), 'ragbuddy-test-data-does-not-exist'),
    history: { append: vi.fn(), list: vi.fn().mockReturnValue([]) },
    statsStore: { get: vi.fn().mockReturnValue(undefined), set: vi.fn(), remove: vi.fn() },
    chatFeedback: { append: vi.fn().mockReturnValue({ id: 'feedback-1' }), list: vi.fn().mockReturnValue([]) },
    apiKeyStore: {
      get: vi.fn().mockReturnValue(undefined),
      isConfigured: vi.fn().mockReturnValue(false),
      generate: vi.fn().mockReturnValue('generated-key'),
      remove: vi.fn(),
    },
    dashboardAuthStore: {
      isEnabled: vi.fn().mockReturnValue(false),
      enable: vi.fn().mockReturnValue('generated-session-token'),
      disable: vi.fn(),
      changeCode: vi.fn(),
      login: vi.fn().mockReturnValue(null),
      logout: vi.fn(),
      validateSession: vi.fn().mockReturnValue(false),
    },
    runtime: {
      nodePath: '/usr/bin/node',
      cliEntrypoint: '/opt/ragbuddy/dist/cli/index.js',
      projectRegistryPath: '/opt/ragbuddy/config/projects.json',
    },
    ...overrides,
  };
}
