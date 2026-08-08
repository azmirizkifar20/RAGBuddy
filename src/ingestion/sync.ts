import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { QdrantClient } from '@qdrant/js-client-rest';
import type { ProjectConfig } from '../projects/project-types';
import type { EmbeddingProvider } from '../embedding/embedding-provider';
import { scanDocuments } from './scanner';
import { hashContent } from './hasher';
import { chunkMarkdown } from './chunker';
import { getCurrentCommit } from '../git/git-status';
import { ensureCollection } from '../qdrant/qdrant-client';
import {
  upsertChunks,
  deleteFileVectors,
  getIndexedFileHashes,
  type DocumentPoint,
} from '../qdrant/qdrant-repository';
import { deriveCategory, composeEmbedText } from './payload-builder';

export interface SyncProjectDeps {
  qdrantClient: QdrantClient;
  qdrantUrl: string;
  qdrantCollection: string;
  embeddingProvider: EmbeddingProvider;
  onLog?: (message: string) => void;
}

export interface SyncResult {
  added: string[];
  modified: string[];
  deleted: string[];
  unchanged: string[];
}

export async function syncProject(
  project: ProjectConfig,
  deps: SyncProjectDeps,
): Promise<SyncResult> {
  const log = deps.onLog ?? (() => {});
  const files = scanDocuments(project.repository, project.paths);
  const currentPaths = new Set(files.map((f) => f.relativePath));
  const existingHashes = await getIndexedFileHashes(deps.qdrantClient, deps.qdrantCollection, project.id);
  const gitCommit = getCurrentCommit(project.repository);

  const added: string[] = [];
  const modified: string[] = [];
  const unchanged: string[] = [];
  const deleted = [...existingHashes.keys()].filter((file) => !currentPaths.has(file));
  const points: DocumentPoint[] = [];

  for (const file of files) {
    const content = readFileSync(file.absolutePath, 'utf8');
    const contentHash = hashContent(content);
    const existingHash = existingHashes.get(file.relativePath);

    if (existingHash === contentHash) {
      unchanged.push(file.relativePath);
      continue;
    }

    if (existingHash === undefined) {
      added.push(file.relativePath);
    } else {
      modified.push(file.relativePath);
      log(`Removing old vectors for ${file.relativePath}`);
      await deleteFileVectors(deps.qdrantClient, deps.qdrantCollection, project.id, file.relativePath);
    }

    const chunks = chunkMarkdown(content);
    if (chunks.length === 0) continue;

    const texts = chunks.map(composeEmbedText);
    log(`Embedding ${file.relativePath} (${chunks.length} chunk(s))`);
    const vectors = await deps.embeddingProvider.embedDocuments(texts);

    for (let i = 0; i < chunks.length; i++) {
      points.push({
        id: randomUUID(),
        vector: vectors[i],
        payload: {
          project: project.id,
          file: file.relativePath,
          absolute_path: file.absolutePath,
          document_type: 'markdown',
          category: deriveCategory(file.relativePath, project.paths),
          content_hash: contentHash,
          git_commit: gitCommit,
          chunk_index: chunks[i].chunkIndex,
          title: chunks[i].title,
          section: chunks[i].section,
          content: chunks[i].content,
        },
      });
    }
  }

  for (const file of deleted) {
    log(`Removing vectors for deleted file ${file}`);
    await deleteFileVectors(deps.qdrantClient, deps.qdrantCollection, project.id, file);
  }

  if (points.length > 0) {
    const vectorSize = points[0].vector.length;
    await ensureCollection(deps.qdrantClient, {
      url: deps.qdrantUrl,
      collectionName: deps.qdrantCollection,
      vectorSize,
    });
    await upsertChunks(deps.qdrantClient, deps.qdrantCollection, points);
    log(`Upserted ${points.length} chunk(s) to Qdrant`);
  }

  return { added, modified, deleted, unchanged };
}
