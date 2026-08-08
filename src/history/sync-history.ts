import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

export type RunKind = 'ingest' | 'sync' | 'upload' | 'upload-remove';
export type RunStatus = 'success' | 'error';
/** Who triggered the run — the git hook shells out to the CLI, so it sets PROJECT_RAG_TRIGGER=hook. */
export type RunTrigger = 'cli' | 'web' | 'hook';

export interface RunRecord {
  id: string;
  project: string;
  kind: RunKind;
  status: RunStatus;
  trigger: RunTrigger;
  startedAt: string;
  durationMs: number;
  /** Free-form per-kind counters (added/modified/deleted/unchanged, filesIndexed/chunksIndexed, file). */
  summary: Record<string, unknown>;
  error?: string;
}

export type NewRunRecord = Omit<RunRecord, 'id'>;

// ponytail: whole-file rewrite of a capped array — a few hundred records at
// human commit rates. Swap for append-only JSONL if this ever gets hot.
const MAX_RECORDS = 500;

export class SyncHistoryStore {
  constructor(private readonly filePath: string) {}

  append(record: NewRunRecord): RunRecord {
    const stored: RunRecord = { id: `${Date.parse(record.startedAt) || 0}-${randomSuffix()}`, ...record };
    const all = [stored, ...this.load()].slice(0, MAX_RECORDS);
    mkdirSync(path.dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(all, null, 2) + '\n', 'utf8');
    return stored;
  }

  /** Newest first. Omit `project` for the cross-project activity feed. */
  list(options: { project?: string; limit?: number } = {}): RunRecord[] {
    const limit = options.limit ?? 50;
    return this.load()
      .filter((r) => (options.project ? r.project === options.project : true))
      .slice(0, limit);
  }

  private load(): RunRecord[] {
    if (!existsSync(this.filePath)) return [];
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf8'));
      return Array.isArray(parsed) ? (parsed as RunRecord[]) : [];
    } catch {
      // A corrupt history file must never break an ingest — history is
      // observability, not source of truth.
      return [];
    }
  }
}

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 8);
}

/**
 * Times `run`, records the outcome (including failures), and re-throws so
 * callers keep their existing error handling. Recording must never be the
 * reason an ingest fails, so store errors are swallowed.
 */
export async function recordRun<T>(
  store: SyncHistoryStore,
  meta: { project: string; kind: RunKind; trigger: RunTrigger },
  run: () => Promise<T>,
  summarize: (result: T) => Record<string, unknown>,
): Promise<T> {
  const startedAt = new Date().toISOString();
  const start = Date.now();
  try {
    const result = await run();
    safeAppend(store, { ...meta, status: 'success', startedAt, durationMs: Date.now() - start, summary: summarize(result) });
    return result;
  } catch (error) {
    safeAppend(store, {
      ...meta,
      status: 'error',
      startedAt,
      durationMs: Date.now() - start,
      summary: {},
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

function safeAppend(store: SyncHistoryStore, record: NewRunRecord): void {
  try {
    store.append(record);
  } catch {
    /* history is best-effort */
  }
}
