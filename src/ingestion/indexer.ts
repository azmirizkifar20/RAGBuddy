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
import { upsertChunks, deleteProjectVectors, type DocumentPoint } from '../qdrant/qdrant-repository';

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
  const log = deps.onLog ?? (() => {});
  const files = scanDocuments(project.repository, project.paths);
  log(`Scanned ${files.length} file(s)`);
  const gitCommit = getCurrentCommit(project.repository);
  const points: DocumentPoint[] = [];

  for (const file of files) {
    const content = readFileSync(file.absolutePath, 'utf8');
    const contentHash = hashContent(content);
    const chunks = chunkMarkdown(content);
    if (chunks.length === 0) continue;

    const texts = chunks.map((chunk) => `${chunk.title}\n${chunk.section}\n${chunk.content}`);
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

  // ponytail: delete-then-upsert means a failed upsert leaves the project
  // unindexed rather than stale (not silently wrong) — deliberate for now.
  // A true atomic swap needs points tagged with a run/version id so delete
  // could target "project X, version != new" instead of "project X"
  // outright; naive upsert-then-delete-by-project-only would wipe the fresh
  // points too. Revisit if/when a future phase needs per-file atomic replace.
  if (points.length > 0) {
    const vectorSize = points[0].vector.length;
    await ensureCollection(deps.qdrantClient, {
      url: deps.qdrantUrl,
      collectionName: deps.qdrantCollection,
      vectorSize,
    });
    await deleteProjectVectors(deps.qdrantClient, deps.qdrantCollection, project.id);
    await upsertChunks(deps.qdrantClient, deps.qdrantCollection, points);
    log(`Upserted ${points.length} chunk(s) to Qdrant`);
  } else {
    log('No documents found to index');
    const collections = await deps.qdrantClient.getCollections();
    const exists = collections.collections.some((c) => c.name === deps.qdrantCollection);
    if (exists) {
      await deleteProjectVectors(deps.qdrantClient, deps.qdrantCollection, project.id);
      log('Cleared existing project vectors');
    }
  }

  return { filesIndexed: files.length, chunksIndexed: points.length };
}

function deriveCategory(relativePath: string, paths: string[]): string {
  for (const configuredPath of paths) {
    const prefix = configuredPath.endsWith('/') ? configuredPath : `${configuredPath}/`;
    if (relativePath.startsWith(prefix)) {
      const rest = relativePath.slice(prefix.length);
      const segment = rest.split('/')[0];
      return segment || 'root';
    }
  }
  return 'other';
}
