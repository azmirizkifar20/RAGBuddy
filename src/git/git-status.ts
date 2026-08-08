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
