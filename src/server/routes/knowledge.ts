import type { Router } from 'express';
import type { AppDeps } from '../app';
import { getIndexedFileHashes } from '../../qdrant/qdrant-repository';

export function registerKnowledgeRoutes(router: Router, deps: AppDeps): void {
  router.get('/:id/knowledge', async (req, res) => {
    const project = deps.registry.find(req.params.id);
    if (!project) {
      res.status(404).json({ error: `Project "${req.params.id}" is not registered` });
      return;
    }
    try {
      const hashes = await getIndexedFileHashes(deps.qdrantClient, deps.qdrantCollection, project.id);
      res.json({ files: [...hashes.keys()].sort() });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });
}
