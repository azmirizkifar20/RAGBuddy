import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { QdrantClient } from '@qdrant/js-client-rest';
import type { ProjectConfig } from '../projects/project-types';
import { getIndexedFiles } from '../qdrant/qdrant-repository';
import { getCurrentBranch, getCurrentCommit, isRepositoryDirty } from '../git/git-status';

/**
 * Fixed, well-known orientation docs — not a scan. Reading a handful of known
 * paths directly (rather than reusing document-reader's traversal guard) is
 * safe here because these relative paths are hardcoded constants, not
 * caller-supplied input.
 */
const CONTEXT_DOCS = [
  { key: 'readme', file: 'docs/README.md' },
  { key: 'techStack', file: 'docs/steering/tech-stack.md' },
  { key: 'architecture', file: 'docs/steering/architecture.md' },
  { key: 'systemFlow', file: 'docs/steering/system-flow.md' },
  { key: 'apiConventions', file: 'docs/steering/api-conventions.md' },
] as const;

type SteeringKey = (typeof CONTEXT_DOCS)[number]['key'];

// ponytail: naive char-cap truncation on whitespace-collapsed text; upgrade to
// heading-aware extraction if summaries read low-signal in practice.
const SUMMARY_MAX_CHARS = 800;

function summarize(markdown: string): string {
  const body = markdown.replace(/^#[^\n]*\n+/, '').trim();
  if (body.length <= SUMMARY_MAX_CHARS) return body;
  const truncated = body.slice(0, SUMMARY_MAX_CHARS);
  const lastBreak = Math.max(truncated.lastIndexOf('\n\n'), truncated.lastIndexOf('. '));
  const cut = lastBreak > SUMMARY_MAX_CHARS * 0.5 ? truncated.slice(0, lastBreak + 1) : truncated;
  return `${cut.trim()}…`;
}

function readDocSummary(repositoryRoot: string, relativeFile: string): string | undefined {
  const target = path.join(repositoryRoot, relativeFile);
  if (!existsSync(target)) return undefined;
  try {
    return summarize(readFileSync(target, 'utf8'));
  } catch {
    return undefined;
  }
}

/** Heuristic bucket: the file's immediate parent folder name, or 'root'. */
function categoryOf(file: string): string {
  const dir = path.posix.dirname(file);
  if (dir === '.') return 'root';
  const parts = dir.split('/');
  return parts[parts.length - 1];
}

export type GitInfo =
  | { available: true; branch: string; commit: string; dirty: boolean }
  | { available: false };

export interface ProjectContextResult {
  project: { id: string; name: string };
  repository: { name: string };
  git: GitInfo;
  overview?: string;
  steering: Partial<Record<SteeringKey, string>>;
  documentation: {
    total: number;
    categories: Record<string, number>;
    importantDocuments: string[];
  };
}

export interface BuildProjectContextDeps {
  qdrantClient: QdrantClient;
  qdrantCollection: string;
}

export async function buildProjectContext(
  project: ProjectConfig,
  deps: BuildProjectContextDeps,
): Promise<ProjectContextResult> {
  const repositoryRoot = path.resolve(project.repository);

  const overview = readDocSummary(repositoryRoot, 'README.md');

  const steering: ProjectContextResult['steering'] = {};
  for (const { key, file } of CONTEXT_DOCS) {
    const summary = readDocSummary(repositoryRoot, file);
    if (summary) steering[key] = summary;
  }

  const commit = getCurrentCommit(repositoryRoot);
  const git: GitInfo =
    commit === null
      ? { available: false }
      : {
          available: true,
          branch: getCurrentBranch(repositoryRoot) ?? 'unknown',
          commit,
          dirty: isRepositoryDirty(repositoryRoot),
        };

  // A Qdrant outage shouldn't take down orientation — the rest of the
  // context (README, steering docs, git) is still useful on its own.
  let indexedFiles: Awaited<ReturnType<typeof getIndexedFiles>> = [];
  try {
    indexedFiles = await getIndexedFiles(deps.qdrantClient, deps.qdrantCollection, project.id);
  } catch {
    indexedFiles = [];
  }

  const categories: Record<string, number> = {};
  for (const { file } of indexedFiles) {
    const category = categoryOf(file);
    categories[category] = (categories[category] ?? 0) + 1;
  }

  const importantDocuments = CONTEXT_DOCS.filter(({ file }) =>
    existsSync(path.join(repositoryRoot, file)),
  ).map(({ file }) => file);

  return {
    project: { id: project.id, name: project.name },
    repository: { name: path.basename(repositoryRoot) },
    git,
    overview,
    steering,
    documentation: {
      total: indexedFiles.length,
      categories,
      importantDocuments,
    },
  };
}
