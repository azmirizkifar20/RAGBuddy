import type { ProjectRegistry } from '../projects/project-registry';
import type { ProjectConfig } from '../projects/project-types';
import type { SyncResult } from '../ingestion/sync';

export interface SyncAllProjectResult {
  projectId: string;
  projectName: string;
  status: 'success' | 'error';
  result?: SyncResult;
  error?: string;
}

export interface RunSyncAllDeps {
  registry: ProjectRegistry;
  sync: (project: ProjectConfig) => Promise<SyncResult>;
}

/** Fallback safety net for when the git hook was never installed, got skipped, or the project was
 *  freshly re-cloned without re-running `ragbuddy hook install` — meant to be invoked periodically
 *  by an external scheduler (cron/Task Scheduler), not run by ragbuddy itself. Every registered
 *  project is synced independently: one project's failure is recorded and skipped, never aborting
 *  the rest (same resilience principle as the git hook itself never blocking the underlying
 *  commit). */
export async function runSyncAllCommand(deps: RunSyncAllDeps): Promise<SyncAllProjectResult[]> {
  const results: SyncAllProjectResult[] = [];
  for (const project of deps.registry.list()) {
    try {
      const result = await deps.sync(project);
      results.push({ projectId: project.id, projectName: project.name, status: 'success', result });
    } catch (error) {
      results.push({
        projectId: project.id,
        projectName: project.name,
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return results;
}
