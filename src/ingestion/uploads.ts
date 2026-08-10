import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { QdrantClient } from '@qdrant/js-client-rest';
import type { ProjectConfig } from '../projects/project-types';
import type { EmbeddingProvider } from '../embedding/embedding-provider';
import {
  extractDocument,
  assertSupportedUploadExtension,
  uploadTypeForExtension,
  SUPPORTED_UPLOAD_EXTENSIONS,
  type UploadDocumentType,
} from './document-extractor';
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
  documentType: UploadDocumentType;
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

/** Characters Windows forbids in a filename, plus control characters. */
const ILLEGAL_NAME_CHARS = /[<>:"|?*\u0000-\u001f\u007f]/;
/** CON, PRN, NUL, COM1… still resolve to devices on Windows even with an extension. */
const RESERVED_DEVICE_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
/** Most filesystems cap a single path segment at 255 bytes. */
const MAX_NAME_BYTES = 200;

/**
 * Filenames arrive from a browser file picker, so they are untrusted input.
 *
 * This rejects what is actually dangerous — path components, dotfiles,
 * control characters, Windows-illegal characters and reserved device names —
 * rather than allowing only a list of safe-looking ASCII. An allowlist looks
 * stricter but is simply wrong here: it threw out `Ringkasan Proyék.docx`,
 * `Laporan – Q1.pdf` (Word turns a hyphen into an en dash), `data, final.xlsx`
 * and every non-Latin filename, none of which are a security problem.
 */
export function assertSafeUploadName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Filename is required');

  if (trimmed !== path.basename(trimmed) || trimmed.includes('/') || trimmed.includes('\\')) {
    throw new Error(`Filename must not contain a path: ${name}`);
  }
  if (trimmed.includes('..')) throw new Error(`Filename must not contain "..": ${name}`);
  if (trimmed.startsWith('.')) throw new Error(`Filename must not start with a dot: ${name}`);
  // Windows silently strips a trailing dot or space, which would let two
  // different uploads resolve to the same file on disk.
  if (/[. ]$/.test(trimmed)) throw new Error(`Filename must not end with a dot or space: ${name}`);
  if (ILLEGAL_NAME_CHARS.test(trimmed)) {
    throw new Error(`Filename must not contain any of < > : " | ? * or control characters: ${name}`);
  }
  if (RESERVED_DEVICE_NAMES.test(trimmed)) {
    throw new Error(`"${trimmed}" is a reserved device name on Windows — rename the file.`);
  }
  if (Buffer.byteLength(trimmed, 'utf8') > MAX_NAME_BYTES) {
    throw new Error(`Filename is too long (max ${MAX_NAME_BYTES} bytes): ${name}`);
  }

  assertSupportedUploadExtension(trimmed);
  return trimmed;
}

export { SUPPORTED_UPLOAD_EXTENSIONS };

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
        documentType: uploadTypeForExtension(path.extname(entry.name)) ?? 'text',
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export interface UploadResult {
  file: string;
  name: string;
  chunksIndexed: number;
  replaced: boolean;
  documentType: UploadDocumentType;
  /** The document was longer than the extractor's cap and was cut short. */
  truncated: boolean;
}

export async function uploadDocument(
  project: ProjectConfig,
  /** `data` carries binary formats (PDF/Word/Excel); `content` is plain UTF-8 text. */
  input: { filename: string; content?: string; data?: Buffer },
  deps: UploadDeps,
): Promise<UploadResult> {
  const log = deps.onLog ?? (() => {});
  const name = assertSafeUploadName(input.filename);
  const bytes = input.data ?? Buffer.from(input.content ?? '', 'utf8');
  if (bytes.length === 0) throw new Error('Uploaded document is empty');

  const dir = uploadsDirFor(deps.dataDir, project.id);
  const absolutePath = path.join(dir, name);
  const replaced = existsSync(absolutePath);
  const file = `${UPLOAD_PREFIX}${name}`;

  const extracted = await extractDocument(name, bytes);
  const chunks = chunkMarkdown(extracted.text);
  if (chunks.length === 0) throw new Error('Uploaded document produced no indexable content');

  log(`Embedding ${file} (${chunks.length} chunk(s))`);
  const vectors = await deps.embeddingProvider.embedDocuments(chunks.map(composeEmbedText));
  // Hash the original bytes, not the extracted text — the file on disk is the
  // thing being versioned, and a parser upgrade should not look like an edit.
  const contentHash = hashContent(bytes.toString('base64'));

  const points: DocumentPoint[] = chunks.map((chunk, i) => ({
    id: randomUUID(),
    vector: vectors[i],
    payload: {
      project: project.id,
      file,
      absolute_path: absolutePath,
      document_type: extracted.documentType,
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
  // Write the file only after extraction and embedding succeeded — a failed
  // upload leaves no orphan on disk claiming to be indexed. The *original*
  // bytes are stored, so a future parser improvement can re-extract them.
  mkdirSync(dir, { recursive: true });
  writeFileSync(absolutePath, bytes);
  if (replaced) await deleteFileVectors(deps.qdrantClient, deps.qdrantCollection, project.id, file);
  await upsertChunks(deps.qdrantClient, deps.qdrantCollection, points);
  log(`Upserted ${points.length} chunk(s) for ${file}`);

  return {
    file,
    name,
    chunksIndexed: points.length,
    replaced,
    documentType: extracted.documentType,
    truncated: extracted.truncated,
  };
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
  // Vectors first: a leftover file that isn't indexed is harmless and fixes
  // itself on re-upload, whereas a leftover index entry would keep serving an
  // agent content for a document that no longer exists.
  // A missing collection (e.g. right after `qdrant drop-collection`) has nothing to delete —
  // skip the call rather than letting Qdrant 404 on it.
  const collections = await deps.qdrantClient.getCollections();
  if (collections.collections.some((c) => c.name === deps.qdrantCollection)) {
    await deleteFileVectors(
      deps.qdrantClient,
      deps.qdrantCollection,
      project.id,
      `${UPLOAD_PREFIX}${name}`,
    );
  }
  // unlinkSync, not rmSync: on Windows `fs.rmSync` returns without error and
  // without deleting anything when the filename contains non-ASCII characters
  // (verified on Node 24 — `Ringkasan Proyék.xlsx` survived every call).
  // unlink is also the right primitive for removing one known file.
  unlinkSync(absolutePath);
  // Belt and braces: a file locked by Excel or Word is an everyday case on
  // Windows, and it must not be reported to the dashboard as a removal.
  if (existsSync(absolutePath)) {
    throw new Error(
      `Removed "${name}" from the index, but the file itself could not be deleted — it may be open in another program. Close it and try again.`,
    );
  }
}
