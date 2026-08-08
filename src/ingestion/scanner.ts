import { readdirSync } from 'node:fs';
import path from 'node:path';

export interface ScannedFile {
  relativePath: string;
  absolutePath: string;
}

const SUPPORTED_EXTENSIONS = new Set(['.md', '.mdx', '.txt']);
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
  return results.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
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
