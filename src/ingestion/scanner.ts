import { readdirSync } from 'node:fs';
import path from 'node:path';

export interface ScannedFile {
  relativePath: string;
  absolutePath: string;
}

export const SUPPORTED_EXTENSIONS = new Set(['.md', '.mdx', '.txt']);
const EXCLUDED_DIR_NAMES = new Set([
  '.git',
  'node_modules',
  'vendor',
  'dist',
  'build',
  'coverage',
  '.claude',
  '.agents',
]);
const EXCLUDED_FILE_NAMES = new Set(['.env', 'CLAUDE.md', 'AGENTS.md']);

export function scanDocuments(repositoryRoot: string, paths: string[]): ScannedFile[] {
  const results: ScannedFile[] = [];
  const resolvedRoot = path.resolve(repositoryRoot);
  for (const configuredPath of paths) {
    const resolvedTarget = path.resolve(repositoryRoot, configuredPath);
    if (resolvedTarget !== resolvedRoot && !resolvedTarget.startsWith(resolvedRoot + path.sep)) {
      throw new Error(`Configured path escapes repository root: ${configuredPath}`);
    }
    walk(repositoryRoot, resolvedTarget, results);
  }

  const readme = findRootReadme(resolvedRoot);
  if (readme && !results.some((f) => f.relativePath === readme.relativePath)) {
    results.push(readme);
  }

  return results.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

/**
 * The repository root's own README is always indexed, even when it falls
 * outside every configured path — it's the single most useful document an
 * agent can read about a project, and making users add '.' to `paths` just
 * to get it would also pull in every stray Markdown file scattered in the
 * repo root.
 */
function findRootReadme(repositoryRoot: string): ScannedFile | undefined {
  let entries;
  try {
    entries = readdirSync(repositoryRoot, { withFileTypes: true });
  } catch {
    return undefined;
  }
  const files = entries.filter((entry) => entry.isFile());
  // Extension order doubles as preference order (.md over .mdx over .txt)
  // for the rare repo that somehow has more than one.
  for (const ext of SUPPORTED_EXTENSIONS) {
    const match = files.find((entry) => entry.name.toLowerCase() === `readme${ext}`);
    if (match) {
      return { relativePath: match.name, absolutePath: path.join(repositoryRoot, match.name) };
    }
  }
  return undefined;
}

function walk(repositoryRoot: string, dir: string, results: ScannedFile[]): void {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (EXCLUDED_DIR_NAMES.has(entry.name)) continue;
      walk(repositoryRoot, path.join(dir, entry.name), results);
      continue;
    }
    if (EXCLUDED_FILE_NAMES.has(entry.name)) continue;
    const ext = path.extname(entry.name).toLowerCase();
    if (!SUPPORTED_EXTENSIONS.has(ext)) continue;
    const absolutePath = path.join(dir, entry.name);
    const relativePath = path.relative(repositoryRoot, absolutePath).split(path.sep).join('/');
    results.push({ relativePath, absolutePath });
  }
}
