import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
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
import { refreshProjectStats, type ProjectStatsStore } from '../projects/project-stats';

export interface SyncProjectDeps {
  qdrantClient: QdrantClient;
  qdrantUrl: string;
  qdrantCollection: string;
  embeddingProvider: EmbeddingProvider;
  onLog?: (message: string) => void;
  /** Optional — when provided, the dashboard's cached file/chunk/upload counts are refreshed
   *  after this sync finishes, but only if something actually changed (this runs on every
   *  post-commit/post-merge/post-checkout hook, most of which find nothing to do). */
  statsStore?: ProjectStatsStore;
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
  if (!existsSync(project.repository) || !existsSync(path.join(project.repository, '.git'))) {
    throw new Error(`Repository is not accessible or not a Git repository: ${project.repository}`);
  }
  const log = deps.onLog ?? (() => {});
  const files = scanDocuments(project.repository, project.paths);
  const currentPaths = new Set(files.map((f) => f.relativePath));
  // 'repository' scope only — uploaded documents have no counterpart in the
  // scan, so an unscoped diff would list every one of them as deleted.
  const existingHashes = await getIndexedFileHashes(
    deps.qdrantClient,
    deps.qdrantCollection,
    project.id,
    'repository',
  );
  const gitCommit = getCurrentCommit(project.repository);

  const added: string[] = [];
  const modified: string[] = [];
  const unchanged: string[] = [];
  const deleted = [...existingHashes.keys()].filter((file) => !currentPaths.has(file));
  let collectionEnsured = false;

  // ponytail: upsert each file's new points immediately after that file's
  // own delete, rather than batching every changed file into one upsert at
  // the end — a later file's failure can then only leave THIS one file's
  // vectors deleted-but-not-replaced, not every file already processed in
  // this run. Narrower window, not a full atomic guarantee (still two
  // separate network calls); a true guarantee needs a run/version tag, same
  // as noted in indexer.ts's ponytail comment for the full-rebuild case.
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

    const filePoints: DocumentPoint[] = chunks.map((chunk, i) => ({
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
        chunk_index: chunk.chunkIndex,
        title: chunk.title,
        section: chunk.section,
        content: chunk.content,
        source: 'repository',
      },
    }));

    if (!collectionEnsured) {
      await ensureCollection(deps.qdrantClient, {
        url: deps.qdrantUrl,
        collectionName: deps.qdrantCollection,
        vectorSize: filePoints[0].vector.length,
      });
      collectionEnsured = true;
    }
    await upsertChunks(deps.qdrantClient, deps.qdrantCollection, filePoints);
    log(`Upserted ${filePoints.length} chunk(s) for ${file.relativePath}`);
  }

  for (const file of deleted) {
    log(`Removing vectors for deleted file ${file}`);
    await deleteFileVectors(deps.qdrantClient, deps.qdrantCollection, project.id, file);
  }

  const changed = added.length > 0 || modified.length > 0 || deleted.length > 0;
  if (deps.statsStore && changed) {
    await refreshProjectStats(deps.statsStore, deps.qdrantClient, deps.qdrantCollection, project.id, deps.onLog);
  }

  return { added, modified, deleted, unchanged };
}
