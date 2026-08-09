import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ProjectRegistry } from '../../src/projects/project-registry';

describe('ProjectRegistry', () => {
  let dir: string;
  let registryPath: string;
  let repoPath: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'ragbuddy-registry-'));
    registryPath = path.join(dir, 'projects.json');
    repoPath = path.join(dir, 'sample-repo');
    mkdirSync(path.join(repoPath, '.git'), { recursive: true });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('registers a project and persists it', () => {
    const registry = new ProjectRegistry(registryPath);
    const project = registry.register('sample', repoPath);
    expect(project).toEqual({ id: 'sample', name: 'sample', repository: repoPath, paths: ['docs'] });

    const reloaded = new ProjectRegistry(registryPath);
    expect(reloaded.list()).toEqual([project]);
  });

  it('finds a registered project by id', () => {
    const registry = new ProjectRegistry(registryPath);
    registry.register('sample', repoPath);
    expect(registry.find('sample')?.id).toBe('sample');
    expect(registry.find('missing')).toBeUndefined();
  });

  it('rejects a repository path that does not exist', () => {
    const registry = new ProjectRegistry(registryPath);
    expect(() => registry.register('sample', path.join(dir, 'nope'))).toThrow('does not exist');
  });

  it('rejects a repository that is not a Git repository', () => {
    const nonGitRepo = path.join(dir, 'not-git');
    mkdirSync(nonGitRepo, { recursive: true });
    const registry = new ProjectRegistry(registryPath);
    expect(() => registry.register('sample', nonGitRepo)).toThrow('Not a Git repository');
  });

  it('rejects registering a duplicate project id', () => {
    const registry = new ProjectRegistry(registryPath);
    registry.register('sample', repoPath);
    expect(() => registry.register('sample', repoPath)).toThrow('already registered');
  });

  it('removes a registered project', () => {
    const registry = new ProjectRegistry(registryPath);
    registry.register('sample', repoPath);
    registry.remove('sample');
    expect(registry.find('sample')).toBeUndefined();
    expect(() => registry.remove('sample')).toThrow('is not registered');
  });
});
