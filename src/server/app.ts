import express, { type Express } from 'express';
import path from 'node:path';
import type { QdrantClient } from '@qdrant/js-client-rest';
import type { ProjectRegistry } from '../projects/project-registry';
import type { EmbeddingProvider } from '../embedding/embedding-provider';
import { registerProjectsRoutes } from './routes/projects';
import { registerKnowledgeRoutes } from './routes/knowledge';
import { registerSearchRoutes } from './routes/search';
import { registerHookRoutes } from './routes/hook';

export interface AppDeps {
  registry: ProjectRegistry;
  qdrantClient: QdrantClient;
  qdrantUrl: string;
  qdrantCollection: string;
  embeddingProvider: EmbeddingProvider;
  ragTopK: number;
  staticDir: string;
}

export function createApp(deps: AppDeps): Express {
  const app = express();
  app.use(express.json());

  const apiRouter = express.Router();
  registerProjectsRoutes(apiRouter, deps);
  registerKnowledgeRoutes(apiRouter, deps);
  registerSearchRoutes(apiRouter, deps);
  registerHookRoutes(apiRouter, deps);
  app.use('/api/projects', apiRouter);

  app.use(express.static(deps.staticDir));
  // Express 5 no longer accepts a bare '*' route pattern for a catch-all —
  // a path-less middleware matches everything and sidesteps that entirely.
  app.use((_req, res) => {
    res.sendFile(path.join(deps.staticDir, 'index.html'));
  });

  return app;
}
