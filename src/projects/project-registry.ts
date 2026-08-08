import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import type { ProjectConfig, ProjectRegistryData } from './project-types';

export class ProjectRegistry {
  constructor(private readonly registryPath: string) {}

  list(): ProjectConfig[] {
    return this.load().projects;
  }

  find(id: string): ProjectConfig | undefined {
    return this.load().projects.find((p) => p.id === id);
  }

  register(
    id: string,
    repository: string,
    opts: { name?: string; paths?: string[] } = {},
  ): ProjectConfig {
    const data = this.load();
    if (!existsSync(repository)) {
      throw new Error(`Repository path does not exist: ${repository}`);
    }
    if (!existsSync(path.join(repository, '.git'))) {
      throw new Error(`Not a Git repository: ${repository}`);
    }
    if (data.projects.some((p) => p.id === id)) {
      throw new Error(`Project "${id}" is already registered`);
    }
    const project: ProjectConfig = {
      id,
      name: opts.name ?? id,
      repository,
      paths: opts.paths ?? ['docs'],
    };
    data.projects.push(project);
    this.save(data);
    return project;
  }

  remove(id: string): void {
    const data = this.load();
    const next = data.projects.filter((p) => p.id !== id);
    if (next.length === data.projects.length) {
      throw new Error(`Project "${id}" is not registered`);
    }
    this.save({ projects: next });
  }

  private load(): ProjectRegistryData {
    if (!existsSync(this.registryPath)) {
      return { projects: [] };
    }
    return JSON.parse(readFileSync(this.registryPath, 'utf8')) as ProjectRegistryData;
  }

  private save(data: ProjectRegistryData): void {
    mkdirSync(path.dirname(this.registryPath), { recursive: true });
    writeFileSync(this.registryPath, JSON.stringify(data, null, 2) + '\n', 'utf8');
  }
}
