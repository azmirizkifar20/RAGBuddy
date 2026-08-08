import type { Router } from 'express';
import type { AppDeps } from '../app';
import { searchProject } from '../../retrieval/search';

export function registerSearchRoutes(router: Router, deps: AppDeps): void {
  router.post('/:id/search', async (req, res) => {
    const project = deps.registry.find(req.params.id);
    if (!project) {
      res.status(404).json({ error: `Project "${req.params.id}" is not registered` });
      return;
    }
    const query = req.body?.query;
    if (!query) {
      res.status(400).json({ error: 'query is required' });
      return;
    }
    try {
      const results = await searchProject(project.id, query, {
        qdrantClient: deps.qdrantClient,
        qdrantCollection: deps.qdrantCollection,
        embeddingProvider: deps.embeddingProvider,
        topK: deps.ragTopK,
      });
      res.json({ results });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });
}
