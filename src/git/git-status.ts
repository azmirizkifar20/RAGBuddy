import { execFileSync } from 'node:child_process';

export function getCurrentCommit(repositoryPath: string): string | null {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repositoryPath,
      encoding: 'utf8',
    }).trim();
  } catch {
    return null;
  }
}

export function getCurrentBranch(repositoryPath: string): string | null {
  try {
    return execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: repositoryPath,
      encoding: 'utf8',
    }).trim();
  } catch {
    return null;
  }
}

export function isRepositoryDirty(repositoryPath: string): boolean {
  try {
    const status = execFileSync('git', ['status', '--porcelain'], {
      cwd: repositoryPath,
      encoding: 'utf8',
    });
    return status.trim().length > 0;
  } catch {
    return false;
  }
}
