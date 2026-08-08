import type { ProjectRegistry } from '../projects/project-registry';
import type { ProjectConfig } from '../projects/project-types';
import type { SyncResult } from '../ingestion/sync';

export interface RunSyncDeps {
  registry: ProjectRegistry;
  sync: (project: ProjectConfig) => Promise<SyncResult>;
}

export interface RunSyncResult extends SyncResult {
  projectName: string;
}

export async function runSyncCommand(
  projectId: string,
  deps: RunSyncDeps,
): Promise<RunSyncResult> {
  const project = deps.registry.find(projectId);
  if (!project) {
    throw new Error(`Project "${projectId}" is not registered`);
  }
  const result = await deps.sync(project);
  return { ...result, projectName: project.name };
}
