import type { Router } from 'express';
import type { AppDeps } from '../app';

function parseLimit(raw: unknown, fallback: number): number {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.min(value, 200) : fallback;
}

export function registerHistoryRoutes(router: Router, deps: AppDeps): void {
  router.get('/:id/history', (req, res) => {
    const project = deps.registry.find(req.params.id);
    if (!project) {
      res.status(404).json({ error: `Project "${req.params.id}" is not registered` });
      return;
    }
    res.json({ runs: deps.history.list({ project: project.id, limit: parseLimit(req.query.limit, 50) }) });
  });
}
