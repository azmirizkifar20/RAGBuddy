import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import type { QdrantClient } from '@qdrant/js-client-rest';
import { computeProjectDataStats } from '../qdrant/qdrant-repository';

export interface ProjectStats {
  indexedFileCount: number;
  chunkCount: number;
  uploadCount: number;
  updatedAt: string;
}

type ProjectStatsData = Record<string, ProjectStats>;

/**
 * Caches the per-project dashboard summary (file/chunk/upload counts) that would otherwise
 * require scrolling every chunk of every project out of Qdrant on every `GET /api/projects`
 * page load. Kept fresh by `refreshProjectStats` after ingest/sync/upload/upload-remove mutate
 * Qdrant, and cleared per-project when the whole collection is dropped.
 */
export class ProjectStatsStore {
  constructor(private readonly filePath: string) {}

  get(projectId: string): ProjectStats | undefined {
    return this.load()[projectId];
  }

  set(projectId: string, stats: ProjectStats): void {
    const data = this.load();
    data[projectId] = stats;
    this.save(data);
  }

  remove(projectId: string): void {
    const data = this.load();
    if (!(projectId in data)) return;
    delete data[projectId];
    this.save(data);
  }

  private load(): ProjectStatsData {
    if (!existsSync(this.filePath)) return {};
    return JSON.parse(readFileSync(this.filePath, 'utf8')) as ProjectStatsData;
  }

  private save(data: ProjectStatsData): void {
    mkdirSync(path.dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
  }
}

/**
 * Recomputes and caches one project's stats — never throws, since this is bookkeeping that must
 * never fail the ingest/sync/upload operation it rides along with. Defaults to `console.warn`
 * when the caller has no log sink of its own (e.g. `removeUpload`).
 */
export async function refreshProjectStats(
  store: ProjectStatsStore,
  client: QdrantClient,
  collectionName: string,
  projectId: string,
  onLog: (message: string) => void = (message) => console.warn(`[ragbuddy] ${message}`),
): Promise<void> {
  try {
    const stats = await computeProjectDataStats(client, collectionName, projectId);
    store.set(projectId, { ...stats, updatedAt: new Date().toISOString() });
  } catch (error) {
    onLog(
      `Warning: failed to refresh cached stats for "${projectId}": ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
