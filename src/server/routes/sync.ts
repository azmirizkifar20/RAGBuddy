import type { Router } from 'express';
import type { AppDeps } from '../app';
import { syncProject } from '../../ingestion/sync';
import { recordRun } from '../../history/sync-history';
import { startSse, sendSseEvent } from '../sse';

export function registerSyncRoutes(router: Router, deps: AppDeps): void {
  router.post('/:id/sync', async (req, res) => {
    const project = deps.registry.find(req.params.id);
    if (!project) {
      res.status(404).json({ error: `Project "${req.params.id}" is not registered` });
      return;
    }
    startSse(res);
    try {
      const result = await recordRun(
        deps.history,
        { project: project.id, kind: 'sync', trigger: 'web' },
        () =>
          syncProject(project, {
            qdrantClient: deps.qdrantClient,
            qdrantUrl: deps.qdrantUrl,
            qdrantCollection: deps.qdrantCollection,
            embeddingProvider: deps.embeddingProvider,
            onLog: (message) => sendSseEvent(res, 'log', message),
          }),
        (r) => ({
          added: r.added.length,
          modified: r.modified.length,
          deleted: r.deleted.length,
          unchanged: r.unchanged.length,
        }),
      );
      sendSseEvent(res, 'done', result);
    } catch (error) {
      sendSseEvent(res, 'error', { message: error instanceof Error ? error.message : String(error) });
    }
    res.end();
  });
}
