import type { ProjectRegistry } from '../projects/project-registry';
import type { ProjectConfig } from '../projects/project-types';

export interface AskAnswer {
  answer: string;
  sources: { file: string; section: string; score: number }[];
  /** Set only when retrieval itself failed — the answer still came back, just without context. */
  ragError?: string;
}

export interface RunAskDeps {
  registry: ProjectRegistry;
  ask: (project: ProjectConfig, query: string) => Promise<AskAnswer>;
}

export interface RunAskResult extends AskAnswer {
  projectName: string;
  query: string;
}

export async function runAskCommand(projectId: string, query: string, deps: RunAskDeps): Promise<RunAskResult> {
  const project = deps.registry.find(projectId);
  if (!project) {
    throw new Error(`Project "${projectId}" is not registered`);
  }
  const trimmedQuery = query.trim();
  const result = await deps.ask(project, trimmedQuery);
  return { ...result, projectName: project.name, query: trimmedQuery };
}
