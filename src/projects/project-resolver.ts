import path from 'node:path';
import type { ProjectRegistry } from './project-registry';
import type { ProjectConfig } from './project-types';

export function resolveProject(
  registry: ProjectRegistry,
  cwd: string,
  explicitProjectId?: string,
): ProjectConfig {
  if (explicitProjectId) {
    const project = registry.find(explicitProjectId);
    if (!project) {
      throw new Error(`Project "${explicitProjectId}" is not registered`);
    }
    return project;
  }

  const resolvedCwd = path.resolve(cwd);
  const matches = registry.list().filter((project) => {
    const repositoryRoot = path.resolve(project.repository);
    return resolvedCwd === repositoryRoot || resolvedCwd.startsWith(repositoryRoot + path.sep);
  });

  if (matches.length === 0) {
    throw new Error(
      `No registered project found for the current directory (${cwd}). Pass an explicit "project" argument.`,
    );
  }
  if (matches.length > 1) {
    throw new Error(
      `Ambiguous project for the current directory (${cwd}): matches ${matches
        .map((m) => m.id)
        .join(', ')}. Pass an explicit "project" argument.`,
    );
  }
  return matches[0];
}
