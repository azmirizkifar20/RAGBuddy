import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { installHook, uninstallHook, isHookInstalled } from '../../src/git/hook-installer';

const HOOK_NAMES = ['post-commit', 'post-merge', 'post-checkout'] as const;

describe('installHook', () => {
  let dir: string;
  let repo: string;
  let hooksDir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'ragbuddy-hook-'));
    repo = path.join(dir, 'repo');
    mkdirSync(path.join(repo, '.git', 'hooks'), { recursive: true });
    hooksDir = path.join(repo, '.git', 'hooks');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('creates fresh hooks for commit, merge, and checkout when none exist', () => {
    installHook(repo, 'bidubadu', { nodePath: '/usr/bin/node', cliEntrypoint: '/opt/ragbuddy/dist/cli/index.js' });

    for (const hookName of HOOK_NAMES) {
      const hookPath = path.join(hooksDir, hookName);
      expect(existsSync(hookPath)).toBe(true);
      const content = readFileSync(hookPath, 'utf8');
      expect(content).toContain('ragbuddy hook start');
      expect(content).toContain('sync bidubadu');
      expect(content).toContain('/usr/bin/node');
      expect(content).toContain('/opt/ragbuddy/dist/cli/index.js');
    }
  });

  it('always sets ELECTRON_RUN_AS_NODE=1 on the sync invocation, even for a plain node path', () => {
    // Critical when `nodePath` is actually the packaged Electron binary (true whenever the
    // hook was installed from inside the desktop app, since `process.execPath` there always
    // reports Electron's own executable) — without it, the hook launches the full GUI on
    // every commit instead of running the CLI headlessly. A no-op for a real `node` binary.
    installHook(repo, 'bidubadu', { nodePath: '/usr/bin/node', cliEntrypoint: '/opt/ragbuddy/dist/cli/index.js' });

    for (const hookName of HOOK_NAMES) {
      const content = readFileSync(path.join(hooksDir, hookName), 'utf8');
      expect(content).toContain('ELECTRON_RUN_AS_NODE=1 "/usr/bin/node"');
    }
  });

  it('guards post-checkout to skip single-file checkouts (branch-flag $3)', () => {
    installHook(repo, 'bidubadu', { nodePath: 'node', cliEntrypoint: '/x/index.js' });

    const content = readFileSync(path.join(hooksDir, 'post-checkout'), 'utf8');
    expect(content).toContain('[ "$3" = "1" ] || exit 0');
  });

  it('does not guard post-commit or post-merge', () => {
    installHook(repo, 'bidubadu', { nodePath: 'node', cliEntrypoint: '/x/index.js' });

    expect(readFileSync(path.join(hooksDir, 'post-commit'), 'utf8')).not.toContain('exit 0');
    expect(readFileSync(path.join(hooksDir, 'post-merge'), 'utf8')).not.toContain('exit 0');
  });

  it('rejects a repository that is not a git repo', () => {
    const notGit = path.join(dir, 'not-git');
    mkdirSync(notGit, { recursive: true });
    expect(() => installHook(notGit, 'bidubadu')).toThrow('Not a Git repository');
  });

  it('preserves an existing user hook by appending the ragbuddy block after it', () => {
    const hookPath = path.join(hooksDir, 'post-commit');
    writeFileSync(hookPath, '#!/bin/sh\necho "custom user hook"\n');

    installHook(repo, 'bidubadu', { nodePath: 'node', cliEntrypoint: '/x/index.js' });

    const content = readFileSync(hookPath, 'utf8');
    expect(content).toContain('custom user hook');
    expect(content).toContain('ragbuddy hook start');
    expect(content.indexOf('custom user hook')).toBeLessThan(content.indexOf('ragbuddy hook start'));
  });

  it('is idempotent — reinstalling replaces only the ragbuddy block, not the user content', () => {
    const hookPath = path.join(hooksDir, 'post-commit');
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
  let hooksDir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'ragbuddy-hook-uninstall-'));
    repo = path.join(dir, 'repo');
    mkdirSync(path.join(repo, '.git', 'hooks'), { recursive: true });
    hooksDir = path.join(repo, '.git', 'hooks');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('removes all three hook files entirely when they only contained the ragbuddy block', () => {
    installHook(repo, 'bidubadu', { nodePath: 'node', cliEntrypoint: '/x/index.js' });
    uninstallHook(repo);
    for (const hookName of HOOK_NAMES) {
      expect(existsSync(path.join(hooksDir, hookName))).toBe(false);
    }
  });

  it('preserves a pre-existing user hook and removes only the ragbuddy block', () => {
    const hookPath = path.join(hooksDir, 'post-commit');
    writeFileSync(hookPath, '#!/bin/sh\necho "custom user hook"\n');
    installHook(repo, 'bidubadu', { nodePath: 'node', cliEntrypoint: '/x/index.js' });

    uninstallHook(repo);

    const content = readFileSync(hookPath, 'utf8');
    expect(content).toContain('custom user hook');
    expect(content).not.toContain('ragbuddy hook start');
  });

  it('does nothing when no hook is installed', () => {
    expect(() => uninstallHook(repo)).not.toThrow();
    for (const hookName of HOOK_NAMES) {
      expect(existsSync(path.join(hooksDir, hookName))).toBe(false);
    }
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
