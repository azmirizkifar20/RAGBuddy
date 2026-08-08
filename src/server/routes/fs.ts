import type { Router } from 'express';
import { existsSync, readdirSync, type Dirent } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface FsEntry {
  name: string;
  path: string;
  isGitRepo: boolean;
}

function isGitRepoDir(dir: string): boolean {
  try {
    return existsSync(path.join(dir, '.git'));
  } catch {
    return false;
  }
}

/** Node has no drive-enumeration API on Windows; probing A:\ .. Z:\ is instant and reliable. */
function windowsDrives(): string[] {
  const drives: string[] = [];
  for (let code = 65; code <= 90; code++) {
    const drive = `${String.fromCharCode(code)}:\\`;
    if (existsSync(drive)) drives.push(drive);
  }
  return drives;
}

/**
 * Directory browsing for the "Browse" button on the Add Project form.
 *
 * This is localhost-only with no auth, and the rest of the app already lets
 * the user type an arbitrary absolute path for a repository (init.md §27) —
 * these routes only make that easier to pick, they don't expand what the
 * process can already read.
 */
export function registerFsRoutes(router: Router): void {
  router.get('/roots', (_req, res) => {
    const roots = process.platform === 'win32' ? windowsDrives() : ['/'];
    res.json({ roots, home: os.homedir() });
  });

  router.get('/list', (req, res) => {
    const requested = String(req.query.path ?? '');
    if (!requested || !path.isAbsolute(requested)) {
      res.status(400).json({ error: 'path must be an absolute directory path' });
      return;
    }

    const resolved = path.resolve(requested);
    if (!existsSync(resolved)) {
      res.status(404).json({ error: `Path does not exist: ${resolved}` });
      return;
    }

    let entries: Dirent[];
    try {
      entries = readdirSync(resolved, { withFileTypes: true });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
      return;
    }

    const dirs: FsEntry[] = entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
      .map((entry) => {
        const full = path.join(resolved, entry.name);
        return { name: entry.name, path: full, isGitRepo: isGitRepoDir(full) };
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    const parent = path.dirname(resolved);
    res.json({
      path: resolved,
      parent: parent === resolved ? null : parent,
      isGitRepo: isGitRepoDir(resolved),
      entries: dirs,
    });
  });
}
