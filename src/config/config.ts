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
    qdrantCollection: env.QDRANT_COLLECTION ?? 'project_rag_documents',
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
  };
}

function requireVar(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}
