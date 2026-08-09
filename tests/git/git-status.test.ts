import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { getCurrentCommit, getCurrentBranch, isRepositoryDirty } from '../../src/git/git-status';

describe('getCurrentCommit', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'ragbuddy-git-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns the current commit hash for a repo with commits', () => {
    execFileSync('git', ['init', '-b', 'main'], { cwd: dir });
    execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: dir });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
    writeFileSync(path.join(dir, 'file.txt'), 'hello');
    execFileSync('git', ['add', '.'], { cwd: dir });
    execFileSync('git', ['commit', '-m', 'init'], { cwd: dir });

    const commit = getCurrentCommit(dir);
    expect(commit).toMatch(/^[0-9a-f]{40}$/);
  });

  it('returns null for a repo with no commits yet', () => {
    execFileSync('git', ['init', '-b', 'main'], { cwd: dir });
    expect(getCurrentCommit(dir)).toBeNull();
  });
});

describe('getCurrentBranch', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'ragbuddy-git-'));
    execFileSync('git', ['init', '-b', 'main'], { cwd: dir });
    execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: dir });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns the current branch name', () => {
    writeFileSync(path.join(dir, 'file.txt'), 'hello');
    execFileSync('git', ['add', '.'], { cwd: dir });
    execFileSync('git', ['commit', '-m', 'init'], { cwd: dir });

    expect(getCurrentBranch(dir)).toBe('main');
  });

  it('returns null for a directory that is not a Git repository', () => {
    const notARepo = mkdtempSync(path.join(tmpdir(), 'ragbuddy-notgit-'));
    try {
      expect(getCurrentBranch(notARepo)).toBeNull();
    } finally {
      rmSync(notARepo, { recursive: true, force: true });
    }
  });
});

describe('isRepositoryDirty', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'ragbuddy-git-'));
    execFileSync('git', ['init', '-b', 'main'], { cwd: dir });
    execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: dir });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
    writeFileSync(path.join(dir, 'file.txt'), 'hello');
    execFileSync('git', ['add', '.'], { cwd: dir });
    execFileSync('git', ['commit', '-m', 'init'], { cwd: dir });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns false for a clean working tree', () => {
    expect(isRepositoryDirty(dir)).toBe(false);
  });

  it('returns true when there are uncommitted changes', () => {
    writeFileSync(path.join(dir, 'file.txt'), 'changed');
    expect(isRepositoryDirty(dir)).toBe(true);
  });

  it('returns false for a directory that is not a Git repository', () => {
    const notARepo = mkdtempSync(path.join(tmpdir(), 'ragbuddy-notgit-'));
    try {
      expect(isRepositoryDirty(notARepo)).toBe(false);
    } finally {
      rmSync(notARepo, { recursive: true, force: true });
    }
  });
});
