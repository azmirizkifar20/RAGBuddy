import type { ProjectRegistry } from '../projects/project-registry';
import type { ProjectConfig } from '../projects/project-types';
import type { SearchResult } from '../retrieval/search';

export interface RunSearchDeps {
  registry: ProjectRegistry;
  search: (project: ProjectConfig, query: string) => Promise<SearchResult[]>;
}

export interface RunSearchResult {
  projectName: string;
  query: string;
  results: SearchResult[];
}

export async function runSearchCommand(
  projectId: string,
  query: string,
  deps: RunSearchDeps,
): Promise<RunSearchResult> {
  const project = deps.registry.find(projectId);
  if (!project) {
    throw new Error(`Project "${projectId}" is not registered`);
  }
  const results = await deps.search(project, query);
  return { projectName: project.name, query, results };
}
