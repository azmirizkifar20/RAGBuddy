import express, { type Express } from 'express';
import path from 'node:path';
import type { QdrantClient } from '@qdrant/js-client-rest';
import type { ProjectRegistry } from '../projects/project-registry';
import type { EmbeddingProvider } from '../embedding/embedding-provider';
import type { SyncHistoryStore } from '../history/sync-history';
import type { ChatSettingsStore } from '../config/chat-settings-store';
import { registerProjectsRoutes } from './routes/projects';
import { registerSettingsRoutes } from './routes/settings';
import { registerKnowledgeRoutes } from './routes/knowledge';
import { registerSearchRoutes } from './routes/search';
import { registerChatRoutes } from './routes/chat';
import { registerHookRoutes } from './routes/hook';
import { registerIngestRoutes } from './routes/ingest';
import { registerSyncRoutes } from './routes/sync';
import { registerUploadRoutes } from './routes/uploads';
import { registerHistoryRoutes } from './routes/history';
import { registerFsRoutes } from './routes/fs';

/** Everything the MCP setup page needs to print a copy-pasteable config. Never includes the API key. */
export interface RuntimeInfo {
  nodePath: string;
  cliEntrypoint: string;
  embeddingProvider: string;
  embeddingModel: string;
  embeddingBaseUrl: string;
  embeddingApiKeyConfigured: boolean;
  projectRegistryPath: string;
}

export interface AppDeps {
  registry: ProjectRegistry;
  qdrantClient: QdrantClient;
  qdrantUrl: string;
  qdrantCollection: string;
  embeddingProvider: EmbeddingProvider;
  embeddingBaseUrl: string;
  embeddingApiKey?: string;
  ragTopK: number;
  chatSettings: ChatSettingsStore;
  chatContextLimit: number;
  staticDir: string;
  dataDir: string;
  history: SyncHistoryStore;
  runtime: RuntimeInfo;
}

export function createApp(deps: AppDeps): Express {
  const app = express();
  // Uploaded documents are posted as JSON (binary formats base64-encoded, so
  // ~1.33x their real size), which makes this limit the real ceiling on
  // document size rather than the 100kb default.
  app.use(express.json({ limit: '32mb' }));

  const apiRouter = express.Router();
  registerProjectsRoutes(apiRouter, deps);
  registerKnowledgeRoutes(apiRouter, deps);
  registerSearchRoutes(apiRouter, deps);
  registerChatRoutes(apiRouter, deps);
  registerHookRoutes(apiRouter, deps);
  registerIngestRoutes(apiRouter, deps);
  registerSyncRoutes(apiRouter, deps);
  registerUploadRoutes(apiRouter, deps);
  registerHistoryRoutes(apiRouter, deps);
  app.use('/api/projects', apiRouter);

  const fsRouter = express.Router();
  registerFsRoutes(fsRouter);
  app.use('/api/fs', fsRouter);

  const settingsRouter = express.Router();
  registerSettingsRoutes(settingsRouter, deps);
  app.use('/api/settings', settingsRouter);

  app.get('/api/config', (_req, res) => {
    res.json({
      qdrantUrl: deps.qdrantUrl,
      qdrantCollection: deps.qdrantCollection,
      ragTopK: deps.ragTopK,
      chatContextLimit: deps.chatContextLimit,
      dataDir: deps.dataDir,
      ...deps.runtime,
    });
  });

  app.get('/api/activity', (req, res) => {
    const limit = Number(req.query.limit);
    res.json({ runs: deps.history.list({ limit: Number.isFinite(limit) && limit > 0 ? Math.min(limit, 200) : 20 }) });
  });

  app.use(express.static(deps.staticDir));
  // Express 5 no longer accepts a bare '*' route pattern for a catch-all —
  // a path-less middleware matches everything and sidesteps that entirely.
  app.use((_req, res) => {
    res.sendFile(path.join(deps.staticDir, 'index.html'));
  });

  return app;
}
