import type { Router } from 'express';
import { type AppDeps, resolveEmbeddingProvider } from '../app';
import { indexProject } from '../../ingestion/indexer';
import { recordRun } from '../../history/sync-history';
import { startSse, sendSseEvent } from '../sse';

export function registerIngestRoutes(router: Router, deps: AppDeps): void {
  router.post('/:id/ingest', async (req, res) => {
    const project = deps.registry.find(req.params.id);
    if (!project) {
      res.status(404).json({ error: `Project "${req.params.id}" is not registered` });
      return;
    }
    startSse(res);
    try {
      const result = await recordRun(
        deps.history,
        { project: project.id, kind: 'ingest', trigger: 'web' },
        () =>
          indexProject(project, {
            qdrantClient: deps.qdrantClient,
            qdrantUrl: deps.qdrantUrl,
            qdrantCollection: deps.qdrantCollection,
            embeddingProvider: resolveEmbeddingProvider(deps),
            onLog: (message) => sendSseEvent(res, 'log', message),
            statsStore: deps.statsStore,
          }),
        (r) => ({ filesIndexed: r.filesIndexed, chunksIndexed: r.chunksIndexed }),
      );
      sendSseEvent(res, 'done', result);
    } catch (error) {
      sendSseEvent(res, 'error', { message: error instanceof Error ? error.message : String(error) });
    }
    res.end();
  });
}
