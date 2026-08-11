import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ProjectStatsStore, refreshProjectStats } from '../../src/projects/project-stats';

describe('ProjectStatsStore', () => {
  let dir: string;
  let filePath: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'ragbuddy-project-stats-'));
    filePath = path.join(dir, 'project-stats.json');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns undefined for a project that was never cached', () => {
    const store = new ProjectStatsStore(filePath);
    expect(store.get('sample')).toBeUndefined();
  });

  it('persists stats across instances', () => {
    const store = new ProjectStatsStore(filePath);
    store.set('sample', { indexedFileCount: 3, chunkCount: 42, uploadCount: 1, updatedAt: '2026-01-01T00:00:00.000Z' });

    const reloaded = new ProjectStatsStore(filePath);
    expect(reloaded.get('sample')).toEqual({
      indexedFileCount: 3,
      chunkCount: 42,
      uploadCount: 1,
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
  });

  it('keeps other projects untouched when removing one', () => {
    const store = new ProjectStatsStore(filePath);
    store.set('a', { indexedFileCount: 1, chunkCount: 1, uploadCount: 0, updatedAt: 'x' });
    store.set('b', { indexedFileCount: 2, chunkCount: 2, uploadCount: 0, updatedAt: 'x' });

    store.remove('a');

    expect(store.get('a')).toBeUndefined();
    expect(store.get('b')).toBeDefined();
  });

  it('does nothing when removing a project that was never cached', () => {
    const store = new ProjectStatsStore(filePath);
    expect(() => store.remove('missing')).not.toThrow();
  });
});

describe('refreshProjectStats', () => {
  function scrollClient(points: unknown[]) {
    return {
      getCollections: vi.fn().mockResolvedValue({ collections: [{ name: 'docs' }] }),
      scroll: vi.fn().mockResolvedValue({ points, next_page_offset: null }),
    } as any;
  }

  it('computes and caches fresh stats', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ragbuddy-refresh-stats-'));
    const store = new ProjectStatsStore(path.join(dir, 'project-stats.json'));
    const client = scrollClient([
      { payload: { file: 'docs/a.md', source: 'repository' } },
      { payload: { file: 'uploads/n.md', source: 'upload' } },
    ]);

    await refreshProjectStats(store, client, 'docs', 'sample');

    expect(store.get('sample')).toMatchObject({ indexedFileCount: 2, chunkCount: 2, uploadCount: 1 });
    rmSync(dir, { recursive: true, force: true });
  });

  it('never throws — logs a warning and leaves the cache untouched on failure', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ragbuddy-refresh-stats-fail-'));
    const store = new ProjectStatsStore(path.join(dir, 'project-stats.json'));
    const client = { getCollections: vi.fn().mockRejectedValue(new Error('qdrant down')) } as any;
    const onLog = vi.fn();

    await expect(refreshProjectStats(store, client, 'docs', 'sample', onLog)).resolves.toBeUndefined();

    expect(store.get('sample')).toBeUndefined();
    expect(onLog).toHaveBeenCalledWith(expect.stringContaining('qdrant down'));
    rmSync(dir, { recursive: true, force: true });
  });
});
