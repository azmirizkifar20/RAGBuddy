import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { SyncHistoryStore, recordRun } from '../../src/history/sync-history';

describe('SyncHistoryStore', () => {
  let dir: string;
  let store: SyncHistoryStore;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'project-rag-history-'));
    store = new SyncHistoryStore(path.join(dir, 'nested', 'sync-history.json'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function record(project: string, startedAt: string) {
    return {
      project,
      kind: 'sync' as const,
      status: 'success' as const,
      trigger: 'cli' as const,
      startedAt,
      durationMs: 10,
      summary: {},
    };
  }

  it('returns an empty list when no history file exists yet', () => {
    expect(store.list()).toEqual([]);
  });

  it('creates the parent directory and returns records newest first', () => {
    store.append(record('a', '2026-01-01T00:00:00.000Z'));
    store.append(record('b', '2026-01-02T00:00:00.000Z'));

    expect(store.list().map((r) => r.project)).toEqual(['b', 'a']);
  });

  it('filters by project and honours the limit', () => {
    store.append(record('a', '2026-01-01T00:00:00.000Z'));
    store.append(record('b', '2026-01-02T00:00:00.000Z'));
    store.append(record('a', '2026-01-03T00:00:00.000Z'));

    expect(store.list({ project: 'a' })).toHaveLength(2);
    expect(store.list({ limit: 1 }).map((r) => r.project)).toEqual(['a']);
  });

  it('treats a corrupt history file as empty rather than throwing', () => {
    const filePath = path.join(dir, 'corrupt.json');
    writeFileSync(filePath, 'not json at all', 'utf8');

    expect(new SyncHistoryStore(filePath).list()).toEqual([]);
  });
});

describe('recordRun', () => {
  let dir: string;
  let store: SyncHistoryStore;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'project-rag-history-run-'));
    store = new SyncHistoryStore(path.join(dir, 'sync-history.json'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('records a successful run with the summarised result', async () => {
    const result = await recordRun(
      store,
      { project: 'sample', kind: 'sync', trigger: 'hook' },
      async () => ({ added: ['a.md'], modified: [], deleted: [], unchanged: [] }),
      (r) => ({ added: r.added.length }),
    );

    expect(result.added).toEqual(['a.md']);
    const [entry] = store.list();
    expect(entry).toMatchObject({ project: 'sample', kind: 'sync', trigger: 'hook', status: 'success' });
    expect(entry.summary).toEqual({ added: 1 });
  });

  it('records a failed run and re-throws so existing error handling still runs', async () => {
    await expect(
      recordRun(
        store,
        { project: 'sample', kind: 'ingest', trigger: 'cli' },
        async () => {
          throw new Error('embedding provider down');
        },
        () => ({}),
      ),
    ).rejects.toThrow('embedding provider down');

    expect(store.list()[0]).toMatchObject({ status: 'error', error: 'embedding provider down' });
  });

  it('never lets a broken history store fail the run itself', async () => {
    // A directory where the file should be makes every write throw.
    const brokenStore = new SyncHistoryStore(dir);

    await expect(
      recordRun(brokenStore, { project: 'sample', kind: 'sync', trigger: 'cli' }, async () => 'ok', () => ({})),
    ).resolves.toBe('ok');
  });
});
