import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { QdrantClient } from '@qdrant/js-client-rest';
import type { ProjectConfig } from '../projects/project-types';
import type { EmbeddingProvider } from '../embedding/embedding-provider';
import { SUPPORTED_EXTENSIONS } from './scanner';
import { hashContent } from './hasher';
import { chunkMarkdown } from './chunker';
import { composeEmbedText } from './payload-builder';
import { ensureCollection } from '../qdrant/qdrant-client';
import { upsertChunks, deleteFileVectors, type DocumentPoint } from '../qdrant/qdrant-repository';

/**
 * Uploaded documents live outside the Git repository (nothing is written into
 * the user's repo) and are addressed under this virtual prefix so the file
 * list, sync diff, and MCP `get_project_document` all see one namespace.
 */
export const UPLOAD_PREFIX = 'uploads/';

export interface UploadedDocument {
  /** Virtual path used as the Qdrant `file` payload, e.g. `uploads/notes.md`. */
  file: string;
  name: string;
  sizeBytes: number;
  uploadedAt: string;
}

export interface UploadDeps {
  qdrantClient: QdrantClient;
  qdrantUrl: string;
  qdrantCollection: string;
  embeddingProvider: EmbeddingProvider;
  dataDir: string;
  onLog?: (message: string) => void;
}

export function uploadsDirFor(dataDir: string, projectId: string): string {
  return path.join(dataDir, 'uploads', projectId);
}

/**
 * Filenames arrive from a browser file picker, so they are untrusted input:
 * anything with a directory component, a leading dot, or an unsupported
 * extension is rejected rather than sanitized into something surprising.
 */
export function assertSafeUploadName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Filename is required');
  if (trimmed !== path.basename(trimmed) || trimmed.includes('/') || trimmed.includes('\\')) {
    throw new Error(`Filename must not contain a path: ${name}`);
  }
  if (trimmed.startsWith('.')) throw new Error(`Filename must not start with a dot: ${name}`);
  if (!/^[\w .()\-]+$/.test(trimmed)) {
    throw new Error(`Filename contains unsupported characters: ${name}`);
  }
  const ext = path.extname(trimmed).toLowerCase();
  if (!SUPPORTED_EXTENSIONS.has(ext)) {
    throw new Error(`Unsupported file type "${ext || 'none'}" — allowed: ${[...SUPPORTED_EXTENSIONS].join(', ')}`);
  }
  return trimmed;
}

export function listUploads(dataDir: string, projectId: string): UploadedDocument[] {
  const dir = uploadsDirFor(dataDir, projectId);
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const stats = statSync(path.join(dir, entry.name));
      return {
        file: `${UPLOAD_PREFIX}${entry.name}`,
        name: entry.name,
        sizeBytes: stats.size,
        uploadedAt: stats.mtime.toISOString(),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export interface UploadResult {
  file: string;
  name: string;
  chunksIndexed: number;
  replaced: boolean;
}

export async function uploadDocument(
  project: ProjectConfig,
  input: { filename: string; content: string },
  deps: UploadDeps,
): Promise<UploadResult> {
  const log = deps.onLog ?? (() => {});
  const name = assertSafeUploadName(input.filename);
  if (!input.content.trim()) throw new Error('Uploaded document is empty');

  const dir = uploadsDirFor(deps.dataDir, project.id);
  const absolutePath = path.join(dir, name);
  const replaced = existsSync(absolutePath);
  const file = `${UPLOAD_PREFIX}${name}`;

  const chunks = chunkMarkdown(input.content);
  if (chunks.length === 0) throw new Error('Uploaded document produced no indexable content');

  log(`Embedding ${file} (${chunks.length} chunk(s))`);
  const vectors = await deps.embeddingProvider.embedDocuments(chunks.map(composeEmbedText));
  const contentHash = hashContent(input.content);

  const points: DocumentPoint[] = chunks.map((chunk, i) => ({
    id: randomUUID(),
    vector: vectors[i],
    payload: {
      project: project.id,
      file,
      absolute_path: absolutePath,
      document_type: 'markdown',
      category: 'upload',
      content_hash: contentHash,
      git_commit: null,
      chunk_index: chunk.chunkIndex,
      title: chunk.title || name,
      section: chunk.section,
      content: chunk.content,
      source: 'upload',
    },
  }));

  await ensureCollection(deps.qdrantClient, {
    url: deps.qdrantUrl,
    collectionName: deps.qdrantCollection,
    vectorSize: points[0].vector.length,
  });
  // Write the file only after embedding succeeded — a failed upload leaves no
  // orphan on disk claiming to be indexed.
  mkdirSync(dir, { recursive: true });
  writeFileSync(absolutePath, input.content, 'utf8');
  if (replaced) await deleteFileVectors(deps.qdrantClient, deps.qdrantCollection, project.id, file);
  await upsertChunks(deps.qdrantClient, deps.qdrantCollection, points);
  log(`Upserted ${points.length} chunk(s) for ${file}`);

  return { file, name, chunksIndexed: points.length, replaced };
}

export async function removeUpload(
  project: ProjectConfig,
  filename: string,
  deps: Pick<UploadDeps, 'qdrantClient' | 'qdrantCollection' | 'dataDir'>,
): Promise<void> {
  const name = assertSafeUploadName(filename);
  const absolutePath = path.join(uploadsDirFor(deps.dataDir, project.id), name);
  if (!existsSync(absolutePath)) {
    throw new Error(`Uploaded document "${name}" does not exist`);
  }
  await deleteFileVectors(
    deps.qdrantClient,
    deps.qdrantCollection,
    project.id,
    `${UPLOAD_PREFIX}${name}`,
  );
  rmSync(absolutePath);
}
