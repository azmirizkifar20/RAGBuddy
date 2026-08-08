import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { ProjectConfig } from '../projects/project-types';
import { UPLOAD_PREFIX, uploadsDirFor, assertSafeUploadName } from '../ingestion/uploads';
import { extractDocument } from '../ingestion/document-extractor';

export interface GetProjectDocumentOptions {
  /** Required to read documents uploaded through the dashboard (`uploads/…`). */
  dataDir?: string;
}

/**
 * Async because uploaded PDFs, Word and Excel files are stored as the original
 * binary and converted to text on read — the file is the source of truth, the
 * text is derived, so a parser improvement applies to already-uploaded files.
 */
export async function getProjectDocument(
  project: ProjectConfig,
  file: string,
  options: GetProjectDocumentOptions = {},
): Promise<string> {
  if (file.startsWith(UPLOAD_PREFIX)) {
    return readUpload(project, file.slice(UPLOAD_PREFIX.length), options.dataDir);
  }
  const resolvedRoot = path.resolve(project.repository);
  const resolvedTarget = path.resolve(project.repository, file);
  if (resolvedTarget !== resolvedRoot && !resolvedTarget.startsWith(resolvedRoot + path.sep)) {
    throw new Error(`File path escapes repository root: ${file}`);
  }

  const relativePath = path.relative(resolvedRoot, resolvedTarget).split(path.sep).join('/');
  const withinConfiguredPath = project.paths.some((configuredPath) => {
    const prefix = configuredPath.endsWith('/') ? configuredPath : `${configuredPath}/`;
    return relativePath === configuredPath || relativePath.startsWith(prefix);
  });
  if (!withinConfiguredPath) {
    throw new Error(`File is outside the project's configured documentation paths: ${file}`);
  }

  if (!existsSync(resolvedTarget)) {
    throw new Error(`File not found: ${file}`);
  }

  return readFileSync(resolvedTarget, 'utf8');
}

/**
 * Uploaded documents live in project-rag's own data dir, not the repository,
 * so they get their own read path. `assertSafeUploadName` rejects anything
 * with a directory component, which is what keeps `uploads/../../secret` out.
 */
async function readUpload(
  project: ProjectConfig,
  name: string,
  dataDir: string | undefined,
): Promise<string> {
  if (!dataDir) {
    throw new Error(`Uploaded documents are unavailable: no data directory configured (${name})`);
  }
  const safeName = assertSafeUploadName(name);
  const target = path.join(uploadsDirFor(dataDir, project.id), safeName);
  if (!existsSync(target)) {
    throw new Error(`File not found: ${UPLOAD_PREFIX}${name}`);
  }
  const { text } = await extractDocument(safeName, readFileSync(target));
  return text;
}
