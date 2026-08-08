import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ProjectRegistry } from '../../src/projects/project-registry';
import { resolveProject } from '../../src/projects/project-resolver';

describe('resolveProject', () => {
  let dir: string;
  let registry: ProjectRegistry;
  let repoA: string;
  let repoB: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'project-rag-resolver-'));
    repoA = path.join(dir, 'repo-a');
    repoB = path.join(dir, 'repo-b');
    mkdirSync(path.join(repoA, '.git'), { recursive: true });
    mkdirSync(path.join(repoB, '.git'), { recursive: true });
    registry = new ProjectRegistry(path.join(dir, 'projects.json'));
    registry.register('project-a', repoA);
    registry.register('project-b', repoB);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('resolves the project whose repository contains the cwd', () => {
    const project = resolveProject(registry, repoA, undefined);
    expect(project.id).toBe('project-a');
  });

  it('resolves correctly from a subdirectory of the repository', () => {
    const subdir = path.join(repoB, 'docs', 'features');
    mkdirSync(subdir, { recursive: true });
    const project = resolveProject(registry, subdir, undefined);
    expect(project.id).toBe('project-b');
  });

  it('prefers an explicit project id over cwd resolution', () => {
    const project = resolveProject(registry, repoB, 'project-a');
    expect(project.id).toBe('project-a');
  });

  it('throws a clear error for an unregistered explicit project id', () => {
    expect(() => resolveProject(registry, repoA, 'missing')).toThrow('is not registered');
  });

  it('throws a clear error when cwd matches no registered project', () => {
    const outside = path.join(dir, 'outside');
    mkdirSync(outside, { recursive: true });
    expect(() => resolveProject(registry, outside, undefined)).toThrow('No registered project found');
  });

  it('throws a clear error when cwd is ambiguous between nested projects', () => {
    const nestedRepo = path.join(repoA, 'nested-repo');
    mkdirSync(path.join(nestedRepo, '.git'), { recursive: true });
    registry.register('nested', nestedRepo);
    expect(() => resolveProject(registry, nestedRepo, undefined)).toThrow('Ambiguous project');
  });
});
