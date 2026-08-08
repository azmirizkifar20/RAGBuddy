import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { ProjectConfig } from '../projects/project-types';

export function getProjectDocument(project: ProjectConfig, file: string): string {
  const resolvedRoot = path.resolve(project.repository);
  const resolvedTarget = path.resolve(project.repository, file);
  if (resolvedTarget !== resolvedRoot && !resolvedTarget.startsWith(resolvedRoot + path.sep)) {
    throw new Error(`File path escapes repository root: ${file}`);
  }

  const relativePath = path.relative(resolvedRoot, resolvedTarget).split(path.sep).join('/');
  const withinConfiguredPath = project.paths.some((configuredPath) => {
    const prefix = configuredPath.endsWith('/') ? configuredPath : `${configuredPath}/`;
    return relativePath === configuredPath || relativePath.startsWith(prefix);
  });
  if (!withinConfiguredPath) {
    throw new Error(`File is outside the project's configured documentation paths: ${file}`);
  }

  if (!existsSync(resolvedTarget)) {
    throw new Error(`File not found: ${file}`);
  }

  return readFileSync(resolvedTarget, 'utf8');
}
