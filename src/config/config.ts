import path from 'node:path';

export interface AppConfig {
  qdrantUrl: string;
  qdrantCollection: string;
  embeddingProvider: 'ollama' | 'openai';
  embeddingBaseUrl: string;
  embeddingModel: string;
  embeddingApiKey?: string;
  ragTopK: number;
  projectRegistryPath: string;
  /** Where the Settings page's editable chat provider/base URL/model/API key override lives. */
  chatSettingsPath: string;
  /** Writable state that is not configuration: sync history + uploaded documents. */
  dataDir: string;
  /** Chat model id used by the per-project chat endpoint. */
  chatModel: string;
  /** Max chat messages kept verbatim; older ones are auto-summarized. */
  chatContextLimit: number;
}

const DEFAULT_EMBEDDING_BASE_URL: Record<string, string> = {
  ollama: 'http://localhost:11434',
  openai: 'https://api.openai.com/v1',
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const qdrantUrl = requireVar(env, 'QDRANT_URL');
  const embeddingProvider = requireVar(env, 'EMBEDDING_PROVIDER');
  if (embeddingProvider !== 'ollama' && embeddingProvider !== 'openai') {
    throw new Error(`Unknown EMBEDDING_PROVIDER: ${embeddingProvider}`);
  }
  const embeddingModel = requireVar(env, 'EMBEDDING_MODEL');

  return {
    qdrantUrl,
    qdrantCollection: env.QDRANT_COLLECTION ?? 'ragbuddy_documents',
    embeddingProvider,
    embeddingBaseUrl: env.EMBEDDING_BASE_URL ?? DEFAULT_EMBEDDING_BASE_URL[embeddingProvider],
    embeddingModel,
    embeddingApiKey: env.EMBEDDING_API_KEY,
    ragTopK: env.RAG_TOP_K ? Number(env.RAG_TOP_K) : 5,
    // Resolved against this file's own location, not process.cwd() — the git
    // post-commit hook (and any other caller) may run with cwd set to a
    // different repo entirely, so a cwd-relative default would silently
    // point at the wrong (or a nonexistent) registry file there.
    projectRegistryPath: path.resolve(__dirname, '../../', env.PROJECT_REGISTRY_PATH ?? './config/projects.json'),
    chatSettingsPath: path.resolve(__dirname, '../../', env.CHAT_SETTINGS_PATH ?? './config/chat-settings.json'),
    // Same cwd-independence rule as the registry path above.
    dataDir: path.resolve(__dirname, '../../', env.RAGBUDDY_DATA_DIR ?? './data'),
    chatModel: embeddingProvider === 'openai' ? (env.CHAT_MODEL ?? 'gpt-4o-mini') : (env.CHAT_MODEL ?? 'llama3'),
    chatContextLimit: env.CHAT_CONTEXT_LIMIT ? (Number.isNaN(Number(env.CHAT_CONTEXT_LIMIT)) ? 10 : Number(env.CHAT_CONTEXT_LIMIT)) : 10,
  };
}

function requireVar(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}
