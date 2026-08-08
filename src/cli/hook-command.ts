import type { ProjectRegistry } from '../projects/project-registry';

export interface RunHookDeps {
  registry: ProjectRegistry;
  install: (repositoryPath: string, projectId: string) => void;
  uninstall: (repositoryPath: string) => void;
}

export interface RunHookResult {
  action: 'install' | 'uninstall';
  projectName: string;
}

export function runHookCommand(
  action: 'install' | 'uninstall',
  projectId: string,
  deps: RunHookDeps,
): RunHookResult {
  const project = deps.registry.find(projectId);
  if (!project) {
    throw new Error(`Project "${projectId}" is not registered`);
  }
  if (action === 'install') {
    deps.install(project.repository, project.id);
  } else {
    deps.uninstall(project.repository);
  }
  return { action, projectName: project.name };
}
