import { execFileSync } from 'node:child_process';

/** A doc is flagged stale once the repo has moved this many commits past the commit it was last
 *  indexed at — a heuristic proxy (no doc-to-code reference graph exists), not a certainty. */
export const STALE_COMMIT_THRESHOLD = 20;

/** How many commits have landed in `repositoryPath` since `commit`, via `git rev-list --count
 *  <commit>..HEAD`. Returns `null` when it can't be computed (the commit is unknown to this repo —
 *  rebased history, shallow clone, or a legacy point indexed before `git_commit` was tracked) —
 *  "unknown" is a distinct outcome from "zero commits since", not the same as being stale. */
export function commitsSince(repositoryPath: string, commit: string): number | null {
  try {
    const output = execFileSync('git', ['rev-list', '--count', `${commit}..HEAD`], {
      cwd: repositoryPath,
      encoding: 'utf8',
    }).trim();
    const count = Number.parseInt(output, 10);
    return Number.isFinite(count) ? count : null;
  } catch {
    return null;
  }
}

export function isStale(commitsBehind: number | null): boolean {
  return commitsBehind !== null && commitsBehind >= STALE_COMMIT_THRESHOLD;
}
