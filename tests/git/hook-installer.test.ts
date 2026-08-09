import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { installHook, uninstallHook, isHookInstalled } from '../../src/git/hook-installer';

describe('installHook', () => {
  let dir: string;
  let repo: string;
  let hookPath: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'ragbuddy-hook-'));
    repo = path.join(dir, 'repo');
    mkdirSync(path.join(repo, '.git', 'hooks'), { recursive: true });
    hookPath = path.join(repo, '.git', 'hooks', 'post-commit');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('creates a fresh post-commit hook when none exists', () => {
    installHook(repo, 'bidubadu', { nodePath: '/usr/bin/node', cliEntrypoint: '/opt/ragbuddy/dist/cli/index.js' });

    expect(existsSync(hookPath)).toBe(true);
    const content = readFileSync(hookPath, 'utf8');
    expect(content).toContain('ragbuddy hook start');
    expect(content).toContain('sync bidubadu');
    expect(content).toContain('/usr/bin/node');
    expect(content).toContain('/opt/ragbuddy/dist/cli/index.js');
    expect(content).toContain('Git commit remains successful');
  });

  it('rejects a repository that is not a git repo', () => {
    const notGit = path.join(dir, 'not-git');
    mkdirSync(notGit, { recursive: true });
    expect(() => installHook(notGit, 'bidubadu')).toThrow('Not a Git repository');
  });

  it('preserves an existing user hook by appending the ragbuddy block after it', () => {
    writeFileSync(hookPath, '#!/bin/sh\necho "custom user hook"\n');

    installHook(repo, 'bidubadu', { nodePath: 'node', cliEntrypoint: '/x/index.js' });

    const content = readFileSync(hookPath, 'utf8');
    expect(content).toContain('custom user hook');
    expect(content).toContain('ragbuddy hook start');
    expect(content.indexOf('custom user hook')).toBeLessThan(content.indexOf('ragbuddy hook start'));
  });

  it('is idempotent — reinstalling replaces only the ragbuddy block, not the user content', () => {
    writeFileSync(hookPath, '#!/bin/sh\necho "custom user hook"\n');
    installHook(repo, 'old-project', { nodePath: 'node', cliEntrypoint: '/x/index.js' });
    installHook(repo, 'new-project', { nodePath: 'node', cliEntrypoint: '/x/index.js' });

    const content = readFileSync(hookPath, 'utf8');
    expect(content).toContain('custom user hook');
    expect(content).toContain('sync new-project');
    expect(content).not.toContain('sync old-project');
    expect(content.split('ragbuddy hook start').length - 1).toBe(1);
  });
});

describe('uninstallHook', () => {
  let dir: string;
  let repo: string;
  let hookPath: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'ragbuddy-hook-uninstall-'));
    repo = path.join(dir, 'repo');
    mkdirSync(path.join(repo, '.git', 'hooks'), { recursive: true });
    hookPath = path.join(repo, '.git', 'hooks', 'post-commit');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('removes the hook file entirely when it only contained the ragbuddy block', () => {
    installHook(repo, 'bidubadu', { nodePath: 'node', cliEntrypoint: '/x/index.js' });
    uninstallHook(repo);
    expect(existsSync(hookPath)).toBe(false);
  });

  it('preserves a pre-existing user hook and removes only the ragbuddy block', () => {
    writeFileSync(hookPath, '#!/bin/sh\necho "custom user hook"\n');
    installHook(repo, 'bidubadu', { nodePath: 'node', cliEntrypoint: '/x/index.js' });

    uninstallHook(repo);

    const content = readFileSync(hookPath, 'utf8');
    expect(content).toContain('custom user hook');
    expect(content).not.toContain('ragbuddy hook start');
  });

  it('does nothing when no hook is installed', () => {
    expect(() => uninstallHook(repo)).not.toThrow();
    expect(existsSync(hookPath)).toBe(false);
  });
});

describe('isHookInstalled', () => {
  let dir: string;
  let repo: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'ragbuddy-hook-status-'));
    repo = path.join(dir, 'repo');
    mkdirSync(path.join(repo, '.git', 'hooks'), { recursive: true });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns false when no hook file exists', () => {
    expect(isHookInstalled(repo)).toBe(false);
  });

  it('returns false when a hook file exists but is not ours', () => {
    writeFileSync(path.join(repo, '.git', 'hooks', 'post-commit'), '#!/bin/sh\necho "custom user hook"\n');
    expect(isHookInstalled(repo)).toBe(false);
  });

  it('returns true after installHook has run', () => {
    installHook(repo, 'sample', { nodePath: 'node', cliEntrypoint: '/x/index.js' });
    expect(isHookInstalled(repo)).toBe(true);
  });

  it('returns false after uninstallHook has run', () => {
    installHook(repo, 'sample', { nodePath: 'node', cliEntrypoint: '/x/index.js' });
    uninstallHook(repo);
    expect(isHookInstalled(repo)).toBe(false);
  });
});
