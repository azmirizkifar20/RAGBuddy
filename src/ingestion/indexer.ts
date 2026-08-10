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

export interface IndexProjectDeps {
  qdrantClient: QdrantClient;
  qdrantUrl: string;
  qdrantCollection: string;
  embeddingProvider: EmbeddingProvider;
  onLog?: (message: string) => void;
}

export interface IndexProjectResult {
  filesIndexed: number;
  chunksIndexed: number;
}

export async function indexProject(
  project: ProjectConfig,
  deps: IndexProjectDeps,
): Promise<IndexProjectResult> {
  if (!existsSync(project.repository) || !existsSync(path.join(project.repository, '.git'))) {
    throw new Error(`Repository is not accessible or not a Git repository: ${project.repository}`);
  }
  const log = deps.onLog ?? (() => {});
  const files = scanDocuments(project.repository, project.paths);
  log(`Scanned ${files.length} file(s)`);
  const gitCommit = getCurrentCommit(project.repository);
  const currentPaths = new Set(files.map((f) => f.relativePath));
  // 'repository' scope only — uploaded documents have no file on disk to re-scan, so an
  // unscoped read here would list every one of them as "no longer present" and delete it below.
  const existingFiles = await getIndexedFileHashes(
    deps.qdrantClient,
    deps.qdrantCollection,
    project.id,
    'repository',
  );
  // Deleting from a collection that doesn't exist yet (e.g. right after `qdrant drop-collection`,
  // before anything has been re-ingested) 404s — there's nothing to delete in that case anyway,
  // so skip the per-file delete entirely rather than erroring on the very first file.
  const collectionExists = (await deps.qdrantClient.getCollections()).collections.some(
    (c) => c.name === deps.qdrantCollection,
  );

  let chunksIndexed = 0;
  let collectionEnsured = false;

  // ponytail: delete-then-upsert PER FILE (mirrors sync.ts), not delete-everything-then-upsert-
  // everything at the end — a failure partway through (embedding error, Qdrant hiccup, dimension
  // mismatch) then only leaves the file being processed gone-but-not-replaced, not every file
  // already embedded this run. Files that finish stay indexed; re-running `sync` afterward picks
  // up only what's left, since it skips anything whose content_hash already matches.
  for (const file of files) {
    const content = readFileSync(file.absolutePath, 'utf8');
    const contentHash = hashContent(content);
    const chunks = chunkMarkdown(content);

    if (collectionExists) {
      log(`Removing old vectors for ${file.relativePath}`);
      await deleteFileVectors(deps.qdrantClient, deps.qdrantCollection, project.id, file.relativePath);
    }
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
    chunksIndexed += filePoints.length;
  }

  for (const file of existingFiles.keys()) {
    if (!currentPaths.has(file)) {
      log(`Removing vectors for deleted file ${file}`);
      await deleteFileVectors(deps.qdrantClient, deps.qdrantCollection, project.id, file);
    }
  }

  return { filesIndexed: files.length, chunksIndexed };
}
