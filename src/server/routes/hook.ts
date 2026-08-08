import type { Router } from 'express';
import type { AppDeps } from '../app';
import { installHook, uninstallHook } from '../../git/hook-installer';

export function registerHookRoutes(router: Router, deps: AppDeps): void {
  router.post('/:id/hook', (req, res) => {
    const project = deps.registry.find(req.params.id);
    if (!project) {
      res.status(404).json({ error: `Project "${req.params.id}" is not registered` });
      return;
    }
    try {
      installHook(project.repository, project.id);
      res.status(204).end();
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  router.delete('/:id/hook', (req, res) => {
    const project = deps.registry.find(req.params.id);
    if (!project) {
      res.status(404).json({ error: `Project "${req.params.id}" is not registered` });
      return;
    }
    uninstallHook(project.repository);
    res.status(204).end();
  });
}
