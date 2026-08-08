import type { Router } from 'express';
import type { AppDeps } from '../app';
import { getIndexedFileHashes } from '../../qdrant/qdrant-repository';
import { isHookInstalled } from '../../git/hook-installer';
import { runProjectRegister, runProjectList, runProjectRemove } from '../../cli/project-command';

export function registerProjectsRoutes(router: Router, deps: AppDeps): void {
  router.get('/', async (_req, res) => {
    const projects = runProjectList(deps.registry);
    const result = await Promise.all(
      projects.map(async (p) => ({
        id: p.id,
        name: p.name,
        repository: p.repository,
        paths: p.paths,
        indexedFileCount: (await getIndexedFileHashes(deps.qdrantClient, deps.qdrantCollection, p.id)).size,
        hookInstalled: isHookInstalled(p.repository),
      })),
    );
    res.json(result);
  });

  router.get('/:id', async (req, res) => {
    const project = deps.registry.find(req.params.id);
    if (!project) {
      res.status(404).json({ error: `Project "${req.params.id}" is not registered` });
      return;
    }
    const hashes = await getIndexedFileHashes(deps.qdrantClient, deps.qdrantCollection, project.id);
    res.json({
      id: project.id,
      name: project.name,
      repository: project.repository,
      paths: project.paths,
      indexedFileCount: hashes.size,
      hookInstalled: isHookInstalled(project.repository),
    });
  });

  router.post('/', (req, res) => {
    const { id, repository, name, paths } = req.body ?? {};
    if (!id || !repository) {
      res.status(400).json({ error: 'id and repository are required' });
      return;
    }
    try {
      const project = runProjectRegister(deps.registry, { id, repository, name, paths });
      res.status(201).json(project);
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  router.delete('/:id', (req, res) => {
    try {
      runProjectRemove(deps.registry, req.params.id);
      res.status(204).end();
    } catch (error) {
      res.status(404).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });
}
