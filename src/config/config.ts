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
  /** Where the Settings page's editable chat provider/base URL/model/API key credentials live. */
  chatSettingsPath: string;
  /** Where the Settings page's editable embedding provider/base URL/model/API key credentials live. */
  embeddingCredentialsPath: string;
  /** Writable state that is not configuration: sync history + uploaded documents. */
  dataDir: string;
  /** Chat model id used by the per-project chat endpoint. */
  chatModel: string;
  /** Max chat messages kept verbatim; older ones are auto-summarized. */
  chatContextLimit: number;
  /** Origins allowed to call the API cross-origin (browser CORS). Empty = no CORS headers sent
   *  (current same-origin/localhost behavior, unchanged). `'*'` allows any origin. */
  allowedOrigins: string[];
  /** Seeds `ApiKeyStore` on first read only — once a key is generated/removed via the Settings
   *  page, `apiKeyStorePath` is the source of truth and this is ignored. Unset (default) keeps
   *  the existing no-auth local-trust-model behavior. */
  apiKey?: string;
  /** Where the Settings page's generated/removed API key is persisted. */
  apiKeyStorePath: string;
  /** Where the Settings page's dashboard-login enable/disable/change-code state is persisted.
   *  No env seed — the Settings page is the only way to configure this (unlike the API key). */
  dashboardAuthStorePath: string;
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
    embeddingCredentialsPath: path.resolve(
      __dirname,
      '../../',
      env.EMBEDDING_CREDENTIALS_PATH ?? './config/embedding-credentials.json',
    ),
    // Same cwd-independence rule as the registry path above.
    dataDir: path.resolve(__dirname, '../../', env.RAGBUDDY_DATA_DIR ?? './data'),
    chatModel: embeddingProvider === 'openai' ? (env.CHAT_MODEL ?? 'gpt-4o-mini') : (env.CHAT_MODEL ?? 'llama3'),
    chatContextLimit: env.CHAT_CONTEXT_LIMIT ? (Number.isNaN(Number(env.CHAT_CONTEXT_LIMIT)) ? 10 : Number(env.CHAT_CONTEXT_LIMIT)) : 10,
    allowedOrigins: (env.RAGBUDDY_ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
    apiKey: env.RAGBUDDY_API_KEY || undefined,
    apiKeyStorePath: path.resolve(__dirname, '../../', env.API_KEY_STORE_PATH ?? './config/api-key.json'),
    dashboardAuthStorePath: path.resolve(
      __dirname,
      '../../',
      env.DASHBOARD_AUTH_STORE_PATH ?? './config/dashboard-auth.json',
    ),
  };
}

function requireVar(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}
