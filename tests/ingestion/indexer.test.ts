import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { indexProject } from '../../src/ingestion/indexer';

describe('indexProject', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'ragbuddy-indexer-'));
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
      scroll: vi.fn().mockResolvedValue({ points: [], next_page_offset: null }),
    } as any;
    const onLog = vi.fn();

    const result = await indexProject(project, {
      qdrantClient,
      qdrantUrl: 'http://localhost:6333',
      qdrantCollection: 'ragbuddy_documents',
      embeddingProvider: embeddingProvider as any,
      onLog,
    });

    expect(result).toEqual({ filesIndexed: 1, chunksIndexed: 1 });
    expect(qdrantClient.createCollection).toHaveBeenCalledWith('ragbuddy_documents', {
      vectors: { size: 2, distance: 'Cosine' },
    });
    // Collection doesn't exist yet (first-ever ingest) — nothing to delete, and deleting from a
    // missing collection 404s, so it must be skipped rather than attempted.
    expect(qdrantClient.delete).not.toHaveBeenCalled();
    const upsertCall = qdrantClient.upsert.mock.calls[0];
    expect(upsertCall[0]).toBe('ragbuddy_documents');
    expect(upsertCall[1].points).toHaveLength(1);
    expect(upsertCall[1].points[0].payload).toMatchObject({
      project: 'sample',
      file: 'docs/features/01-auth.md',
      document_type: 'markdown',
      category: 'features',
      chunk_index: 0,
      title: 'Auth',
      source: 'repository',
    });
    expect(upsertCall[1].points[0].payload.git_commit).toMatch(/^[0-9a-f]{40}$/);
    expect(onLog).toHaveBeenCalledWith(expect.stringContaining('Scanned 1 file'));
    expect(onLog).toHaveBeenCalledWith(expect.stringContaining('Upserted 1 chunk'));
  });

  it('deletes each file\'s old vectors first when the collection already exists', async () => {
    const project = { id: 'sample', name: 'sample', repository: dir, paths: ['docs'] };
    const embeddingProvider = { embedDocuments: vi.fn().mockResolvedValue([[0.1, 0.2]]), embedQuery: vi.fn() };
    const qdrantClient = {
      getCollections: vi.fn().mockResolvedValue({ collections: [{ name: 'ragbuddy_documents' }] }),
      getCollection: vi.fn().mockResolvedValue({ config: { params: { vectors: { size: 2 } } } }),
      createCollection: vi.fn(),
      delete: vi.fn().mockResolvedValue(true),
      upsert: vi.fn().mockResolvedValue(true),
      scroll: vi.fn().mockResolvedValue({ points: [], next_page_offset: null }),
    } as any;

    await indexProject(project, {
      qdrantClient,
      qdrantUrl: 'http://localhost:6333',
      qdrantCollection: 'ragbuddy_documents',
      embeddingProvider: embeddingProvider as any,
    });

    expect(qdrantClient.createCollection).not.toHaveBeenCalled();
    expect(qdrantClient.delete).toHaveBeenCalledWith('ragbuddy_documents', {
      wait: true,
      filter: {
        must: [
          { key: 'project', match: { value: 'sample' } },
          { key: 'file', match: { value: 'docs/features/01-auth.md' } },
        ],
      },
    });
  });

  it('succeeds against a collection dropped since the last run (e.g. via `qdrant drop-collection`), even if delete would 404', async () => {
    const project = { id: 'sample', name: 'sample', repository: dir, paths: ['docs'] };
    const embeddingProvider = { embedDocuments: vi.fn().mockResolvedValue([[0.1, 0.2]]), embedQuery: vi.fn() };
    const qdrantClient = {
      getCollections: vi.fn().mockResolvedValue({ collections: [] }),
      createCollection: vi.fn().mockResolvedValue(true),
      // Reproduces the real Qdrant behavior being guarded against: deleting from a collection
      // that doesn't exist rejects. If indexProject ever calls this again for a missing
      // collection, the whole run fails exactly like the reported bug did.
      delete: vi.fn().mockRejectedValue(new Error('Not Found')),
      upsert: vi.fn().mockResolvedValue(true),
      scroll: vi.fn().mockResolvedValue({ points: [], next_page_offset: null }),
    } as any;

    const result = await indexProject(project, {
      qdrantClient,
      qdrantUrl: 'http://localhost:6333',
      qdrantCollection: 'ragbuddy_documents',
      embeddingProvider: embeddingProvider as any,
    });

    expect(result).toEqual({ filesIndexed: 1, chunksIndexed: 1 });
    expect(qdrantClient.delete).not.toHaveBeenCalled();
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
      qdrantCollection: 'ragbuddy_documents',
      embeddingProvider: embeddingProvider as any,
    });

    const upsertCall = qdrantClient.upsert.mock.calls[0];
    expect(upsertCall[1].points[0].payload).toMatchObject({
      file: 'knowledge-base/faq/01.md',
      category: 'faq',
    });
  });

  it('removes vectors for a file no longer present, without creating a collection', async () => {
    rmSync(path.join(dir, 'docs'), { recursive: true, force: true });
    const project = { id: 'sample', name: 'sample', repository: dir, paths: ['docs'] };
    const embeddingProvider = { embedDocuments: vi.fn(), embedQuery: vi.fn() };
    const qdrantClient = {
      getCollections: vi.fn().mockResolvedValue({ collections: [{ name: 'ragbuddy_documents' }] }),
      createCollection: vi.fn(),
      delete: vi.fn().mockResolvedValue(true),
      upsert: vi.fn(),
      scroll: vi.fn().mockResolvedValue({
        points: [
          {
            payload: {
              project: 'sample',
              file: 'docs/features/01-auth.md',
              content_hash: 'stale-hash',
              source: 'repository',
            },
          },
        ],
        next_page_offset: null,
      }),
    } as any;

    const result = await indexProject(project, {
      qdrantClient,
      qdrantUrl: 'http://localhost:6333',
      qdrantCollection: 'ragbuddy_documents',
      embeddingProvider: embeddingProvider as any,
    });

    expect(result).toEqual({ filesIndexed: 0, chunksIndexed: 0 });
    expect(qdrantClient.createCollection).not.toHaveBeenCalled();
    expect(qdrantClient.upsert).not.toHaveBeenCalled();
    expect(qdrantClient.delete).toHaveBeenCalledWith('ragbuddy_documents', {
      wait: true,
      filter: {
        must: [
          { key: 'project', match: { value: 'sample' } },
          { key: 'file', match: { value: 'docs/features/01-auth.md' } },
        ],
      },
    });
  });

  it('keeps earlier files upserted when a later file fails mid-run', async () => {
    mkdirSync(path.join(dir, 'docs', 'features'), { recursive: true });
    writeFileSync(path.join(dir, 'docs', 'features', '02-billing.md'), '# Billing\n\nBilling content.\n');
    execFileSync('git', ['add', '.'], { cwd: dir });
    execFileSync('git', ['commit', '-m', 'add billing'], { cwd: dir });

    const project = { id: 'sample', name: 'sample', repository: dir, paths: ['docs'] };
    const embeddingProvider = {
      embedDocuments: vi
        .fn()
        .mockResolvedValueOnce([[0.1, 0.2]]) // 01-auth.md succeeds
        .mockRejectedValueOnce(new Error('embedding provider down')), // 02-billing.md fails
      embedQuery: vi.fn(),
    };
    const qdrantClient = {
      getCollections: vi.fn().mockResolvedValue({ collections: [] }),
      createCollection: vi.fn().mockResolvedValue(true),
      delete: vi.fn().mockResolvedValue(true),
      upsert: vi.fn().mockResolvedValue(true),
      scroll: vi.fn().mockResolvedValue({ points: [], next_page_offset: null }),
    } as any;

    await expect(
      indexProject(project, {
        qdrantClient,
        qdrantUrl: 'http://localhost:6333',
        qdrantCollection: 'ragbuddy_documents',
        embeddingProvider: embeddingProvider as any,
      }),
    ).rejects.toThrow('embedding provider down');

    // 01-auth.md's points were already upserted before 02-billing.md's failure — not lost.
    expect(qdrantClient.upsert).toHaveBeenCalledTimes(1);
    expect(qdrantClient.upsert.mock.calls[0][1].points[0].payload.file).toBe('docs/features/01-auth.md');
  });

  it('fails fast on a dimension mismatch instead of embedding every file first', async () => {
    mkdirSync(path.join(dir, 'docs', 'features'), { recursive: true });
    writeFileSync(path.join(dir, 'docs', 'features', '02-billing.md'), '# Billing\n\nBilling content.\n');
    execFileSync('git', ['add', '.'], { cwd: dir });
    execFileSync('git', ['commit', '-m', 'add billing'], { cwd: dir });

    const project = { id: 'sample', name: 'sample', repository: dir, paths: ['docs'] };
    const embeddingProvider = {
      embedDocuments: vi.fn().mockResolvedValue([[0.1, 0.2]]), // 2-dim, collection is 3072-dim
      embedQuery: vi.fn(),
    };
    const qdrantClient = {
      getCollections: vi.fn().mockResolvedValue({ collections: [{ name: 'ragbuddy_documents' }] }),
      getCollection: vi.fn().mockResolvedValue({ config: { params: { vectors: { size: 3072 } } } }),
      createCollection: vi.fn(),
      delete: vi.fn().mockResolvedValue(true),
      upsert: vi.fn(),
      scroll: vi.fn().mockResolvedValue({ points: [], next_page_offset: null }),
    } as any;

    await expect(
      indexProject(project, {
        qdrantClient,
        qdrantUrl: 'http://localhost:6333',
        qdrantCollection: 'ragbuddy_documents',
        embeddingProvider: embeddingProvider as any,
      }),
    ).rejects.toThrow(/dimension mismatch/i);

    // Stops after the first file's embed instead of burning through every file first.
    expect(embeddingProvider.embedDocuments).toHaveBeenCalledTimes(1);
    expect(qdrantClient.upsert).not.toHaveBeenCalled();
  });

  it('refreshes cached dashboard stats after a full rebuild', async () => {
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
      scroll: vi.fn().mockResolvedValue({ points: [], next_page_offset: null }),
    } as any;
    const statsStore = { get: vi.fn(), set: vi.fn(), remove: vi.fn() } as any;

    await indexProject(project, {
      qdrantClient,
      qdrantUrl: 'http://localhost:6333',
      qdrantCollection: 'ragbuddy_documents',
      embeddingProvider: embeddingProvider as any,
      statsStore,
    });

    expect(statsStore.set).toHaveBeenCalledTimes(1);
    expect(statsStore.set.mock.calls[0][0]).toBe('sample');
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
        qdrantCollection: 'ragbuddy_documents',
        embeddingProvider: embeddingProvider as any,
      }),
    ).rejects.toThrow();

    expect(qdrantClient.getCollections).not.toHaveBeenCalled();
  });
});
