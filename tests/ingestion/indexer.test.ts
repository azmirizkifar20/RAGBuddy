import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { indexProject } from '../../src/ingestion/indexer';

describe('indexProject', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'project-rag-indexer-'));
    execFileSync('git', ['init', '-b', 'main'], { cwd: dir });
    execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: dir });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
    mkdirSync(path.join(dir, 'docs', 'features'), { recursive: true });
    writeFileSync(path.join(dir, 'docs', 'features', '01-auth.md'), '# Auth\n\nAuth content.\n');
    execFileSync('git', ['add', '.'], { cwd: dir });
    execFileSync('git', ['commit', '-m', 'init'], { cwd: dir });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('scans, chunks, embeds, and upserts, deriving category from path', async () => {
    const project = { id: 'sample', name: 'sample', repository: dir, paths: ['docs'] };
    const embeddingProvider = {
      embedDocuments: vi.fn().mockResolvedValue([[0.1, 0.2]]),
      embedQuery: vi.fn(),
    };
    const qdrantClient = {
      getCollections: vi.fn().mockResolvedValue({ collections: [] }),
      createCollection: vi.fn().mockResolvedValue(true),
      delete: vi.fn().mockResolvedValue(true),
      upsert: vi.fn().mockResolvedValue(true),
    } as any;
    const onLog = vi.fn();

    const result = await indexProject(project, {
      qdrantClient,
      qdrantUrl: 'http://localhost:6333',
      qdrantCollection: 'project_rag_documents',
      embeddingProvider: embeddingProvider as any,
      onLog,
    });

    expect(result).toEqual({ filesIndexed: 1, chunksIndexed: 1 });
    expect(qdrantClient.createCollection).toHaveBeenCalledWith('project_rag_documents', {
      vectors: { size: 2, distance: 'Cosine' },
    });
    expect(qdrantClient.delete).toHaveBeenCalledWith('project_rag_documents', {
      filter: { must: [{ key: 'project', match: { value: 'sample' } }] },
    });
    const upsertCall = qdrantClient.upsert.mock.calls[0];
    expect(upsertCall[0]).toBe('project_rag_documents');
    expect(upsertCall[1].points).toHaveLength(1);
    expect(upsertCall[1].points[0].payload).toMatchObject({
      project: 'sample',
      file: 'docs/features/01-auth.md',
      document_type: 'markdown',
      category: 'features',
      chunk_index: 0,
      title: 'Auth',
    });
    expect(upsertCall[1].points[0].payload.git_commit).toMatch(/^[0-9a-f]{40}$/);
    expect(onLog).toHaveBeenCalledWith(expect.stringContaining('Scanned 1 file'));
    expect(onLog).toHaveBeenCalledWith(expect.stringContaining('Upserted 1 chunk'));
  });

  it('derives category from a non-default configured path', async () => {
    mkdirSync(path.join(dir, 'knowledge-base', 'faq'), { recursive: true });
    writeFileSync(
      path.join(dir, 'knowledge-base', 'faq', '01.md'),
      '# FAQ\n\nFAQ content.\n',
    );
    execFileSync('git', ['add', '.'], { cwd: dir });
    execFileSync('git', ['commit', '-m', 'add faq'], { cwd: dir });

    const project = { id: 'sample', name: 'sample', repository: dir, paths: ['knowledge-base'] };
    const embeddingProvider = {
      embedDocuments: vi.fn().mockResolvedValue([[0.1, 0.2]]),
      embedQuery: vi.fn(),
    };
    const qdrantClient = {
      getCollections: vi.fn().mockResolvedValue({ collections: [] }),
      createCollection: vi.fn().mockResolvedValue(true),
      delete: vi.fn().mockResolvedValue(true),
      upsert: vi.fn().mockResolvedValue(true),
    } as any;

    await indexProject(project, {
      qdrantClient,
      qdrantUrl: 'http://localhost:6333',
      qdrantCollection: 'project_rag_documents',
      embeddingProvider: embeddingProvider as any,
    });

    const upsertCall = qdrantClient.upsert.mock.calls[0];
    expect(upsertCall[1].points[0].payload).toMatchObject({
      file: 'knowledge-base/faq/01.md',
      category: 'faq',
    });
  });

  it('clears existing vectors when there are no documents to index, without creating a collection', async () => {
    rmSync(path.join(dir, 'docs'), { recursive: true, force: true });
    const project = { id: 'sample', name: 'sample', repository: dir, paths: ['docs'] };
    const embeddingProvider = { embedDocuments: vi.fn(), embedQuery: vi.fn() };
    const qdrantClient = {
      getCollections: vi.fn().mockResolvedValue({ collections: [{ name: 'project_rag_documents' }] }),
      createCollection: vi.fn(),
      delete: vi.fn().mockResolvedValue(true),
      upsert: vi.fn(),
    } as any;

    const result = await indexProject(project, {
      qdrantClient,
      qdrantUrl: 'http://localhost:6333',
      qdrantCollection: 'project_rag_documents',
      embeddingProvider: embeddingProvider as any,
    });

    expect(result).toEqual({ filesIndexed: 0, chunksIndexed: 0 });
    expect(qdrantClient.createCollection).not.toHaveBeenCalled();
    expect(qdrantClient.upsert).not.toHaveBeenCalled();
    expect(qdrantClient.delete).toHaveBeenCalledWith('project_rag_documents', {
      filter: { must: [{ key: 'project', match: { value: 'sample' } }] },
    });
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
      getCollections: vi.fn().mockResolvedValue({ collections: [] }),
      createCollection: vi.fn().mockResolvedValue(true),
      delete: vi.fn().mockResolvedValue(true),
      upsert: vi.fn().mockResolvedValue(true),
    } as any;

    await expect(
      indexProject(project, {
        qdrantClient,
        qdrantUrl: 'http://localhost:6333',
        qdrantCollection: 'project_rag_documents',
        embeddingProvider: embeddingProvider as any,
      }),
    ).rejects.toThrow();

    expect(qdrantClient.getCollections).not.toHaveBeenCalled();
  });
});
