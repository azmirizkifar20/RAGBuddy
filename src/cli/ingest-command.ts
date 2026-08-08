import type { ProjectRegistry } from '../projects/project-registry';
import type { ProjectConfig } from '../projects/project-types';
import type { IndexProjectResult } from '../ingestion/indexer';

export interface RunIngestDeps {
  registry: ProjectRegistry;
  index: (project: ProjectConfig) => Promise<IndexProjectResult>;
}

export interface RunIngestResult extends IndexProjectResult {
  projectName: string;
}

export async function runIngestCommand(
  projectId: string,
  deps: RunIngestDeps,
): Promise<RunIngestResult> {
  const project = deps.registry.find(projectId);
  if (!project) {
    throw new Error(`Project "${projectId}" is not registered`);
  }
  const result = await deps.index(project);
  return { ...result, projectName: project.name };
}
