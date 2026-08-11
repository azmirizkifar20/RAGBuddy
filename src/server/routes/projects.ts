import type { Router } from 'express';
import type { AppDeps } from '../app';
import { computeProjectDataStats } from '../../qdrant/qdrant-repository';
import type { ProjectStats } from '../../projects/project-stats';
import { isHookInstalled } from '../../git/hook-installer';
import { runProjectRegister, runProjectList, runProjectRemove } from '../../cli/project-command';

/** Cache-first: a project that has never been ingested/synced/uploaded to since this cache was
 *  introduced has no entry yet, so this falls back to computing (and caching) it once — every
 *  read after that is a local JSON lookup instead of a full Qdrant collection scroll. */
async function getProjectStats(deps: AppDeps, projectId: string): Promise<ProjectStats> {
  const cached = deps.statsStore.get(projectId);
  if (cached) return cached;
  const stats: ProjectStats = {
    ...(await computeProjectDataStats(deps.qdrantClient, deps.qdrantCollection, projectId)),
    updatedAt: new Date().toISOString(),
  };
  deps.statsStore.set(projectId, stats);
  return stats;
}

export function registerProjectsRoutes(router: Router, deps: AppDeps): void {
  router.get('/', async (_req, res) => {
    try {
      const projects = runProjectList(deps.registry);
      const result = await Promise.all(
        projects.map(async (p) => {
          const stats = await getProjectStats(deps, p.id);
          return {
            id: p.id,
            name: p.name,
            repository: p.repository,
            paths: p.paths,
            indexedFileCount: stats.indexedFileCount,
            chunkCount: stats.chunkCount,
            uploadCount: stats.uploadCount,
            hookInstalled: isHookInstalled(p.repository),
            lastRunAt: deps.history.list({ project: p.id, limit: 1 })[0]?.startedAt ?? null,
          };
        }),
      );
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  router.get('/:id', async (req, res) => {
    const project = deps.registry.find(req.params.id);
    if (!project) {
      res.status(404).json({ error: `Project "${req.params.id}" is not registered` });
      return;
    }
    try {
      const stats = await getProjectStats(deps, project.id);
      res.json({
        id: project.id,
        name: project.name,
        repository: project.repository,
        paths: project.paths,
        indexedFileCount: stats.indexedFileCount,
        chunkCount: stats.chunkCount,
        uploadCount: stats.uploadCount,
        hookInstalled: isHookInstalled(project.repository),
        lastRunAt: deps.history.list({ project: project.id, limit: 1 })[0]?.startedAt ?? null,
      });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
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
