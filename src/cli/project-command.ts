import type { ProjectRegistry } from '../projects/project-registry';
import type { ProjectConfig } from '../projects/project-types';

export interface RunProjectRegisterInput {
  id: string;
  repository: string;
  name?: string;
  paths?: string[];
}

export function runProjectRegister(registry: ProjectRegistry, input: RunProjectRegisterInput): ProjectConfig {
  return registry.register(input.id, input.repository, { name: input.name, paths: input.paths });
}

export function runProjectList(registry: ProjectRegistry): ProjectConfig[] {
  return registry.list();
}

export function runProjectRemove(registry: ProjectRegistry, id: string): void {
  registry.remove(id);
}
