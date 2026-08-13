import { existsSync, readFileSync, writeFileSync, unlinkSync, chmodSync } from 'node:fs';
import path from 'node:path';

const MARKER_START = '# >>> ragbuddy hook start (do not edit this block manually) >>>';
const MARKER_END = '# <<< ragbuddy hook end <<<';

// post-commit: every commit. post-merge: fires after `git merge`, which
// includes `git pull` (fetch + merge). post-checkout: fires after branch
// switches — guarded below to skip single-file checkouts.
const HOOK_NAMES = ['post-commit', 'post-merge', 'post-checkout'] as const;
type HookName = (typeof HOOK_NAMES)[number];

const HOOK_LABELS: Record<HookName, string> = {
  'post-commit': 'commit',
  'post-merge': 'merge',
  'post-checkout': 'checkout',
};

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

  for (const hookName of HOOK_NAMES) {
    const block = buildHookBlock(hookName, projectId, nodePath, cliEntrypoint);
    const hookPath = path.join(gitDir, 'hooks', hookName);
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
}

export function uninstallHook(repositoryPath: string): void {
  for (const hookName of HOOK_NAMES) {
    const hookPath = path.join(repositoryPath, '.git', 'hooks', hookName);
    if (!existsSync(hookPath)) continue;

    const existing = readFileSync(hookPath, 'utf8');
    if (!existing.includes(MARKER_START)) continue;

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
}

export function isHookInstalled(repositoryPath: string): boolean {
  // All hooks are installed/removed together, so post-commit is a
  // representative check for "is ragbuddy auto-sync on for this repo".
  const hookPath = path.join(repositoryPath, '.git', 'hooks', 'post-commit');
  if (!existsSync(hookPath)) return false;
  return readFileSync(hookPath, 'utf8').includes(MARKER_START);
}

function buildHookBlock(
  hookName: HookName,
  projectId: string,
  nodePath: string,
  cliEntrypoint: string,
): string {
  const label = HOOK_LABELS[hookName];
  const lines = [
    MARKER_START,
    '# Auto-sync installed by `ragbuddy hook install` — safe to remove via `ragbuddy hook uninstall`.',
    `# This never blocks the ${label}: any sync failure only prints a warning below.`,
  ];
  if (hookName === 'post-checkout') {
    // Git passes post-checkout: <prev-head> <new-head> <branch-flag>.
    // branch-flag is 0 for a single-file checkout (`git checkout -- file`) —
    // skip those, only re-sync on an actual branch switch.
    lines.push('[ "$3" = "1" ] || exit 0');
  }
  lines.push(
    'echo "[ragbuddy] Sync started..."',
    // RAGBUDDY_TRIGGER lets the sync history distinguish this automatic run
    // from a `ragbuddy sync` you typed yourself. ELECTRON_RUN_AS_NODE is a no-op
    // for a real `node` binary, but critical when `nodePath` is actually the
    // Electron executable (true whenever this hook was installed from inside
    // the packaged desktop app, since `process.execPath` there always reports
    // Electron's own binary — see docs/features/11-electron-desktop-app.md):
    // without it, this line launches the full GUI on every commit instead of
    // running the CLI headlessly.
    `RAGBUDDY_TRIGGER=hook ELECTRON_RUN_AS_NODE=1 "${nodePath}" "${cliEntrypoint}" sync ${projectId} || echo "[ragbuddy] Warning: RAG sync failed. Git ${label} remains successful."`,
    MARKER_END,
  );
  return lines.join('\n');
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
