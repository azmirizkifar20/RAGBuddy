import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { hashContent } from '../../src/ingestion/hasher';
import { syncProject } from '../../src/ingestion/sync';

describe('syncProject', () => {
  let dir: string;
  const unchangedContent = '# Unchanged\n\nSame content.\n';
  const modifiedContent = '# Modified\n\nNew content.\n';
  const addedContent = '# Added\n\nAdded content.\n';

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'project-rag-sync-'));
    execFileSync('git', ['init', '-b', 'main'], { cwd: dir });
    execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: dir });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
    mkdirSync(path.join(dir, 'docs'), { recursive: true });
    writeFileSync(path.join(dir, 'docs', 'unchanged.md'), unchangedContent);
    writeFileSync(path.join(dir, 'docs', 'modified.md'), modifiedContent);
    writeFileSync(path.join(dir, 'docs', 'added.md'), addedContent);
    execFileSync('git', ['add', '.'], { cwd: dir });
    execFileSync('git', ['commit', '-m', 'init'], { cwd: dir });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('classifies added, modified, deleted, and unchanged files, and only re-embeds what changed', async () => {
    const project = { id: 'sample', name: 'sample', repository: dir, paths: ['docs'] };
    const embeddingProvider = {
      embedDocuments: vi.fn().mockResolvedValue([[0.1, 0.2]]),
      embedQuery: vi.fn(),
    };
    const qdrantClient = {
      scroll: vi.fn().mockResolvedValue({
        points: [
          { id: '1', payload: { file: 'docs/unchanged.md', content_hash: hashContent(unchangedContent) } },
          { id: '2', payload: { file: 'docs/modified.md', content_hash: 'stale-hash' } },
          { id: '3', payload: { file: 'docs/deleted.md', content_hash: 'whatever' } },
        ],
        next_page_offset: null,
      }),
      getCollections: vi.fn().mockResolvedValue({ collections: [{ name: 'project_rag_documents' }] }),
      createCollection: vi.fn().mockResolvedValue(true),
      delete: vi.fn().mockResolvedValue(true),
      upsert: vi.fn().mockResolvedValue(true),
    } as any;

    const result = await syncProject(project, {
      qdrantClient,
      qdrantUrl: 'http://localhost:6333',
      qdrantCollection: 'project_rag_documents',
      embeddingProvider: embeddingProvider as any,
    });

    expect(result).toEqual({
      added: ['docs/added.md'],
      modified: ['docs/modified.md'],
      deleted: ['docs/deleted.md'],
      unchanged: ['docs/unchanged.md'],
    });

    expect(embeddingProvider.embedDocuments).toHaveBeenCalledTimes(2);

    const deleteCalls = qdrantClient.delete.mock.calls.map((call: any[]) => call[1].filter.must[1].match.value);
    expect(deleteCalls.sort()).toEqual(['docs/deleted.md', 'docs/modified.md']);

    expect(qdrantClient.upsert).toHaveBeenCalledTimes(2);
    const upsertedFiles = qdrantClient.upsert.mock.calls.map((call: any[]) => call[1].points[0].payload.file).sort();
    expect(upsertedFiles).toEqual(['docs/added.md', 'docs/modified.md']);
  });

  it('throws without touching Qdrant when the repository path is not accessible', async () => {
    const project = {
      id: 'sample',
      name: 'sample',
      repository: path.join(dir, 'does-not-exist'),
      paths: ['docs'],
    };
    const embeddingProvider = { embedDocuments: vi.fn(), embedQuery: vi.fn() };
    const qdrantClient = {
      scroll: vi.fn().mockResolvedValue({ points: [], next_page_offset: null }),
      getCollections: vi.fn().mockResolvedValue({ collections: [] }),
      createCollection: vi.fn().mockResolvedValue(true),
      delete: vi.fn().mockResolvedValue(true),
      upsert: vi.fn().mockResolvedValue(true),
    } as any;

    await expect(
      syncProject(project, {
        qdrantClient,
        qdrantUrl: 'http://localhost:6333',
        qdrantCollection: 'project_rag_documents',
        embeddingProvider: embeddingProvider as any,
      }),
    ).rejects.toThrow();

    expect(qdrantClient.scroll).not.toHaveBeenCalled();
  });
});
