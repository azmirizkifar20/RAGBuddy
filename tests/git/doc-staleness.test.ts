import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { commitsSince, isStale, STALE_COMMIT_THRESHOLD } from '../../src/git/doc-staleness';

describe('commitsSince', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'ragbuddy-staleness-'));
    execFileSync('git', ['init', '-b', 'main'], { cwd: dir });
    execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: dir });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns 0 when the given commit is already HEAD', () => {
    writeFileSync(path.join(dir, 'a.txt'), '1');
    execFileSync('git', ['add', '.'], { cwd: dir });
    execFileSync('git', ['commit', '-m', 'first'], { cwd: dir });
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();

    expect(commitsSince(dir, head)).toBe(0);
  });

  it('counts commits made after the given commit', () => {
    writeFileSync(path.join(dir, 'a.txt'), '1');
    execFileSync('git', ['add', '.'], { cwd: dir });
    execFileSync('git', ['commit', '-m', 'first'], { cwd: dir });
    const first = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
    writeFileSync(path.join(dir, 'a.txt'), '2');
    execFileSync('git', ['commit', '-am', 'second'], { cwd: dir });
    writeFileSync(path.join(dir, 'a.txt'), '3');
    execFileSync('git', ['commit', '-am', 'third'], { cwd: dir });

    expect(commitsSince(dir, first)).toBe(2);
  });

  it('returns null for a commit unknown to this repo', () => {
    writeFileSync(path.join(dir, 'a.txt'), '1');
    execFileSync('git', ['add', '.'], { cwd: dir });
    execFileSync('git', ['commit', '-m', 'first'], { cwd: dir });

    expect(commitsSince(dir, '0000000000000000000000000000000000000000')).toBeNull();
  });

  it('returns null for a directory that is not a Git repository', () => {
    const notARepo = mkdtempSync(path.join(tmpdir(), 'ragbuddy-notgit-'));
    try {
      expect(commitsSince(notARepo, 'deadbeef')).toBeNull();
    } finally {
      rmSync(notARepo, { recursive: true, force: true });
    }
  });
});

describe('isStale', () => {
  it('is false for null (unknown) commit distance', () => {
    expect(isStale(null)).toBe(false);
  });

  it('is false below the threshold', () => {
    expect(isStale(STALE_COMMIT_THRESHOLD - 1)).toBe(false);
  });

  it('is true at or above the threshold', () => {
    expect(isStale(STALE_COMMIT_THRESHOLD)).toBe(true);
    expect(isStale(STALE_COMMIT_THRESHOLD + 5)).toBe(true);
  });
});
