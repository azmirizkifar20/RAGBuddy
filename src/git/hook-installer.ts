import { existsSync, readFileSync, writeFileSync, unlinkSync, chmodSync } from 'node:fs';
import path from 'node:path';

const MARKER_START = '# >>> ragbuddy hook start (do not edit this block manually) >>>';
const MARKER_END = '# <<< ragbuddy hook end <<<';

export interface InstallHookOptions {
  nodePath?: string;
  cliEntrypoint?: string;
}

export function installHook(
  repositoryPath: string,
  projectId: string,
  options: InstallHookOptions = {},
): void {
  const gitDir = path.join(repositoryPath, '.git');
  if (!existsSync(gitDir)) {
    throw new Error(`Not a Git repository: ${repositoryPath}`);
  }

  const nodePath = options.nodePath ?? process.execPath;
  const cliEntrypoint = options.cliEntrypoint ?? path.resolve(__dirname, '../cli/index.js');
  const block = buildHookBlock(projectId, nodePath, cliEntrypoint);

  const hookPath = path.join(gitDir, 'hooks', 'post-commit');
  if (existsSync(hookPath)) {
    const existing = readFileSync(hookPath, 'utf8');
    const updated = existing.includes(MARKER_START)
      ? replaceBlock(existing, block)
      : `${existing.trimEnd()}\n\n${block}\n`;
    writeFileSync(hookPath, updated, 'utf8');
  } else {
    writeFileSync(hookPath, `#!/bin/sh\n\n${block}\n`, 'utf8');
  }
  chmodSync(hookPath, 0o755);
}

export function uninstallHook(repositoryPath: string): void {
  const hookPath = path.join(repositoryPath, '.git', 'hooks', 'post-commit');
  if (!existsSync(hookPath)) return;

  const existing = readFileSync(hookPath, 'utf8');
  if (!existing.includes(MARKER_START)) return;

  const startIdx = existing.indexOf(MARKER_START);
  const endIdx = existing.indexOf(MARKER_END);
  const before = existing.slice(0, startIdx).trimEnd();
  const after = existing.slice(endIdx + MARKER_END.length).trimStart();
  const remaining = [before, after].filter(Boolean).join('\n\n').trim();

  if (!remaining || remaining === '#!/bin/sh') {
    unlinkSync(hookPath);
  } else {
    writeFileSync(hookPath, remaining + '\n', 'utf8');
  }
}

export function isHookInstalled(repositoryPath: string): boolean {
  const hookPath = path.join(repositoryPath, '.git', 'hooks', 'post-commit');
  if (!existsSync(hookPath)) return false;
  return readFileSync(hookPath, 'utf8').includes(MARKER_START);
}

function buildHookBlock(projectId: string, nodePath: string, cliEntrypoint: string): string {
  return [
    MARKER_START,
    '# Auto-sync installed by `ragbuddy hook install` — safe to remove via `ragbuddy hook uninstall`.',
    '# This never blocks the commit: any sync failure only prints a warning below.',
    'echo "[ragbuddy] Sync started..."',
    // RAGBUDDY_TRIGGER lets the sync history distinguish this automatic run
    // from a `ragbuddy sync` you typed yourself.
    `RAGBUDDY_TRIGGER=hook "${nodePath}" "${cliEntrypoint}" sync ${projectId} || echo "[ragbuddy] Warning: RAG sync failed. Git commit remains successful."`,
    MARKER_END,
  ].join('\n');
}

function replaceBlock(existing: string, newBlock: string): string {
  const startIdx = existing.indexOf(MARKER_START);
  const endIdx = existing.indexOf(MARKER_END);
  const before = existing.slice(0, startIdx).trimEnd();
  const after = existing.slice(endIdx + MARKER_END.length).trimStart();
  const parts = [before, newBlock].filter(Boolean);
  if (after) parts.push(after);
  return parts.join('\n\n') + '\n';
}
